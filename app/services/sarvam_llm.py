import httpx
import logging
from typing import List, Dict, AsyncGenerator
from app.config import settings

logger = logging.getLogger(__name__)

class SarvamChatService:
    def __init__(self):
        self.api_key = settings.SARVAM_API_KEY
        self.llm_url = settings.SARVAM_LLM_URL
        self.model = settings.SARVAM_LLM_MODEL
        self.max_tokens = settings.SARVAM_LLM_MAX_TOKENS
        self.temperature = settings.SARVAM_LLM_TEMPERATURE

    async def chat(self, messages: List[Dict[str, str]]) -> str:
        """Sends chat conversation history to Sarvam conversational LLM."""
        headers = {
            "api-subscription-key": self.api_key,
            "Content-Type": "application/json"
        }

        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature
        }

        client = _client()
        try:
            response = await client.post(self.llm_url, headers=headers, json=payload)
            if response.status_code == 200:
                data = response.json()
                choices = data.get("choices", [])
                if choices:
                    # content can be None when the model spends its token budget on reasoning
                    bot_message = (choices[0].get("message", {}).get("content") or "").strip()
                    # Clean asterisks or stage directions if any
                    clean_message = bot_message.replace("*", "").replace("\n", " ").strip()
                    if clean_message:
                        logger.info(f"Sarvam LLM reply: '{clean_message}'")
                        return clean_message
                    logger.warning("Sarvam LLM returned empty content; using fallback reply")
            else:
                logger.error(f"Sarvam LLM error ({response.status_code}): {response.text}")
        except Exception as e:
            logger.error(f"Failed calling Sarvam LLM: {e}")

        # Fallback polite reply if API is down
        return "I understand. Could you please tell me which day would be convenient for a quick five-minute phone call demo?"

_shared_client = None

def _client() -> httpx.AsyncClient:
    """One long-lived client so every turn reuses the open TLS connection."""
    global _shared_client
    if _shared_client is None:
        _shared_client = httpx.AsyncClient(timeout=10.0)
    return _shared_client

sarvam_chat_service = SarvamChatService()
