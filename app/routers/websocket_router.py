import json
import base64
import asyncio
import logging
from contextlib import aclosing
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.audio.audio_buffer import AudioBuffer
from app.audio.resampler import downsample_16k_to_8k, chunk_telephony_audio
from app.services.sarvam_stt import sarvam_stt_service
from app.services.sarvam_llm import sarvam_chat_service
from app.services.elevenlabs_tts import elevenlabs_tts_service
from app.services.intent_detector import intent_detector
from app.models.call import Call, CallStatus, ConversationTurn
from app.models.lead import Lead, LeadStatus
from app.models.booking import DemoBooking

logger = logging.getLogger(__name__)

router = APIRouter()

class CallSession:
    def __init__(self, call_sid: str, system_prompt: str, is_telephony: bool = False):
        self.call_sid = call_sid
        self.stream_sid = None
        self.is_telephony = is_telephony
        self.sample_rate = 8000 if is_telephony else 16000
        self.active = True
        self.call_started = False
        self.greeting_played = False
        self.bot_speaking = False  # True only while audio is actually being streamed
        self.interruptible = True  # greeting is played in full; replies can be interrupted
        self.bot_busy = False      # True from synthesis start until playback ends
        self.history = [{"role": "system", "content": system_prompt}]
        self.lead_id = None

    def add_user(self, text: str):
        self.history.append({"role": "user", "content": text})

    def add_assistant(self, text: str):
        self.history.append({"role": "assistant", "content": text})

