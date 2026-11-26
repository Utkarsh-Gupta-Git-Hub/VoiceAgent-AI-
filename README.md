# VoiceAgent AI 🎙️

> **Autonomous B2B Voice Sales Agent Platform for Indian Markets**

An AI-powered voice agent ("Sarah") that autonomously dials Indian business leads, conducts real-time sales conversations in **English and Hinglish**, handles objections, and books demo appointments — with sub-300ms conversational turn latency.

---

## ✨ What It Does

- 📞 **Dials leads automatically** via Exotel PSTN or browser WebRTC
- 🗣️ **Speaks naturally** in English + Hinglish using GPT-4o-mini / Sarvam 105B LLM
- 🧠 **Understands & responds** with sub-300ms turn latency (VAD → STT → LLM → TTS)
- 📅 **Books demo appointments** autonomously using an LLM tool call
- 📊 **Analyzes every call** — sentiment, engagement score, AI resistance, next actions
- 🔴 **Live dashboard** with real-time WebSocket call events and KPI analytics

---

## 🚀 Quick Start (Windows, one double-click)

1. Clone or download this repository.
2. Double-click **`setup_and_run.bat`**.
3. When Notepad opens (first run only), paste your API keys into `.env`, save, and close Notepad.

Or from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup_and_run.ps1
```

The script does everything in order and is safe to run again:

1. Finds or installs Python 3.10–3.13, Node.js 20.19+ and `cloudflared` (via `winget`)
2. Creates `.env` from `.env.example` and opens Notepad so you can add your API keys
3. Creates a Python virtual environment and installs backend packages
4. Installs UI packages
5. Opens a free public Cloudflare tunnel so Exotel can reach your laptop
6. Writes the tunnel address into `.env` (`PUBLIC_WS_URL`)
7. Starts the backend (port **8001**) and UI (port **5173**)
8. Opens **http://127.0.0.1:5173** in your browser

Then sign up, add a contact, and place a call. After the call, open **Call Logs** and **Bookings** to see the transcript and the AI post-call analysis.

Stop everything by double-clicking **`stop.bat`**.

The first run takes 5–10 minutes (package downloads). Later runs start in about a minute. The tunnel address changes on every run; the script updates `.env` automatically.

**Required keys in `.env`:** `SARVAM_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, and the `EXOTEL_*` values. The real `.env` is git-ignored, so never commit it. Logs are written to `backend.log`, `ui.err.log` and `cloudflared.log` in the project folder.

---

## 🏗️ Architecture

```
Lead / Customer
      │
      ▼
Exotel PSTN  ──or──  LiveKit WebRTC (UDP/Opus)
      │
      ▼
Silero VAD  →  Deepgram STT  →  GPT-4o-mini / Sarvam 105B
                                        │
               Prompt Guard L1 ◄────────┤────► Prompt Guard L2
                                        │
               Dynamic CallContent ─────┤  (Seasonal Scripts)
                                        │
                                  book_demo() tool
                                        │
              SQLAlchemy Async DB ◄─────┤─────► Redis Cache
                                        │
                                  Deepgram TTS
                                        │
                               Real-Time Audio Response
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Voice Transport** | LiveKit WebRTC · Opus Codec · UDP RTP |
| **Voice Activity Detection** | Silero VAD |
| **Speech-to-Text** | Deepgram Nova-2 |
| **Text-to-Speech** | Deepgram Aura (sub-120ms) |
| **LLM (Primary)** | OpenAI GPT-4o-mini |
| **LLM (Fallback / Indian Language)** | Sarvam 105B Conversations |
| **Backend** | FastAPI (async) · SQLAlchemy · Pydantic |
| **Database** | SQLite (dev) · PostgreSQL-ready |
| **Caching & Pub/Sub** | Redis async (graceful degradation) |
| **PSTN Outbound Calls** | Exotel REST API |
| **Security** | BCrypt · JWT · Dual-Layer Prompt Guard · Rate Limiting |
| **Frontend** | React 19 · Vite · Three.js · Framer Motion · Tailwind |
| **Real-Time Dashboard** | FastAPI WebSocket · Redis pub/sub fan-out |
| **Notifications** | WhatsApp Cloud API |

---

## 🔐 Security Features

- **Dual-layer LLM Prompt Injection Guard** — regex + semantic analysis on all user utterances and agent responses
- **BCrypt password hashing** with constant-time verification
- **JWT authentication** with strict `require_user` dependency (raises HTTP 401, never silent 200)
- **In-memory sliding-window rate limiting** on auth endpoints (5 req/min per IP, no external deps)
- **Pydantic field validation** with prompt injection checks on all call script create/update operations
- **X-Request-ID correlation ID middleware** for distributed log tracing
- **Environment-aware CORS** (not wildcard in production)

---

## 📊 AI Post-Call Intelligence

After every call, GPT-4o-mini / Sarvam automatically evaluates:

```json
{
  "outcome": "DEMO_BOOKED | CALLBACK_REQUESTED | NOT_INTERESTED | IVR_DETECTED",
  "sentiment": "POSITIVE | NEUTRAL | NEGATIVE",
  "engagement_score": 8,
  "connection_status": "GENUINE_CONVERSATION | EARLY_HANGUP | DISMISSED_AS_AI",
  "ai_hesitation": false,
  "key_points": ["Owner interested in automation", "Has 50+ calls/day"],
  "objections": ["Price not clear"],
  "next_action": "Schedule follow-up demo call",
  "confidence": 0.91
}
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- Redis (optional — graceful degradation if unavailable)
- API keys: OpenAI or Sarvam, Deepgram, LiveKit

