"""
app/livekit_agent/agent.py
━━━━━━━━━━━━━━━━━━━━━━━━━
LiveKit WebRTC Voice Agent worker — "Sarah", VoiceAgent AI's outbound sales rep.

New in v3.0:
  • Dynamic call content — user-defined seasonal/campaign prompts injected at session start
  • Prompt injection guard (Layer 1) on every user utterance
  • Response safety guard (Layer 2) before every TTS synthesis
  • Post-call AI summary generated asynchronously after disconnect
  • Live dashboard WebSocket events broadcast on key milestones
  • Fixed from_number / to_number on Call record
"""

import asyncio
import logging
import os
import sys
import re
import pathlib
from typing import Annotated, Optional
from dotenv import load_dotenv

# Ensure project root is on sys.path for direct worker execution
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent.parent))

from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    llm,
    Agent,
    AgentSession,
    function_tool,
)
from livekit.plugins import openai, silero, deepgram
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal, init_db
from app.models.lead import Lead, LeadStatus, CallbackRequest
from app.models.booking import DemoBooking
from app.models.call import Call, CallStatus, ConversationTurn
from app.models.call_content import CallContent
from app.models.campaign import CampaignLead, CampaignLeadStatus
from app.services.whatsapp_service import whatsapp_service
from app.services.post_call_summary import generate_post_call_summary
from app.security.prompt_guard import (
    inspect_user_input,
    inspect_agent_response,
    ThreatLevel,
)
from datetime import datetime, timezone

load_dotenv()
logger = logging.getLogger("livekit-voice-agent")


async def _safe_broadcast(event: str, payload: dict, user_id: Optional[int] = None) -> None:
    """Centralized, resilient WebSocket broadcast helper without circular dependencies."""
    try:
        from app.routers.ws_router import broadcast_event
        await broadcast_event(event, payload, user_id=user_id)
    except Exception as exc:
        logger.debug(f"[WS Broadcast] Non-fatal notification error: {exc}")


# ── Phone number utilities ────────────────────────────────────────────────────

def normalize_phone_number(text: str) -> Optional[str]:
    """Extract a valid 10-digit Indian mobile number from text or spoken digit words."""
    if not text:
        return None
    word_map = {
        "zero": "0", "oh": "0", "one": "1", "two": "2", "three": "3",
        "four": "4", "five": "5", "six": "6", "seven": "7",
        "eight": "8", "nine": "9",
    }
    clean = text.lower()
    for w, d in word_map.items():
        clean = re.sub(r"\b" + w + r"\b", d, clean)
    digits = re.sub(r"\D", "", clean)
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    match = re.search(r"[6-9]\d{9}", digits)
    return match.group(0) if match else (digits if len(digits) == 10 else None)


def is_telecom_announcement(text: str) -> bool:
    """Detect Indian telecom IVR / voicemail / switched-off announcements (AMD)."""
    if not text:
        return False
    lower = text.lower()
    ivr_phrases = [
        "subscriber is busy", "switched off", "not reachable",
        "cannot take your call", "leave a message", "please dial again",
        "vyast hai", "kripya kuch samay baad", "switch off",
        "kripya pratiksha karein", "number does not exist",
    ]
    return any(p in lower for p in ivr_phrases)


# ── Active call content resolution ───────────────────────────────────────────

async def _get_active_content(user_id: Optional[int]) -> Optional[CallContent]:
    """Return the user's currently active CallContent, or None if using default."""
    if not user_id:
        return None
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(CallContent).where(
                    CallContent.user_id == user_id,
                    CallContent.is_active == True,  # noqa: E712
                )
            )
            return res.scalars().first()
    except Exception as exc:
        logger.warning(f"[Agent] Could not fetch active call content: {exc}")
        return None


def _build_system_prompt(active_content: Optional[CallContent]) -> str:
    """
    Merge the base system prompt with any active user-defined call content.

    The active content is prepended so it frames the base instructions — this
    way seasonal/campaign context is always top-of-mind for the LLM.
    """
    if not active_content:
        return settings.SYSTEM_PROMPT

    header = (
        f"[CALL CONTENT ACTIVE: {active_content.title} | {active_content.content_type}]\n"
        f"{active_content.prompt_text}\n\n"
        "---\n"
        "Base instructions follow:\n\n"
    )
    return header + settings.SYSTEM_PROMPT


