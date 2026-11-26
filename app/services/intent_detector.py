import re
from datetime import datetime, timedelta
from typing import Optional, Tuple
import logging

logger = logging.getLogger(__name__)

class IntentDetector:
    END_CALL = "__END_CALL__"

    def detect_intent(self, user_text: str) -> Tuple[Optional[str], Optional[datetime], Optional[str]]:
        """
        Analyzes user transcript for:
        1. Demo booking (Returns response message, parsed datetime, intent_type='BOOKING')
        2. Callback request (Returns response message, parsed datetime, intent_type='CALLBACK')
        3. Disconnect / Not interested (Returns END_CALL, None, intent_type='DISCONNECT')
        """
        lower = user_text.lower()

        # 1. Disconnect / Not interested / Goodbye
        disconnect_phrases = [
            "busy", "not interested", "no thanks", "no thank you",
            "don't call", "dont call", "remove my number", "remove",
            "bye", "goodbye", "hang up", "stop calling", "wrong number"
        ]
        if any(self._has_phrase(lower, phrase) for phrase in disconnect_phrases):
            logger.info(f"Disconnect intent detected: '{user_text}'")
            return self.END_CALL, None, "DISCONNECT"

        # 2. Callback request
        callback_phrases = ["call me later", "call back", "call later", "not now", "call after", "driving"]
        if any(self._has_phrase(lower, phrase) for phrase in callback_phrases):
            callback_time = datetime.utcnow() + timedelta(hours=2)
            reply = "No problem at all! We will call you back in a couple of hours. Have a great day!"
            return reply, callback_time, "CALLBACK"

        # 3. Demo Booking intent
        # Whole-word matching only: "am" inside "I am Lily" must NOT count as a time.
        booking_keywords = ["book", "demo", "schedule", "o'clock", "tomorrow", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
        has_clock_time = re.search(r"\d{1,2}(:\d{2})?\s?(am|pm|a\.m\.|p\.m\.)", lower) is not None
        if has_clock_time or any(self._has_phrase(lower, kw) for kw in booking_keywords):
            scheduled_time = self._parse_scheduled_time(lower)
            time_speech = self._format_time_for_speech(scheduled_time)
            reply = f"Thank you so much! Your demo has been scheduled for {time_speech}. We look forward to speaking with you. Have a great day! Goodbye!"
            return reply, scheduled_time, "BOOKING"

        return None, None, None

    @staticmethod
    def _has_phrase(text: str, phrase: str) -> bool:
        """True if `phrase` appears as whole word(s) in `text` (not as a substring of another word)."""
        return re.search(r"(?<![a-z0-9])" + re.escape(phrase) + r"(?![a-z0-9])", text) is not None

    def _parse_scheduled_time(self, text: str) -> datetime:
        dt = datetime.now()
        if "tomorrow" in text:
            dt += timedelta(days=1)
        elif "next week" in text:
            dt += timedelta(days=7)

        hour = 15 # default 3:00 PM
        hour_mappings = {
            "10 am": 10, "10am": 10, "10 o'clock": 10,
            "11 am": 11, "11am": 11, "11 o'clock": 11,
            "12 pm": 12, "12pm": 12, "12 o'clock": 12,
            "1 pm": 13, "1pm": 13, "1 o'clock": 13,
            "2 pm": 14, "2pm": 14, "2 o'clock": 14,
            "3 pm": 15, "3pm": 15, "3 o'clock": 15,
            "4 pm": 16, "4pm": 16, "4 o'clock": 16,
            "5 pm": 17, "5pm": 17, "5 o'clock": 17, "5'clock": 17,
            "6 pm": 18, "6pm": 18, "6 o'clock": 18
        }
        for pattern, h in hour_mappings.items():
            if pattern in text:
                hour = h
                break

        return dt.replace(hour=hour, minute=0, second=0, microsecond=0)

    def _format_time_for_speech(self, dt: datetime) -> str:
        now = datetime.now()
        hour12 = dt.hour - 12 if dt.hour > 12 else (12 if dt.hour == 0 else dt.hour)
        ampm = "PM" if dt.hour >= 12 else "AM"

        if dt.date() == now.date():
            return f"today at {hour12} {ampm}"
        elif dt.date() == (now + timedelta(days=1)).date():
            return f"tomorrow at {hour12} {ampm}"
        return f"{dt.strftime('%A, %B %d')} at {hour12} {ampm}"

intent_detector = IntentDetector()
