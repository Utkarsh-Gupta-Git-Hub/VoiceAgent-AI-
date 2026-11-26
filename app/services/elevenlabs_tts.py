import httpx
import logging
from app.config import settings

logger = logging.getLogger(__name__)

class ElevenLabsTtsService:
    def __init__(self):
        self.api_key = settings.ELEVENLABS_API_KEY
        self.voice_id = settings.ELEVENLABS_VOICE_ID
        self.model_id = settings.ELEVENLABS_MODEL_ID
        self._elevenlabs_disabled = False

    async def _deepgram_fallback(self, text: str, sample_rate: int = 16000) -> bytes:
        """
        High-reliability fallback: Generates raw Linear PCM bytes via Deepgram Aura TTS.
        Ensures calls never experience dead silence if ElevenLabs subscription or voice limits trigger.
        """
        if not getattr(settings, "DEEPGRAM_API_KEY", None):
            logger.warning("Deepgram API key missing; cannot synthesize fallback TTS.")
            return b""

        sr = 8000 if sample_rate <= 8000 else 16000
        url = f"https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=linear16&sample_rate={sr}"
        headers = {
            "Authorization": f"Token {settings.DEEPGRAM_API_KEY}",
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.post(url, headers=headers, json={"text": text})
                if res.status_code == 200 and res.content:
                    logger.info(f"Deepgram fallback synthesized {len(res.content)} PCM bytes ({sr}Hz) for: '{text[:40]}...'")
                    return res.content
                logger.error(f"Deepgram fallback TTS error ({res.status_code}): {res.text}")
        except Exception as exc:
            logger.error(f"Deepgram fallback TTS exception: {exc}")
        return b""

    async def synthesize_pcm(self, text: str, sample_rate: int = 16000) -> bytes:
        """
        Synthesizes spoken text into raw Linear PCM bytes.
        Attempts ElevenLabs Turbo v2.5 first; automatically falls back to Deepgram Aura
        if ElevenLabs quota, payment, or network errors occur.
        """
        if not text or not text.strip():
            return b""

        output_format = "pcm_16000" if sample_rate >= 16000 else "pcm_8000"
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}?output_format={output_format}"

        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json"
        }

        payload = {
            "text": text,
            "model_id": self.model_id,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
                "use_speaker_boost": True
            }
        }

        if self.api_key and self.voice_id and not self._elevenlabs_disabled:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(url, headers=headers, json=payload)
                    if response.status_code == 200 and response.content:
                        pcm_bytes = response.content
                        logger.info(f"ElevenLabs synthesized {len(pcm_bytes)} PCM bytes ({output_format}) for: '{text[:30]}...'")
                        return pcm_bytes
                    else:
                        if response.status_code in (401, 402, 403):
                            # Plan/quota/auth problem won't fix itself mid-session: skip the
                            # ElevenLabs round-trip on later turns to keep replies fast.
                            self._elevenlabs_disabled = True
                        logger.warning(
                            f"ElevenLabs TTS returned HTTP {response.status_code} ({response.text[:120]}). "
                            "Activating instant Deepgram Aura TTS fallback..."
                        )
            except Exception as e:
                logger.warning(f"Failed calling ElevenLabs TTS: {e}. Activating Deepgram Aura fallback...")

        # Automatic fallback to Deepgram Aura
        return await self._deepgram_fallback(text, sample_rate=sample_rate)


async def _stream_pcm(self, text: str, sample_rate: int = 8000):
    """
    Async generator of PCM chunks. Playback can begin as soon as the first bytes
    arrive instead of waiting for the whole sentence to be synthesised.
    """
    if not text or not text.strip():
        return
    if self.api_key and self.voice_id and not self._elevenlabs_disabled:
        fmt = "pcm_16000" if sample_rate >= 16000 else "pcm_8000"
        url = (f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}/stream"
               f"?output_format={fmt}&optimize_streaming_latency=3")
        headers = {"xi-api-key": self.api_key, "Content-Type": "application/json"}
        payload = {"text": text, "model_id": self.model_id,
                   "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}
        sent = False
        try:
            async with _tts_client().stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code == 200:
                    carry = b""
                    async for chunk in resp.aiter_bytes():
                        data = carry + chunk
                        if len(data) % 2:  # keep 16-bit sample alignment
                            carry, data = data[-1:], data[:-1]
                        else:
                            carry = b""
                        if data:
                            sent = True
                            yield data
                    return
                if resp.status_code in (401, 402, 403):
                    self._elevenlabs_disabled = True
                logger.warning(f"ElevenLabs stream returned HTTP {resp.status_code}; using Deepgram fallback")
        except Exception as e:
            logger.warning(f"ElevenLabs stream failed: {e}")
            if sent:
                return  # already played part of it; don't repeat
    audio = await self._deepgram_fallback(text, sample_rate=sample_rate)
    if audio:
        yield audio

ElevenLabsTtsService.stream_pcm = _stream_pcm

_tts_shared = None

def _tts_client() -> httpx.AsyncClient:
    global _tts_shared
    if _tts_shared is None:
        _tts_shared = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
    return _tts_shared

elevenlabs_tts_service = ElevenLabsTtsService()