### 1. Clone & Install
```bash
git clone https://github.com/Utkarsh-Gupta-Git-Hub/VoiceAgent-AI-.git
cd VoiceAgent-AI-

python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

### 2. Configure Environment
```bash
cp .env.example .env
# Fill in your API keys in .env
```

### 3. Start Backend
```bash
python -m uvicorn app.main:app --reload --port 8000
```

### 4. Start Frontend
```bash
cd ui
npm install
npm run dev
```

### 5. Start Voice Agent Worker
```bash
python -m app.livekit_agent.agent
```

---

## 📁 Project Structure

```
voice-agent-python/
├── app/
│   ├── main.py                    # FastAPI app + middleware + lifespan
│   ├── config.py                  # Pydantic settings
│   ├── database.py                # Async SQLAlchemy + schema migration
│   ├── cache.py                   # Redis async cache with graceful degradation
│   ├── livekit_agent/
│   │   └── agent.py               # LiveKit voice worker ("Sarah")
│   ├── models/                    # SQLAlchemy ORM models
│   ├── routers/
│   │   ├── auth_router.py         # BCrypt auth + JWT + rate limiting
│   │   ├── call_router.py         # Outbound call management
│   │   ├── lead_router.py         # Contacts / leads CRUD
│   │   ├── call_content_router.py # Dynamic seasonal call scripts
│   │   ├── booking_router.py      # Demo booking management
│   │   ├── ws_router.py           # Live dashboard WebSocket
│   │   └── campaign_router.py     # Bulk outbound campaigns
│   ├── services/
│   │   ├── post_call_summary.py   # AI post-call evaluation
│   │   ├── dashboard_service.py   # Analytics service layer
│   │   └── exotel_service.py      # PSTN with retry logic
│   └── security/
│       └── prompt_guard.py        # Dual-layer injection guard
├── ui/                            # React 19 + Three.js frontend
├── tests/
│   ├── test_platform.py           # 7 unit tests (all passing)
│   └── test_api_endpoints.py      # 9 integration tests (all passing)
└── .env.example
```

---

## ✅ Test Results

```
test_platform.py      7/7  PASSED  (BCrypt, PromptGuard L1/L2, DB, Redis, WS, Health)
test_api_endpoints.py 9/9  PASSED  (Auth, CallContent CRUD, Injection Block, Calls, Dashboard)
npm run build              SUCCESS  (Vite production build, 0 errors)
```

---

## 📄 Environment Variables

```env
# LiveKit
LIVEKIT_URL=wss://your-livekit-url.livekit.cloud
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret

# LLM (use one or both)
OPENAI_API_KEY=sk-...
SARVAM_API_KEY=your_sarvam_key

# STT / TTS
DEEPGRAM_API_KEY=your_deepgram_key

# PSTN (optional)
EXOTEL_ACCOUNT_SID=your_sid
EXOTEL_API_KEY=your_key
EXOTEL_API_TOKEN=your_token
EXOTEL_CALLER_ID=+91XXXXXXXXXX
EXOTEL_APP_ID=your_app_id

# Auth
JWT_SECRET=your_long_random_secret_min_32_chars

# Database & Cache
DATABASE_URL=sqlite+aiosqlite:///./voice_agent.db
REDIS_URL=redis://localhost:6379/0
```

---

## 🌐 Frontend Preview

The React frontend includes:
- **Public landing page** (Sarvam.ai-inspired design)
- **Three.js WebGL neural orb** (1800-particle real-time sphere)
- **Live call dashboard** with KPI tiles + sentiment analytics
- **Call logs** with AI post-call summaries per call
- **Dynamic script manager** for seasonal/campaign prompts
- **Dark / Light theme toggle** with localStorage persistence

---

## 📝 License

MIT License — built as a Forward Deployed Engineer prototype demonstrating real-time voice AI for Indian B2B markets.

---

*Built with AI-assisted development (Antigravity / Google DeepMind) — Architecture, code review, security audit, and engineering decisions by the developer.*