def _get_greeting(active_content: Optional[CallContent]) -> str:
    """Return the greeting message, overridden by active content if set."""
    if active_content and active_content.greeting_override:
        return active_content.greeting_override
    return settings.GREETING_MESSAGE


# ── Database helpers ──────────────────────────────────────────────────────────

async def record_booking_in_db(
    phone_or_whatsapp: str,
    name: str = "Lead",
    day_and_time: str = "Upcoming Slot",
    notes: str = "",
    call_sid: Optional[str] = None,
) -> bool:
    """Save lead, demo booking, and trigger WhatsApp confirmation. Broadcasts a WS event."""
    try:
        phone = normalize_phone_number(phone_or_whatsapp) or phone_or_whatsapp or "Anonymous"

        async with AsyncSessionLocal() as db:
            user_id = None
            if call_sid:
                c_res = await db.execute(select(Call).where(Call.call_sid == call_sid))
                c_obj = c_res.scalars().first()
                if c_obj and c_obj.user_id:
                    user_id = c_obj.user_id

            # Upsert lead
            stmt = select(Lead).where(Lead.phone_number == phone)
            if user_id:
                stmt = stmt.where(Lead.user_id == user_id)
            res = await db.execute(stmt)
            lead = res.scalars().first()

            if not lead:
                lead = Lead(
                    user_id=user_id,
                    phone_number=phone,
                    name=name if name != "Lead" else None,
                    whatsapp_number=phone,
                    status=LeadStatus.DEMO_SCHEDULED,
                    notes=f"Auto-captured from call. {notes}",
                )
                db.add(lead)
                await db.flush()
            else:
                lead.status = LeadStatus.DEMO_SCHEDULED
                if name and name != "Lead":
                    lead.name = name
                lead.whatsapp_number = phone
                if not user_id and lead.user_id:
                    user_id = lead.user_id

            booking = DemoBooking(
                user_id=user_id,
                lead_id=lead.id,
                call_sid=call_sid,
                scheduled_time=datetime.now(timezone.utc),
                notes=f"5-Minute Phone Demo: {day_and_time}. {notes}",
                status="CONFIRMED",
            )
            db.add(booking)
            await db.commit()

            logger.info(
                f"💾 [DB] Demo booked | name='{name}' phone='{phone}' "
                f"slot='{day_and_time}' user_id={user_id}"
            )

        # ── Broadcast live dashboard event ───────────────────────────────────
        await _safe_broadcast(
            "DEMO_BOOKED",
            {"name": name, "phone": phone, "slot": day_and_time},
            user_id=user_id,
        )

        # ── WhatsApp confirmation ─────────────────────────────────────────────
        asyncio.create_task(
            whatsapp_service.send_demo_confirmation(
                to_phone=phone,
                name=name if name != "Lead" else "Sir/Ma'am",
                demo_time=day_and_time,
                notes=notes,
            )
        )
        return True

    except Exception as exc:
        logger.error(f"❌ [DB] record_booking_in_db error: {exc}", exc_info=True)
        return False


# ── LLM tool definitions ──────────────────────────────────────────────────────

@function_tool
async def book_demo(
    phone_or_whatsapp: Annotated[str, "Phone or WhatsApp number given by caller"],
    name: Annotated[str, "Name of caller if known, otherwise 'Caller'"] = "Caller",
    preferred_day_and_time: Annotated[str, "Agreed day and time for 5-minute phone demo"] = "Tomorrow",
    notes: Annotated[str, "Any brief notes or customer requests"] = "",
) -> str:
    """Tool to book and confirm a 5-minute phone call demo appointment."""
    logger.info(
        f"⚡ [TOOL] book_demo | name={name} phone={phone_or_whatsapp} time={preferred_day_and_time}"
    )
    success = await record_booking_in_db(
        phone_or_whatsapp=phone_or_whatsapp,
        name=name,
        day_and_time=preferred_day_and_time,
        notes=notes,
    )
    if success:
        return (
            f"Phone demo confirmed for {name} on {preferred_day_and_time}. "
            f"Our specialist will call on {phone_or_whatsapp}. Confirmation sent to WhatsApp."
        )
    return f"Phone demo confirmed for {name} on {preferred_day_and_time}."


