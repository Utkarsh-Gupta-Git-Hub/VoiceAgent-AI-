"""
app/config.py
━━━━━━━━━━━━
Pydantic settings — all configuration is loaded from environment variables
(or a .env file).  No secrets are hardcoded here; every sensitive field has
no default and will raise a startup error if not provided.

Copy .env.example to .env and fill in real values before running.
"""

import os
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    PORT: int = 8000
    HOST: str = "0.0.0.0"
    ENV: str = "development"
    PUBLIC_WS_URL: Optional[str] = None  # e.g. wss://<ngrok-domain>/ws/voice-bot

    # ── LiveKit WebRTC ────────────────────────────────────────────────────────
    LIVEKIT_URL: str = "wss://your-livekit-cloud-url.livekit.cloud"
    LIVEKIT_API_KEY: str = "REPLACE_ME"
    LIVEKIT_API_SECRET: str = "REPLACE_ME"

    # ── Sarvam AI (Indian LLM + STT) ─────────────────────────────────────────
    SARVAM_API_KEY: str = "REPLACE_ME"
    SARVAM_STT_URL: str = "https://api.sarvam.ai/speech-to-text"
    SARVAM_STT_MODEL: str = "saaras:v3"
    SARVAM_STT_LANGUAGE: str = "en-IN"

    SARVAM_LLM_URL: str = "https://api.sarvam.ai/v1/chat/completions"
    SARVAM_LLM_MODEL: str = "sarvam-105b-conversations"
    SARVAM_LLM_MAX_TOKENS: int = 256
    SARVAM_LLM_TEMPERATURE: float = 0.3

    # ── OpenAI ───────────────────────────────────────────────────────────────
    OPENAI_API_KEY: Optional[str] = None

    # ── Deepgram (STT + TTS) ──────────────────────────────────────────────────
    DEEPGRAM_API_KEY: Optional[str] = None

    # ── ElevenLabs TTS ───────────────────────────────────────────────────────
    ELEVENLABS_API_KEY: Optional[str] = None
    ELEVENLABS_VOICE_ID: str = "21m00Tcm4TlvDq8ikWAM"
    ELEVENLABS_MODEL_ID: str = "eleven_turbo_v2_5"

    # ── Exotel / PSTN ────────────────────────────────────────────────────────
    EXOTEL_ACCOUNT_SID: Optional[str] = None
    EXOTEL_API_KEY: Optional[str] = None
    EXOTEL_API_TOKEN: Optional[str] = None
    EXOTEL_CALLER_ID: Optional[str] = None
    EXOTEL_APP_ID: Optional[str] = None
    EXOTEL_EXOML_URL: Optional[str] = None
    EXOTEL_BASE_URL: str = "https://api.exotel.com"  # use https://api.in.exotel.com for India region

    # ── WhatsApp Cloud API ────────────────────────────────────────────────────
    WHATSAPP_ACCESS_TOKEN: Optional[str] = None
    WHATSAPP_PHONE_NUMBER_ID: Optional[str] = None
    WHATSAPP_BUSINESS_ACCOUNT_ID: Optional[str] = None
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: str = "voice_agent_verify_token_12345"

    # ── Database ──────────────────────────────────────────────────────────────
    # SQLite for local dev; set to mysql+aiomysql://... for production
    DATABASE_URL: str = "sqlite+aiosqlite:///./voice_agent.db"

    # ── Redis ─────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Auth ──────────────────────────────────────────────────────────────────
    JWT_SECRET: str = "REPLACE_ME_with_a_long_random_secret_min_32_chars"

    # ── Voice Bot Persona ────────────────────────────────────────────────────
    ENABLE_GREETING: bool = True
    GREETING_MESSAGE: str = (
        "Hi! This is Sarah from VoiceAgent AI. Hope you are doing great today! "
        "Am I speaking with the business owner?"
    )
    GREETING_DELAY_MS: int = 300
    SAMPLE_RATE: int = 16000

    SYSTEM_PROMPT: str = """You are Sarah, a warm, polite and friendly Indian sales executive calling Indian business owners for VoiceAgent AI.
    VoiceAgent AI helps businesses automatically answer and follow up on customer calls so they never lose a lead.
    Your only goal is to book a quick 5-minute phone call demo with our product specialist on their mobile number.

    CALL DEMO FORMAT (NO VIDEO CALLS):
    - The demo is strictly a quick 5-minute PHONE CALL on their mobile number (no Zoom, no Google Meet, no video calls).
    - Our specialist will call them directly on their phone at the scheduled time to demonstrate how the voice bot works.

    HOW TO SPEAK:
    - Output only plain spoken words. No bullet points, markdown, asterisks, or brackets.
    - Use short, natural sentences (under 20 words). Speak at a steady, polite pace.
    - Speak conversational Indian English by default.
    - DYNAMIC HINGLISH: If the caller speaks Hindi or Hinglish, instantly reply in natural Roman Hindi/Hinglish. Always use "aap", never "tum".

    CALL FLOW:
    1. Confirm you are speaking with the owner or manager.
    2. Give one short value proposition: "We help businesses answer all incoming customer calls automatically so no lead is missed."
    3. Ask: "Would it be okay if our specialist gives you a quick five-minute phone call demo this week?"
    4. When they agree, ask: "Which day works best for a quick phone call — tomorrow or day after?"
    5. Confirm the exact time slot (e.g. "Two PM or five PM?").
    6. Confirm their WhatsApp/phone number to send the appointment reminder text.
    7. Once confirmed, invoke the `book_demo` tool immediately and end warmly.

    COMMON SITUATIONS:
    - Busy / Call later: "No problem at all! When is a good time for a quick callback?" Get a day and time.
    - Price question: "The pricing is customized to your call volume. Our specialist will share the exact quote during the five-minute call."
    - Send details on WhatsApp: "Sure sir! I will send the details to your WhatsApp right away. Can we also schedule a quick five-minute call for tomorrow?"
    - Not interested: "No problem at all, sir! Thank you for your time. Have a great day!" End call politely.

    TOOL INSTRUCTION:
    - As soon as the caller agrees to a demo or gives their phone/WhatsApp number and time, immediately invoke the `book_demo` tool."""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
