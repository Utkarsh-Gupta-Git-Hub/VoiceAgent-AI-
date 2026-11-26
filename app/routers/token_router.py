import uuid
import json
import logging
from typing import Optional
from fastapi import APIRouter, Query, HTTPException, Depends
from livekit import api
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.models.call import Call, CallStatus
from app.routers.auth_router import get_current_user
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/token", tags=["LiveKit WebRTC Tokens"])

@router.get("")
async def get_livekit_token(
    room_name: str = Query(default=None, description="LiveKit WebRTC Room Name"),
    participant_name: str = Query(default=None, description="Caller/User Name"),
    current_user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generates a cryptographically signed WebRTC connection token.
    The frontend uses this to connect directly to the LiveKit WebRTC audio room.
    """
    if not settings.LIVEKIT_API_KEY or not settings.LIVEKIT_API_SECRET:
        raise HTTPException(status_code=500, detail="LiveKit credentials missing in configuration")

    actual_room = room_name or f"room_console_{uuid.uuid4().hex[:8]}"
    
    # Resolve participant identity and name
    user_id = current_user.id if current_user else None
    resolved_name = (
        participant_name
        or (current_user.full_name if current_user else None)
        or "Web-User"
    )
    participant_identity = (
        f"user_{user_id}_{uuid.uuid4().hex[:4]}"
        if user_id
        else f"guest_{uuid.uuid4().hex[:6]}"
    )

    participant_metadata = json.dumps({
        "user_id": user_id,
        "to_number": resolved_name,
        "caller_name": resolved_name,
    })

    token = (
        api.AccessToken(
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET
        )
        .with_identity(participant_identity)
        .with_name(resolved_name)
        .with_metadata(participant_metadata)
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=actual_room,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
    )

    jwt_token = token.to_jwt()

    # Pre-create/record the call entry so it immediately appears in the Dashboard and Call Logs
    if user_id:
        try:
            existing_call = await db.execute(select(Call).where(Call.call_sid == actual_room))
            if not existing_call.scalars().first():
                new_call = Call(
                    user_id=user_id,
                    call_sid=actual_room,
                    from_number="VoiceAgent-AI",
                    to_number=resolved_name,
                    caller_id="VoiceAgent-AI",
                    status=CallStatus.IN_PROGRESS,
                    start_time=datetime.now(timezone.utc),
                    custom_field="webrtc_live_test",
                )
                db.add(new_call)
                await db.commit()
        except Exception as exc:
            logger.warning(f"Could not pre-record call session {actual_room}: {exc}")

    logger.info(
        f"Generated LiveKit WebRTC Token for identity={participant_identity} "
        f"name='{resolved_name}' in room={actual_room} user_id={user_id}"
    )

    return {
        "serverUrl": settings.LIVEKIT_URL,
        "roomName": actual_room,
        "participantIdentity": participant_identity,
        "token": jwt_token,
    }