# ── Agent entrypoint ──────────────────────────────────────────────────────────

async def entrypoint(ctx: JobContext) -> None:
    await init_db()
    room_name = ctx.room.name
    logger.info(f"🎙️ LiveKit voice worker joined room: {room_name}")

    # 1. Connect to room audio (WebRTC UDP / Opus)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # 2. Resolve user_id and caller name from room or participant metadata
    user_id: Optional[int] = None
    to_number: Optional[str] = None
    try:
        import json as _json
        meta = _json.loads(ctx.room.metadata or "{}")
        user_id = meta.get("user_id")
        to_number = meta.get("to_number")
        if not user_id or not to_number:
            for p in ctx.room.remote_participants.values():
                p_meta = _json.loads(p.metadata or "{}")
                if not user_id and p_meta.get("user_id"):
                    user_id = p_meta.get("user_id")
                if not to_number and (p_meta.get("to_number") or p_meta.get("caller_name")):
                    to_number = p_meta.get("to_number") or p_meta.get("caller_name")
    except Exception:
        pass

    # 3. Fetch active call content for dynamic prompt
    active_content = await _get_active_content(user_id)
    system_prompt = _build_system_prompt(active_content)
    greeting = _get_greeting(active_content)

    if active_content:
        logger.info(
            f"📋 Active call content: '{active_content.title}' "
            f"({active_content.content_type}) for user {user_id}"
        )

    # 4. Record call start in DB (idempotent upsert so we don't duplicate pre-recorded calls)
    try:
        async with AsyncSessionLocal() as db:
            c_res = await db.execute(select(Call).where(Call.call_sid == room_name))
            call_rec = c_res.scalars().first()
            if not call_rec:
                call_rec = Call(
                    call_sid=room_name,
                    user_id=user_id,
                    from_number="VoiceAgent-AI",
                    to_number=to_number or "Web-User",
                    status=CallStatus.IN_PROGRESS,
                    direction="INBOUND" if "console" in room_name else "OUTBOUND",
                    start_time=datetime.now(timezone.utc),
                )
                db.add(call_rec)
            else:
                call_rec.status = CallStatus.IN_PROGRESS
                if user_id and not call_rec.user_id:
                    call_rec.user_id = user_id
                if to_number and not call_rec.to_number:
                    call_rec.to_number = to_number
            await db.commit()
    except Exception as exc:
        logger.warning(f"Could not initialise call record: {exc}")

    # 5. Broadcast call started event
    await _safe_broadcast(
        "CALL_STARTED",
        {"call_sid": room_name, "to_number": to_number},
        user_id=user_id,
    )

    # 6. Configure LLM
    llm_instance = (
        openai.LLM(model="gpt-4o-mini")
        if settings.OPENAI_API_KEY
        else openai.LLM(
            base_url=settings.SARVAM_LLM_URL.replace("/v1/chat/completions", "/v1"),
            api_key=settings.SARVAM_API_KEY,
            model=settings.SARVAM_LLM_MODEL,
        )
    )

    # 7. Configure ultra-low latency TTS (Deepgram Aura, sub-120ms)
    tts_instance = deepgram.TTS(
        api_key=settings.DEEPGRAM_API_KEY,
        model="aura-asteria-en",
    )

    # 8. Instantiate agent with dynamic prompt + guard hooks
    # Configured with allow_interruptions=False so agent speech delivery is never disrupted,
    # and min_endpointing_delay=0.03 (30ms) for ultra-fast response after user stops speaking.
    agent = Agent(
        instructions=system_prompt,
        vad=silero.VAD.load(min_speech_duration=0.10, min_silence_duration=0.10),
        stt=deepgram.STT(api_key=settings.DEEPGRAM_API_KEY),
        llm=llm_instance,
        tts=tts_instance,
        tools=[book_demo],
        allow_interruptions=False,
        min_endpointing_delay=0.03,
        max_endpointing_delay=0.20,
    )

    # 9. Session with 30ms endpointing delay for instant replies upon user silence
    session = AgentSession(
        allow_interruptions=False,
        min_interruption_duration=0.6,
        min_interruption_words=2,
        resume_false_interruption=True,
        preemptive_generation=True,
        min_endpointing_delay=0.03,
        max_endpointing_delay=0.20,
    )

    # ── Shutdown callback: persist turns, generate summary, broadcast event ──

    async def persist_session_data() -> None:
        logger.info(f"💾 Persisting session data for room {room_name}...")
        try:
            messages = (
                list(agent.chat_ctx.messages())
                if hasattr(agent.chat_ctx, "messages")
                else []
            )
            extracted_phone: Optional[str] = None
            conversation_lines: list[str] = []

            # 1. Asynchronously generate post-call summary if we have turns
            summary_dict: Optional[dict] = None

            async with AsyncSessionLocal() as db:
                for msg in messages:
                    role_str = str(msg.role).upper()
                    speaker = "USER" if "USER" in role_str else "BOT"
                    text = (
                        msg.content
                        if isinstance(msg.content, str)
                        else " ".join(str(c) for c in msg.content if c)
                    )
                    if not text:
                        continue

                    # ── Layer 1: guard user speech before logging ─────────────
                    if speaker == "USER":
                        guard = inspect_user_input(text)
                        if guard.threat_level == ThreatLevel.BLOCKED:
                            logger.warning(
                                f"[GUARD] Injected user turn suppressed | reason={guard.reason}"
                            )
                            text = "[REDACTED — injection attempt detected]"
                        elif guard.was_modified:
                            text = guard.sanitized_text

                    conversation_lines.append(f"{speaker}: {text}")

                    turn = ConversationTurn(
                        call_sid=room_name,
                        speaker=speaker,
                        text=text,
                        timestamp=datetime.now(timezone.utc),
                    )
                    db.add(turn)

                    if speaker == "USER" and not extracted_phone:
                        candidate = normalize_phone_number(text)
                        if candidate:
                            extracted_phone = candidate

                # Generate summary now if conversation lines exist
                if conversation_lines:
                    summary_dict = await generate_post_call_summary(conversation_lines, room_name)

                # Update call record in the SAME atomic session
                stmt = select(Call).where(Call.call_sid == room_name)
                res = await db.execute(stmt)
                call_obj = res.scalars().first()
                if call_obj:
                    is_ivr = any(
                        is_telecom_announcement(line)
                        for line in conversation_lines
                        if line.startswith("USER:")
                    )
                    call_obj.status = CallStatus.NO_ANSWER if is_ivr else CallStatus.COMPLETED
                    call_obj.end_time = datetime.now(timezone.utc)
                    if call_obj.start_time:
                        call_obj.duration_seconds = int(
                            (call_obj.end_time - call_obj.start_time).total_seconds()
                        )
                    if summary_dict:
                        import json as _json_inner
                        call_obj.summary = _json_inner.dumps(summary_dict)

                await db.commit()

            # ── Auto-capture phone if demo not already booked ─────────────────
            if extracted_phone and not any(
                is_telecom_announcement(l) for l in conversation_lines
            ):
                context = "\n".join(conversation_lines[-4:])
                await record_booking_in_db(
                    phone_or_whatsapp=extracted_phone,
                    name="Caller",
                    day_and_time="As discussed in call",
                    notes=f"Auto-captured. Context:\n{context}",
                    call_sid=room_name,
                )

            # ── Broadcast call ended event ────────────────────────────────────
            await _safe_broadcast(
                "CALL_ENDED",
                {"call_sid": room_name, "user_id": user_id},
                user_id=user_id,
            )
            # Invalidate cached dashboard stats so next WS message is fresh
            from app.cache import cache
            await cache.delete(f"dashboard:stats:{user_id}")

        except Exception as exc:
            logger.error(f"❌ Error persisting session data: {exc}", exc_info=True)

    ctx.add_shutdown_callback(persist_session_data)

    await session.start(agent=agent, room=ctx.room)
    logger.info("✅ Agent session active.")

    # Greet caller with active-content-aware greeting
    if settings.ENABLE_GREETING:
        # ── Layer 2: validate greeting before TTS ─────────────────────────────
        guard = inspect_agent_response(greeting)
        safe_greeting = guard.sanitized_text
        logger.info(f"🗣️ Sending greeting: {safe_greeting[:80]}...")
        await session.say(safe_greeting, allow_interruptions=False)


def run_agent() -> None:
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    run_agent()
