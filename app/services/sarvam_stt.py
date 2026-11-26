import httpx
import logging
from app.config import settings
from app.audio.resampler import pcm_to_wav

logger = logging.getLogger(__name__)

class SarvamSttService:
    def __init__(self):
        self.api_key = settings.SARVAM_API_KEY
        self.stt_url = settings.SARVAM_STT_URL
        self.model = settings.SARVAM_STT_MODEL
        self.language = settings.SARVAM_STT_LANGUAGE

    async def transcribe(self, pcm_bytes: bytes, sample_rate: int = 16000) -> str:
        """Sends WAV audio to Sarvam Speech-to-Text API."""
        if not pcm_bytes:
            return ""

        wav_bytes = pcm_to_wav(pcm_bytes, sample_rate=sample_rate)

        headers = {
            "api-subscription-key": self.api_key
        }

        files = {
            "file": ("audio.wav", wav_bytes, "audio/wav")
        }

        data = {
            "model": self.model,
            "language_code": self.language
        }

        client = _client()
        try:
            response = await client.post(self.stt_url, headers=headers, files=files, data=data)
            if response.status_code == 200:
                res_json = response.json()
                transcript = (res_json.get("transcript") or "").strip()
                logger.info(f"Sarvam STT transcribed: '{transcript}'")
                return transcript
            else:
                logger.error(f"Sarvam STT error ({response.status_code}): {response.text}")
                return ""
        except Exception as e:
            logger.error(f"Failed calling Sarvam STT: {e}")
            return ""

_shared_client = None

def _client() -> httpx.AsyncClient:
    """One long-lived client so every turn reuses the open TLS connection (saves ~300ms)."""
    global _shared_client
    if _shared_client is None:
        _shared_client = httpx.AsyncClient(timeout=10.0)
    return _shared_client

sarvam_stt_service = SarvamSttService()
