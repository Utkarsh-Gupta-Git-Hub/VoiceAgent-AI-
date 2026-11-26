"""
app/main.py
━━━━━━━━━━
VoiceAgent AI — FastAPI application entry point.

Registered services:
  - Auth (JWT)
  - LiveKit WebRTC token generation
  - Outbound call management
  - Leads / Contacts CRUD
  - Demo bookings
  - Outbound campaigns
  - WhatsApp Cloud API webhook
  - Call Content (dynamic scripts / seasonal prompts)
  - Live Dashboard WebSocket (Redis pub/sub fan-out)
  - React frontend (served as static files from ui/dist)
"""

import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.database import init_db

# ── Routers ──────────────────────────────────────────────────────────────────
from app.routers import token_router, call_router, lead_router, booking_router
from app.routers.whatsapp_router import router as whatsapp_router
from app.routers.campaign_router import router as campaign_router
from app.routers.auth_router import router as auth_router
from app.routers.call_content_router import router as call_content_router
from app.routers.exotel_router import router as exotel_router
from app.routers.websocket_router import router as voice_bot_router
from app.routers.ws_router import (
    router as ws_router,
    start_redis_subscriber,
    stop_redis_subscriber,
    start_heartbeat,
    stop_heartbeat,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("voice-agent-main")


# ── Application lifespan ──────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    logger.info("🗄️  Initialising database schema...")
    await init_db()

    # Connect Redis cache (graceful degradation if unavailable)
    from app.cache import cache
    await cache.connect()

    # Start WebSocket infrastructure
    await start_redis_subscriber()
    await start_heartbeat()

    logger.info("🚀 VoiceAgent AI Platform is ready!")
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("⏳ Shutting down VoiceAgent AI...")
    await stop_heartbeat()
    await stop_redis_subscriber()

    from app.cache import cache as _cache
    await _cache.disconnect()
    logger.info("✅ Shutdown complete.")


# ── Request / Correlation ID Middleware ──────────────────────────────────────

class RequestIdMiddleware(BaseHTTPMiddleware):
    """
    Attaches a unique X-Request-ID to every incoming request and outgoing response
    for distributed logging and telemetry correlation.
    """
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:12]}"
        request.state.request_id = request_id
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


# ── FastAPI application ───────────────────────────────────────────────────────

app = FastAPI(
    title="VoiceAgent AI — Indian B2B Voice Calling Platform",
    description=(
        "Ultra-low latency real-time voice sales platform powered by LiveKit WebRTC, "
        "Silero VAD, Deepgram STT/TTS, and GPT-4o-mini / Sarvam 105B. "
        "Features dynamic call content, Redis caching, prompt injection protection, "
        "and live dashboard WebSocket push."
    ),
    version="3.0.0",
    lifespan=lifespan,
)

# ── Middleware Stack ─────────────────────────────────────────────────────────

# 1. Request tracing correlation ID
app.add_middleware(RequestIdMiddleware)

# 2. Environment-aware CORS configuration (RFC compliant with credentials)
_cors_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]
_prod_origin = os.getenv("ALLOWED_ORIGINS")
if _prod_origin:
    _cors_origins.extend([o.strip() for o in _prod_origin.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

# ── API Routers ───────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(token_router)
app.include_router(call_router)
app.include_router(lead_router)
app.include_router(booking_router)
app.include_router(whatsapp_router)
app.include_router(campaign_router)
app.include_router(call_content_router)   # ← Dynamic call scripts
app.include_router(ws_router)             # ← Live dashboard WebSocket
app.include_router(exotel_router)         # ← Exotel Telephony Webhooks & ExoML
app.include_router(voice_bot_router)      # ← /ws/voice-bot: Exotel media stream (AI conversation)

# ── Health check ─────────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"])
async def health_check():
    """Service health probe — used by Docker / load-balancer."""
    from app.cache import cache
    return {
        "status": "UP",
        "version": "3.0.0",
        "service": "voice-agent-python",
        "transport": "WebRTC (UDP / Opus)",
        "livekit_url": settings.LIVEKIT_URL,
        "environment": settings.ENV,
        "redis": "connected" if cache.is_available else "unavailable (degraded mode)",
    }

# ── Serve React frontend (ui/dist built by Vite) ─────────────────────────────
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ui_dist = os.path.join(_project_root, "ui", "dist")
_ui_fallback = os.path.join(_project_root, "ui")
_ui_path = _ui_dist if os.path.exists(_ui_dist) else _ui_fallback

if os.path.exists(_ui_path):
    app.mount("/", StaticFiles(directory=_ui_path, html=True), name="ui")


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.ENV == "development",
    )