@router.websocket("/ws/voice-bot")
async def voice_bot_websocket(websocket: WebSocket, callSid: str = None):
    await websocket.accept()
    
    session_id = f"sess_{id(websocket)}"
    initial_call_sid = callSid or f"call_{session_id}"
    
    logger.info(f"WebSocket connected: sessionId={session_id}, callSid={initial_call_sid}")
    
    call_session = CallSession(initial_call_sid, settings.SYSTEM_PROMPT)
    audio_buffer = AudioBuffer(sample_rate=call_session.sample_rate)
    call_session.reset_audio = audio_buffer.reset

    # 1. Start background loops
    async def process_audio_loop():
        """Listens for user speech completion in audio buffer and executes AI turn."""
        while call_session.active:
            await asyncio.sleep(0.05)

            if not call_session.greeting_played or call_session.bot_busy or not call_session.active:
                continue

            if not audio_buffer.is_ready():
                continue

            try:
                if await handle_user_turn():
                    break  # call is ending
            except asyncio.CancelledError:
                raise
            except Exception as e:
                # One failed turn (network blip, bad payload) must not stop the bot listening.
                logger.error(f"[{call_session.call_sid}] Turn failed, still listening: {e}")
                call_session.bot_busy = False
                call_session.bot_speaking = False

    async def handle_user_turn() -> bool:
        """Runs one user -> bot exchange. Returns True when the call should end."""
        pcm_data = audio_buffer.drain()
        if not pcm_data:
            return False

        logger.info(f"[{call_session.call_sid}] Transcribing {len(pcm_data)} bytes of user audio...")
        user_text = await sarvam_stt_service.transcribe(pcm_data, sample_rate=call_session.sample_rate)
        if not user_text or not user_text.strip():
            return False

        # Prevent echo
        if is_self_echo(user_text, call_session):
            return False

        logger.info(f"[{call_session.call_sid}] USER: {user_text}")
        call_session.add_user(user_text)

        # Send user transcript event to UI
        await send_user_transcript(websocket, user_text)
        await save_turn_to_db(call_session.call_sid, "USER", user_text)

        # Intent Check (Booking, Callback, or Disconnect)
        intent_reply, scheduled_time, intent_type = intent_detector.detect_intent(user_text)
        if intent_reply:
            if intent_reply == intent_detector.END_CALL:
                await end_call_with_farewell(websocket, call_session, "No problem at all! Have a great day. Goodbye!")
                return True

            # Persist demo booking if scheduled
            if intent_type == "BOOKING" and scheduled_time:
                await record_booking_to_db(call_session.call_sid, scheduled_time, f"Voice call intent: {user_text}")

            await end_call_with_farewell(websocket, call_session, intent_reply)
            return True

        # LLM Chat completion
        bot_text = await sarvam_chat_service.chat(call_session.history)
        logger.info(f"[{call_session.call_sid}] BOT: {bot_text}")
        call_session.add_assistant(bot_text)
        await save_turn_to_db(call_session.call_sid, "BOT", bot_text)

        # If the AI itself is wrapping up the call, hang up right after it speaks.
        lowered = bot_text.lower()
        if any(p in lowered for p in ("goodbye", "good bye", "have a great day", "have a nice day", "take care")):
            await speak(websocket, call_session, bot_text, interruptible=False)
            await asyncio.sleep(0.8)
            call_session.active = False
            try:
                await websocket.close(code=1000)
                logger.info(f"[{call_session.call_sid}] Call hung up (AI said goodbye).")
            except Exception:
                pass
            return True

        await speak(websocket, call_session, bot_text)
        return False

    async def greeting_task():
        """Plays greeting once start event is received."""
        while call_session.active and not call_session.call_started:
            await asyncio.sleep(0.1)

        if not call_session.active:
            return

        await asyncio.sleep(max(settings.GREETING_DELAY_MS, 200) / 1000.0)
        
        if settings.ENABLE_GREETING and not call_session.greeting_played and call_session.active:
            call_session.greeting_played = True
            greeting = settings.GREETING_MESSAGE
            logger.info(f"[{call_session.call_sid}] BOT (greeting): {greeting}")
            
            call_session.add_assistant(greeting)
            await save_turn_to_db(call_session.call_sid, "BOT", greeting)
            await speak(websocket, call_session, greeting, interruptible=False)
        else:
            call_session.greeting_played = True

    audio_task = asyncio.create_task(process_audio_loop())
    greet_task = asyncio.create_task(greeting_task())

    try:
        while True:
            msg_text = await websocket.receive_text()
            data = json.loads(msg_text)
            event = data.get("event", "").lower()

            if event == "connected":
                logger.info(f"[{call_session.call_sid}] Client connected event received")

            elif event == "start":
                stream_sid = (
                    data.get("stream_sid") or 
                    data.get("streamSid") or 
                    data.get("start", {}).get("stream_sid") or 
                    data.get("start", {}).get("streamSid") or 
                    f"stream_{session_id}"
                )
                call_session.stream_sid = stream_sid
                
                extracted_call_sid = (
                    data.get("start", {}).get("call_sid") or 
                    data.get("start", {}).get("callSid") or 
                    data.get("call_sid") or 
                    data.get("callSid")
                )
                if extracted_call_sid:
                    if callSid and callSid != extracted_call_sid:
                        await link_call_record(callSid, extracted_call_sid)
                    call_session.call_sid = extracted_call_sid

                # Detect if this is an Exotel telephony stream
                if "exotel" in msg_text.lower() or "stream_sid" in data:
                    call_session.is_telephony = True
                    call_session.sample_rate = 8000
                    audio_buffer = AudioBuffer(sample_rate=8000)
                    call_session.reset_audio = audio_buffer.reset

                logger.info(f"[{call_session.call_sid}] Call started. streamSid={stream_sid}, telephony={call_session.is_telephony}")
                call_session.call_started = True

            elif event == "media":
                if call_session.greeting_played:
                    payload_b64 = data.get("media", {}).get("payload", "")
                    if payload_b64:
                        chunk = base64.b64decode(payload_b64)
                        audio_buffer.append(chunk)

                        # Barge-In: only while bot audio is really playing, and only on sustained speech
                        if call_session.bot_speaking and call_session.interruptible and audio_buffer.consumes_barge_in():
                            logger.info(f"[{call_session.call_sid}] BARGE-IN DETECTED: Halting bot playback immediately.")
                            call_session.bot_speaking = False
                            audio_buffer.reset()
                            await send_clear_event(websocket, call_session.stream_sid)

            elif event == "bot_speech_done":
                logger.info(f"[{call_session.call_sid}] Bot finished speaking on client.")
                call_session.bot_speaking = False
                audio_buffer.reset()

            elif event == "stop":
                logger.info(f"[{call_session.call_sid}] Stop event received from client.")
                break

    except WebSocketDisconnect:
        logger.info(f"[{call_session.call_sid}] WebSocket disconnected.")
    except Exception as e:
        if call_session.active:
            logger.error(f"[{call_session.call_sid}] WebSocket handler error: {e}")
        else:
            logger.info(f"[{call_session.call_sid}] Stream closed after hang-up.")
    finally:
        call_session.active = False
        audio_task.cancel()
        greet_task.cancel()
        await update_call_status(call_session.call_sid, CallStatus.COMPLETED)
        # Post-call analysis (summary, sentiment, outcome) runs in the background.
        asyncio.create_task(finalize_call(call_session.call_sid))

