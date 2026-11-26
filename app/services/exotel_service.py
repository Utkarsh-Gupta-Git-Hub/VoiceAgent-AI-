import asyncio
import re
import httpx
import logging
from typing import Optional, Dict, Any
from app.config import settings

logger = logging.getLogger(__name__)

class ExotelService:
    def __init__(self):
        self.account_sid = (settings.EXOTEL_ACCOUNT_SID or "").strip()
        self.api_key = (settings.EXOTEL_API_KEY or "").strip()
        self.api_token = (settings.EXOTEL_API_TOKEN or "").strip()
        self.caller_id = (settings.EXOTEL_CALLER_ID or "").strip()
        self.app_id = (settings.EXOTEL_APP_ID or "").strip()

    def format_destination(self, destination: str) -> str:
        """Normalizes Indian phone number to 0XXXXXXXXXX or E.164 format for Exotel."""
        digits = re.sub(r"\D", "", destination or "")
        if len(digits) == 10:
            return f"0{digits}"
        if digits.startswith("91") and len(digits) == 12:
            return f"0{digits[2:]}"
        return destination.strip()

    async def initiate_outbound_call(
        self,
        destination_number: str,
        custom_field: str = "",
        custom_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Triggers a single outbound PSTN call via Exotel's REST API.
        POST https://<api_key>:<api_token>@api.exotel.com/v1/Accounts/<account_sid>/Calls/connect.json
        Note: Telephony calls are NEVER retried automatically on client timeout to prevent duplicate calls.
        """
        if not self.account_sid or not self.api_key or not self.api_token:
            logger.warning("Exotel credentials not configured in .env. Simulating call.")
            return {
                "success": False,
                "message": "Exotel credentials missing in .env"
            }

        base = (settings.EXOTEL_BASE_URL or "https://api.exotel.com").rstrip("/")
        formatted_dest = self.format_destination(destination_number)
        ws_url = (settings.PUBLIC_WS_URL or "").strip()

        if ws_url and not custom_url:
            # Preferred: "Connect Voice AI" API. On answer, Exotel opens a bidirectional
            # WebSocket straight to our bot - no App Bazaar flow / dashboard setup needed.
            url = f"{base}/v1/Accounts/{self.account_sid}/Calls/connect"
            sep = "&" if "?" in ws_url else "?"
            stream_url = f"{ws_url}{sep}callSid={custom_field}" if custom_field else ws_url
            data = {
                "From": formatted_dest,
                "CallerId": self.caller_id,
                "StreamUrl": stream_url,
                "StreamType": "bidirectional",
                "CustomField": custom_field,
            }
            public_base = ws_url.split("/ws/")[0].replace("wss://", "https://").replace("ws://", "http://")
            if public_base.startswith("https://"):
                data["StatusCallback"] = f"{public_base}/api/exotel/callback"
                data["StatusCallbackEvents[]"] = "terminal"
            logger.info(f"Initiating Exotel stream call: To={formatted_dest}, StreamUrl={stream_url}, CallerId={self.caller_id}")
        else:
            # Fallback: classic flow-URL call (custom ExoML URL or App Bazaar flow).
            url = f"{base}/v1/Accounts/{self.account_sid}/Calls/connect.json"
            flow_url = (
                custom_url
                or (settings.EXOTEL_EXOML_URL or "").strip()
                or f"http://my.exotel.com/{self.account_sid}/exoml/start_voice/{self.app_id}"
            )
            data = {
                "From": formatted_dest,
                "CallerId": self.caller_id,
                "Url": flow_url,
                "CustomField": custom_field,
                "CallType": "trans",
            }
            logger.info(f"Initiating Exotel flow call: To={formatted_dest}, FlowUrl={flow_url}, CallerId={self.caller_id}")

        try:
            # Single non-retried request with generous 20s timeout for telecom dispatch
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(url, auth=(self.api_key, self.api_token), data=data)
                if 200 <= response.status_code < 300:
                    try:
                        result = response.json()
                    except ValueError:
                        # Some Exotel responses are XML/empty even on success.
                        result = {}
                        m = re.search(r"<Sid>([^<]+)</Sid>", response.text or "")
                        if m:
                            result = {"Call": {"Sid": m.group(1)}}
                    call_sid = (result.get("Call") or {}).get("Sid")
                    logger.info(f"Exotel outbound call initiated successfully: CallSid={call_sid} to={formatted_dest}")
                    return {"success": True, "call_sid": call_sid, "data": result}
                
                logger.error(f"Exotel API error ({response.status_code}): {response.text}")
                return {"success": False, "status_code": response.status_code, "error": response.text}

        except httpx.TimeoutException:
            logger.warning(
                f"Exotel API request timed out after 20s for {formatted_dest}. "
                "Call may have already been queued by Exotel; NOT retrying to prevent duplicate ringing."
            )
            return {"success": False, "error": "Exotel API timeout; dial may already be queued"}
        except Exception as e:
            logger.error(f"Unexpected Exotel error: {e}")
            return {"success": False, "error": str(e)}

exotel_service = ExotelService()
