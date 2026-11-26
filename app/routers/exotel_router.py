import logging
import re
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Request, Response, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.config import settings
from app.models.call import Call, CallStatus
from app.routers.ws_router import broadcast_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/exotel", tags=["Exotel Telephony Webhooks"])

@router.api_route("/exoml", methods=["GET", "POST"])
async def get_exoml(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Returns valid ExoML instructions when an Exotel call connects.
    If PUBLIC_WS_URL is set, pipes bidirectional streaming to WebSocket.
    Otherwise, speaks Sarah's sales greeting using Indian English telecom voice.
    """
    params = dict(request.query_params)
    if request.method == "POST":
        try:
            form = await request.form()
            params.update(dict(form))
        except Exception:
            pass

    call_sid = params.get("CallSid") or params.get("CallSid") or params.get("CustomField", "")
    from_number = params.get("From", "")
    logger.info(f"[ExoML] Request received: CallSid={call_sid}, From={from_number}")

    greeting = (
        getattr(settings, "GREETING_MESSAGE", "")
        or "Hi! This is Sarah from VoiceAgent AI. Hope you are doing great today! Am I speaking with the business owner?"
    )
    # Escape XML entities in greeting
    safe_greeting = (
        greeting.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )

    # Build absolute action callback URL for Exotel
    base_url = str(request.base_url).rstrip("/")
    if "ngrok" in base_url and base_url.startswith("http://"):
        base_url = base_url.replace("http://", "https://")
    callback_url = f"{base_url}/api/exotel/callback"

    # Fallback only: speak the greeting, then end the call cleanly via the status
    # callback. The real AI conversation runs through the Exotel Voicebot applet,
    # which streams audio to PUBLIC_WS_URL (/ws/voice-bot). Do NOT use this endpoint
    # as the outbound flow URL for live AI calls.
    exoml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="woman" language="en-IN">{safe_greeting}</Say>
    <Hangup/>
</Response>"""

    return Response(content=exoml.strip(), media_type="application/xml")

@router.api_route("/status", methods=["GET", "POST"])
@router.api_route("/callback", methods=["GET", "POST"])
async def exotel_status_callback(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Receives Exotel call status callbacks (ringing, in-progress, completed, failed, busy).
    Updates DB call state and broadcasts live WebSocket event.
    """
    data = dict(request.query_params)
    if request.method == "POST":
        try:
            form = await request.form()
            data.update(dict(form))
        except Exception:
            pass

    call_sid = data.get("CallSid") or data.get("CustomField", "").replace('"', '')
    status_str = (data.get("Status") or data.get("CallStatus") or "").lower()
    duration = int(data.get("Duration") or 0)
    recording_url = data.get("RecordingUrl", "")

    logger.info(f"[Exotel Callback] Sid={call_sid}, Status={status_str}, Duration={duration}")

    if call_sid:
        res = await db.execute(select(Call).where(Call.call_sid == call_sid))
        call_obj = res.scalars().first()
        if call_obj:
            if status_str in ["completed"]:
                call_obj.status = CallStatus.COMPLETED
            elif status_str in ["in-progress", "ringing", "answered"]:
                call_obj.status = CallStatus.IN_PROGRESS
            elif status_str in ["failed", "no-answer", "busy", "canceled"]:
                call_obj.status = CallStatus.FAILED

            if duration > 0:
                call_obj.duration_seconds = duration
            call_obj.end_time = datetime.now(timezone.utc)
            await db.commit()

            await broadcast_event("CALL_UPDATED", {
                "call_sid": call_sid,
                "status": call_obj.status.value,
                "duration": duration,
                "recording_url": recording_url
            }, user_id=call_obj.user_id)

    return {"status": "ok"}