async def speak(websocket: WebSocket, call_session: CallSession, text: str, interruptible: bool = True):
    """Synthesizes TTS audio and streams it to the client/telephony stream."""
    if not call_session.active:
        return

    call_session.bot_busy = True
    call_session.interruptible = interruptible
    try:
        reset = getattr(call_session, "reset_audio", None)

        if call_session.is_telephony:
            # Stream: playback starts on the first audio bytes (low latency), paced in
            # 40ms packets so Exotel's jitter buffer plays in real time.
            packet_bytes = 40 * 16  # 8kHz, 16-bit mono
            pending = bytearray()
            sent_any = False

            async def flush(final: bool = False):
                nonlocal sent_any
                while len(pending) >= packet_bytes or (final and pending):
                    if not call_session.active or not call_session.bot_speaking:
                        pending.clear()
                        return
                    chunk = bytes(pending[:packet_bytes])
                    del pending[:packet_bytes]
                    await websocket.send_json({
                        "event": "media",
                        "stream_sid": call_session.stream_sid,
                        "media": {"payload": base64.b64encode(chunk).decode("utf-8")}
                    })
                    sent_any = True
                    await asyncio.sleep(0.038)

            started = False
            async with aclosing(elevenlabs_tts_service.stream_pcm(text, sample_rate=call_session.sample_rate)) as audio_stream:
                async for audio in audio_stream:
                    if not call_session.active:
                        return
                    if not started:
                        # First audio has arrived: the caller starts hearing the bot now.
                        started = True
                        call_session.bot_speaking = True
                        if reset:
                            reset()
                    elif not call_session.bot_speaking:
                        break  # caller barged in while we waited for more audio
                    pending.extend(audio)
                    await flush()
                    if not call_session.bot_speaking:
                        break
            if call_session.bot_speaking:
                await flush(final=True)
            if not sent_any:
                logger.error(f"[{call_session.call_sid}] TTS returned no audio for: '{text[:40]}'")
        else:
            pcm_audio = await elevenlabs_tts_service.synthesize_pcm(text, sample_rate=call_session.sample_rate)
            if not call_session.active or not pcm_audio:
                return
            call_session.bot_speaking = True
            await websocket.send_json({
                "event": "speak",
                "text": text,
                "stream_sid": call_session.stream_sid or "web_stream",
                "media": {"payload": base64.b64encode(pcm_audio).decode("utf-8")}
            })
    except Exception as e:
        logger.error(f"[{call_session.call_sid}] Error sending speak event: {e}")
    finally:
        was_speaking = call_session.bot_speaking
        call_session.bot_speaking = False
        if call_session.is_telephony and was_speaking:
            await asyncio.sleep(0.4)  # let the tail of the audio play out before listening
        call_session.bot_busy = False
        reset = getattr(call_session, "reset_audio", None)
        if reset:
            reset()  # drop echo / noise captured while the bot was talking

async def end_call_with_farewell(websocket: WebSocket, call_session: CallSession, farewell_text: str):
    """Say goodbye (uninterruptible), then hang up by closing the media stream."""
    logger.info(f"[{call_session.call_sid}] Ending call with farewell: '{farewell_text}'")
    call_session.add_assistant(farewell_text)
    await save_turn_to_db(call_session.call_sid, "BOT", farewell_text)
    await speak(websocket, call_session, farewell_text, interruptible=False)
    await asyncio.sleep(0.8)  # let the last syllables finish playing on the phone

    call_session.active = False
    try:
        await websocket.send_json({"event": "stop", "stream_sid": call_session.stream_sid})
    except Exception:
        pass
    try:
        # Closing the stream ends the call: no further Exotel step follows it.
        await websocket.close(code=1000)
        logger.info(f"[{call_session.call_sid}] Call hung up (stream closed by agent).")
    except Exception:
        pass

async def send_clear_event(websocket: WebSocket, stream_sid: str):
    try:
        await websocket.send_json({
            "event": "clear",
            "stream_sid": stream_sid
        })
    except Exception as e:
        logger.error(f"Failed sending clear event: {e}")

async def send_user_transcript(websocket: WebSocket, text: str):
    try:
        await websocket.send_json({
            "event": "user_transcript",
            "text": text
        })
    except Exception as e:
        logger.error(f"Failed sending user transcript: {e}")

def is_self_echo(user_text: str, call_session: CallSession) -> bool:
    if not user_text or not user_text.strip():
        return True
    clean_user = user_text.strip().lower().strip(".!?, ")
    if len(clean_user.split()) < 4:
        return False  # short answers ("yes", "okay", "tomorrow") are real replies
    for msg in reversed(call_session.history):
        if msg.get("role") == "assistant":
            bot_text = msg.get("content", "").lower()
            if clean_user in bot_text:
                logger.warning(f"[{call_session.call_sid}] DROPPED SPEAKER ECHO: '{user_text}'")
                return True
            break
    return False

# Database helper functions
async def save_turn_to_db(call_sid: str, speaker: str, text: str):
    async with AsyncSessionLocal() as session:
        try:
            turn = ConversationTurn(call_sid=call_sid, speaker=speaker, text=text)
            session.add(turn)
            await session.commit()
        except Exception as e:
            logger.error(f"Failed saving turn to DB: {e}")

