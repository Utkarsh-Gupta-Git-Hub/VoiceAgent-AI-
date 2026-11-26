import uuid
import re
import time
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.config import settings
from app.models.call import Call, CallStatus
from app.models.user import User
from app.schemas.call import OutboundCallRequest, OutboundCallResponse, CallDetailSchema
from app.services.exotel_service import exotel_service
from app.routers.auth_router import get_current_user, require_user
from app.routers.ws_router import broadcast_event
from app.cache import cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/calls", tags=["Calls"])

# In-memory deduplication cache: phone_number -> timestamp of last initiated dial
_recent_dials: Dict[str, float] = {}
DIAL_COOLDOWN_SECONDS = 15.0

@router.post("/outbound", response_model=OutboundCallResponse)
async def initiate_call(
    req: OutboundCallRequest,
    current_user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Starts a voice call session.
    If target looks like an E.164 phone number and Exotel credentials exist, triggers an outbound PSTN call.
    Otherwise, returns the WebSocket URL for browser mic calling.
    """
    call_sid = f"web_call_{uuid.uuid4().hex[:8]}"
    user_id = current_user.id if current_user else None
    
    ws_base = getattr(settings, "PUBLIC_WS_URL", None) or f"ws://{settings.HOST}:{settings.PORT}/ws/voice-bot"
    ws_url = f"{ws_base}?callSid={call_sid}"

    new_call = Call(
        user_id=user_id,
        call_sid=call_sid,
        from_number="VoiceAgent-AI",
        to_number=req.to,
        caller_id="VoiceAgent-AI",
        status=CallStatus.QUEUED,
        start_time=datetime.now(timezone.utc),
        custom_field=req.customField
    )
    db.add(new_call)
    await db.commit()
    await db.refresh(new_call)

    # Invalidate dashboard cache for this user
    if user_id:
        await cache.delete(f"dashboard:stats:{user_id}")
        await broadcast_event("CALL_STARTED", {"call_sid": call_sid, "to": req.to}, user_id=user_id)

    # Trigger Exotel PSTN dial if phone number format with deduplication
    digits = re.sub(r"\D", "", req.to or "")
    if len(digits) >= 10 and settings.EXOTEL_ACCOUNT_SID:
        norm_number = digits[-10:]
        now = time.time()
        last_dial = _recent_dials.get(norm_number, 0.0)
        if now - last_dial < DIAL_COOLDOWN_SECONDS:
            logger.warning(
                f"[Call Deduplication] Dial request for {norm_number} blocked (called {now - last_dial:.1f}s ago). "
                "Preventing duplicate phone call."
            )
        else:
            _recent_dials[norm_number] = now
            result = await exotel_service.initiate_outbound_call(destination_number=req.to, custom_field=call_sid)
            exotel_sid = result.get("call_sid") if isinstance(result, dict) else None
            if exotel_sid:
                # Exotel streams audio tagged with ITS call id; adopt it so the transcript,
                # booking and analysis attach to this call record.
                new_call.call_sid = exotel_sid
                await db.commit()
                call_sid = exotel_sid

    return OutboundCallResponse(
        callSid=call_sid,
        wsUrl=ws_url,
        status=new_call.status.value
    )

@router.get("", response_model=List[CallDetailSchema])
async def list_calls(
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=200, description="Pagination limit"),
    current_user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db)
):
    """List recent call sessions, turns, and AI post-call summaries for current user."""
    result = await db.execute(
        select(Call)
        .options(selectinload(Call.turns))
        .where(Call.user_id == current_user.id)
        .order_by(Call.start_time.desc())
        .offset(offset)
        .limit(limit)
    )
    return result.scalars().all()
