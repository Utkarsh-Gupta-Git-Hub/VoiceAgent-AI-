import time
import numpy as np
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class AudioBuffer:
    """
    Stateful audio buffer that detects speech onset, holds pre-speech audio,
    detects silence turn completion, and signals instant user barge-in.
    """
    def __init__(self, sample_rate: int = 16000, silence_hangover_ms: int = 350, speech_threshold_rms: float = 450.0):
        self.sample_rate = sample_rate
        self.silence_hangover_ms = silence_hangover_ms
        self.speech_threshold_rms = speech_threshold_rms

        # 16kHz 16-bit PCM: 32,000 bytes/sec. 200ms = 6,400 bytes.
        self.bytes_per_ms = (sample_rate * 2) // 1000
        self.max_pre_speech_bytes = 200 * self.bytes_per_ms
        self.min_speech_bytes = 200 * self.bytes_per_ms
        self.max_speech_bytes = 8000 * self.bytes_per_ms # 8s max

        self.buffer = bytearray()
        self.pre_speech_buffer = bytearray()
        self.speech_detected = False
        self.last_speech_time = 0
        self.barge_in_triggered = False
        self.ambient_noise_rms = 150.0
        # Barge-in needs sustained loud audio so line noise / clicks don't cut the bot off.
        self.barge_in_min_ms = 700
        self._loud_ms = 0.0

    def append(self, chunk: bytes):
        if not chunk:
            return

        rms = self._calculate_rms(chunk)
        # Adapt noise floor slowly
        if rms < 200.0:
            self.ambient_noise_rms = (self.ambient_noise_rms * 0.9) + (rms * 0.1)

        effective_threshold = max(self.speech_threshold_rms, self.ambient_noise_rms * 2.2)

        chunk_ms = len(chunk) / max(self.bytes_per_ms, 1)
        if rms >= effective_threshold:
            self._loud_ms += chunk_ms
            if self._loud_ms >= self.barge_in_min_ms:
                self.barge_in_triggered = True
            if not self.speech_detected:
                self.speech_detected = True
                logger.debug(f"User speech onset detected (RMS={int(rms)}, threshold={int(effective_threshold)})")
                if len(self.pre_speech_buffer) > 0:
                    self.buffer.extend(self.pre_speech_buffer)
                    self.pre_speech_buffer.clear()

            self.last_speech_time = time.time()
            self.buffer.extend(chunk)
        else:
            self._loud_ms = 0.0
            if self.speech_detected:
                # Inside speech pause window
                self.buffer.extend(chunk)
            else:
                # Rolling pre-speech window to capture soft initial consonants
                self.pre_speech_buffer.extend(chunk)
                if len(self.pre_speech_buffer) > self.max_pre_speech_bytes:
                    self.pre_speech_buffer = self.pre_speech_buffer[-self.max_pre_speech_bytes:]

    def is_ready(self) -> bool:
        if not self.speech_detected:
            return False

        elapsed_silence_ms = (time.time() - self.last_speech_time) * 1000
        if elapsed_silence_ms >= self.silence_hangover_ms and len(self.buffer) >= self.min_speech_bytes:
            return True

        return len(self.buffer) >= self.max_speech_bytes

    def consumes_barge_in(self) -> bool:
        if self.barge_in_triggered:
            self.barge_in_triggered = False
            return True
        return False

    def drain(self) -> bytes:
        data = bytes(self.buffer)
        self.reset()
        return data

    def reset(self):
        self.buffer.clear()
        self.pre_speech_buffer.clear()
        self.speech_detected = False
        self.last_speech_time = 0
        self.barge_in_triggered = False
        self._loud_ms = 0.0

    def _calculate_rms(self, pcm_bytes: bytes) -> float:
        if len(pcm_bytes) < 2:
            return 0.0
        audio_data = np.frombuffer(pcm_bytes, dtype=np.int16)
        if len(audio_data) == 0:
            return 0.0
        return float(np.sqrt(np.mean(audio_data.astype(np.float32) ** 2)))