async def record_booking_to_db(call_sid: str, scheduled_time, notes: str):
    async with AsyncSessionLocal() as session:
        try:
            call_res = await session.execute(select(Call).where(Call.call_sid == call_sid))
            call_obj = call_res.scalars().first()
            user_id = call_obj.user_id if call_obj else None
            lead_id = None
            if call_obj and call_obj.to_number:
                digits = "".join(ch for ch in call_obj.to_number if ch.isdigit())[-10:]
                lead_stmt = select(Lead).where(Lead.phone_number.like(f"%{digits}"))
                if user_id:
                    lead_stmt = lead_stmt.where(Lead.user_id == user_id)
                lead_res = await session.execute(lead_stmt)
                lead_obj = lead_res.scalars().first()
                if lead_obj:
                    lead_id = lead_obj.id
                    lead_obj.status = LeadStatus.DEMO_SCHEDULED
                    if not user_id and lead_obj.user_id:
                        user_id = lead_obj.user_id

            booking = DemoBooking(
                user_id=user_id,
                lead_id=lead_id,
                call_sid=call_sid,
                scheduled_time=scheduled_time,
                notes=notes,
                status="CONFIRMED"
            )
            session.add(booking)
            await session.commit()
            logger.info(f"[{call_sid}] Persisted DemoBooking to database for {scheduled_time} (user_id={user_id})")
        except Exception as e:
            logger.error(f"Failed saving booking to DB: {e}")

async def finalize_call(call_sid: str):
    """After the call ends: build the transcript, generate the AI analysis, save it on the Call."""
    from datetime import datetime
    from app.services.post_call_summary import generate_post_call_summary
    from app.routers.ws_router import broadcast_event
    try:
        async with AsyncSessionLocal() as session:
            turns = (await session.execute(
                select(ConversationTurn).where(ConversationTurn.call_sid == call_sid).order_by(ConversationTurn.id)
            )).scalars().all()
            lines = [f"{'Sarah' if t.speaker == 'BOT' else 'Customer'}: {t.text}" for t in turns]

            summary = await generate_post_call_summary(lines, call_sid) if lines else None

            booking = (await session.execute(
                select(DemoBooking).where(DemoBooking.call_sid == call_sid).order_by(DemoBooking.id.desc())
            )).scalars().first()
            if summary is None and lines:
                summary = {"outcome": "INCOMPLETE", "sentiment": "NEUTRAL", "key_points": [], "objections": []}
            if summary is not None and booking:
                # The booking record is the source of truth for the outcome.
                summary["outcome"] = "DEMO_BOOKED"
                summary["demo_slot"] = booking.scheduled_time.strftime("%A, %d %b %Y %I:%M %p")

            call_obj = (await session.execute(select(Call).where(Call.call_sid == call_sid))).scalars().first()
            if call_obj:
                if summary is not None:
                    call_obj.summary = json.dumps(summary)
                call_obj.end_time = datetime.utcnow()
                if call_obj.start_time:
                    call_obj.duration_seconds = max(0, int((call_obj.end_time - call_obj.start_time).total_seconds()))
                await session.commit()
                # Event names match what the Dashboard listens for.
                await broadcast_event("CALL_ENDED", {
                    "call_sid": call_sid, "status": call_obj.status.value,
                    "duration": call_obj.duration_seconds,
                    "outcome": (summary or {}).get("outcome"),
                }, user_id=call_obj.user_id)
                if booking:
                    await broadcast_event("DEMO_BOOKED", {
                        "call_sid": call_sid, "name": call_obj.to_number,
                        "scheduled_time": booking.scheduled_time.isoformat(),
                    }, user_id=call_obj.user_id)
            logger.info(f"[{call_sid}] Post-call analysis saved: {summary}")
    except Exception as e:
        logger.error(f"[{call_sid}] Post-call analysis failed: {e}")


async def link_call_record(app_call_sid: str, exotel_call_sid: str):
    """Rename the UI-created call row to Exotel's call id (if not already done)."""
    async with AsyncSessionLocal() as session:
        try:
            exists = (await session.execute(select(Call).where(Call.call_sid == exotel_call_sid))).scalars().first()
            if exists:
                return
            row = (await session.execute(select(Call).where(Call.call_sid == app_call_sid))).scalars().first()
            if row:
                row.call_sid = exotel_call_sid
                await session.commit()
        except Exception as e:
            logger.error(f"Failed linking call record {app_call_sid} -> {exotel_call_sid}: {e}")


async def update_call_status(call_sid: str, status: CallStatus):
    async with AsyncSessionLocal() as session:
        try:
            result = await session.execute(select(Call).where(Call.call_sid == call_sid))
            call_obj = result.scalars().first()
            if call_obj:
                call_obj.status = status
                await session.commit()
        except Exception as e:
            logger.error(f"Failed updating call status: {e}")
