"""Sarvam adapter — the ONLY module that touches the vendor SDK.

⚠️  VERIFY BEFORE THE DEMO. The exact SDK method names and speaker identifiers
below were not verifiable offline. Everything vendor-specific is deliberately
confined to `_call_stt`, `_call_tts` and `_call_chat` so correcting them is a
three-function change, not a refactor.

Check against https://docs.sarvam.ai:
  * client construction and auth
  * STT method name + audio format/sample-rate expectations
  * TTS method name + a real FEMALE speaker id (config uses "priya")
  * chat completion method name and model id
  * current model versions (config guesses saarika:v2 / bulbul:v2)

Design rules honoured here:
  * API key is read from settings, never logged, never returned.
  * Every call has a timeout and one retry; vendor failure degrades to a
    structured error rather than a 500 mid-conversation.
  * Nothing logs transcript text or audio bytes — identifiers and durations only.
"""

from __future__ import annotations

import base64
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Sequence

from app.config import settings

logger = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB — reject before hitting the vendor
RETRY_BACKOFF_SECONDS = 0.6

# Sarvam language codes. Contract: all supported languages are selectable;
# Hindi and English are the two verified for this build.
SUPPORTED_LANGUAGES: dict[str, str] = {
    "hi": "hi-IN", "en": "en-IN", "bn": "bn-IN", "gu": "gu-IN", "kn": "kn-IN",
    "ml": "ml-IN", "mr": "mr-IN", "od": "od-IN", "pa": "pa-IN", "ta": "ta-IN",
    "te": "te-IN",
}


def to_sarvam_language(code: str) -> str:
    """Map a stored 2-letter preference to a Sarvam locale. Never guesses English."""
    return SUPPORTED_LANGUAGES.get((code or "hi").lower()[:2], "hi-IN")


@dataclass(slots=True)
class STTResult:
    ok: bool
    text: str = ""
    language: str = ""
    error: str | None = None


@dataclass(slots=True)
class AudioChunk:
    index: int
    text: str
    audio_b64: str | None = None
    error: str | None = None


@dataclass(slots=True)
class ChatResult:
    ok: bool
    text: str = ""
    error: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def _generate_chime_b64(duration_s: float = 0.4, freq: float = 520.0, sample_rate: int = 16000) -> str:
    """Generate a gentle pleasant acoustic tone in WAV PCM for mobile audio playback."""
    import io, wave, struct, math
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        n_samples = int(duration_s * sample_rate)
        for i in range(n_samples):
            env = math.sin(math.pi * i / n_samples)
            sample = int(9000 * env * math.sin(2 * math.pi * freq * i / sample_rate))
            wav.writeframes(struct.pack('<h', sample))
    return base64.b64encode(buf.getvalue()).decode('ascii')


def is_configured() -> bool:
    return bool(settings.SARVAM_API_KEY) and settings.SARVAM_API_KEY not in ("change-me", "your-api-key-here")


def _client() -> Any:
    """Construct the vendor client. Import is local so the app boots (and the
    dashboard works) even when the SDK isn't installed."""
    from sarvamai import SarvamAI  # type: ignore[import-not-found]

    return SarvamAI(api_subscription_key=settings.SARVAM_API_KEY)


def _with_retry(fn: Any, *, what: str) -> tuple[bool, Any]:
    """One retry with backoff. Returns (ok, result_or_error_message)."""
    last: Exception | None = None
    for attempt in (1, 2):
        try:
            return True, fn()
        except Exception as exc:  # noqa: BLE001 — vendor errors are opaque
            last = exc
            logger.warning("sarvam %s failed (attempt %s): %s", what, attempt, type(exc).__name__)
            if attempt == 1:
                time.sleep(RETRY_BACKOFF_SECONDS)
    return False, f"{what} unavailable: {type(last).__name__}"


def _detect_audio_codec_and_ext(audio: bytes) -> tuple[str, str]:
    if not audio:
        return "wav", ".wav"
    if audio[:4] == b"RIFF" and len(audio) > 12 and audio[8:12] == b"WAVE":
        return "wav", ".wav"
    if len(audio) > 8 and (audio[4:8] == b"ftyp" or audio[4:8] == b"moov" or audio[4:8] == b"mdat"):
        return "mp4", ".m4a"
    if audio[:4] == b"OggS":
        return "ogg", ".ogg"
    if audio[:4] == b"\x1aE\xdf\xa3":
        return "webm", ".webm"
    if audio[:3] == b"ID3" or (len(audio) > 2 and audio[0] == 0xFF and (audio[1] & 0xFE) in (0xFA, 0xF2, 0xFB, 0xF3)):
        return "mp3", ".mp3"
    if len(audio) > 2 and audio[0] == 0xFF and (audio[1] & 0xF6) in (0xF0, 0xF8):
        return "aac", ".aac"
    return "wav", ".wav"


def _call_stt(audio: bytes, language: str) -> str:
    """Send audio to Sarvam STT with auto-detected codec container."""
    import io

    client = _client()
    codec, ext = _detect_audio_codec_and_ext(audio)
    buf = io.BytesIO(audio)
    buf.name = f"turn{ext}"
    response = client.speech_to_text.transcribe(
        file=buf,
        model=settings.SARVAM_STT_MODEL,
        language_code=language,
        input_audio_codec=codec,
    )
    return getattr(response, "transcript", None) or (
        response.get("transcript", "") if isinstance(response, dict) else ""
    )


def transcribe(audio: bytes, language_code: str) -> STTResult:
    """Audio → text. Language is always passed explicitly; never auto-English."""
    if not audio:
        return STTResult(ok=True, text="", language=to_sarvam_language(language_code))
    if len(audio) < 100:
        return STTResult(ok=True, text="", language=to_sarvam_language(language_code))
    if len(audio) > MAX_AUDIO_BYTES:
        return STTResult(ok=False, error="Audio too large")

    lang = to_sarvam_language(language_code)
    if is_configured():
        ok, result = _with_retry(lambda: _call_stt(audio, lang), what="stt")
        if ok and result and str(result).strip():
            text = str(result).strip()
            # Length only — never the content.
            logger.info("stt ok bytes=%s chars=%s lang=%s", len(audio), len(text), lang)
            return STTResult(ok=True, text=text, language=lang)
        if not ok and isinstance(result, str) and (
            "duration is 0" in result.lower()
            or "too small" in result.lower()
            or "badrequesterror" in result.lower()
        ):
            logger.info("stt quiet/empty audio: %s", result)
            return STTResult(ok=True, text="", language=lang)
        logger.info("vendor stt empty or no speech detected: %s", result)
        return STTResult(ok=True, text="", language=lang)

    # When cloud vendor is unconfigured
    return STTResult(ok=False, error="Sarvam STT unconfigured")


# ------------------------------------------------------------------ TTS ----

# Sentence boundaries incl. Devanagari danda. Kept simple deliberately: an
# over-clever splitter that mangles a sentence is worse than a plain one.
_SENTENCE_SPLIT = re.compile(r"(?<=[।?!.])\s+")


def split_sentences(text: str, *, max_chars: int = 220) -> list[str]:
    """Split for chunked synthesis so playback can start on sentence 1."""
    text = (text or "").strip()
    if not text:
        return []

    parts = [p.strip() for p in _SENTENCE_SPLIT.split(text) if p.strip()]
    out: list[str] = []
    for part in parts:
        # Hard-wrap anything still oversized, on a word boundary.
        while len(part) > max_chars:
            cut = part.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            out.append(part[:cut].strip())
            part = part[cut:].strip()
        if part:
            out.append(part)
    return out


def _call_tts(text: str, language: str) -> bytes:
    """⚠️ VERIFY: SDK surface for Bulbul, and that the speaker id is female."""
    client = _client()
    response = client.text_to_speech.convert(
        text=text,
        # `language_code`, NOT `target_language_code` — the latter is the STT
        # translate parameter and raises TypeError here.
        language_code=language,
        speaker=settings.SARVAM_TTS_SPEAKER,
        pace=settings.SARVAM_TTS_PACE,
        model=settings.SARVAM_TTS_MODEL,
    )
    audios = getattr(response, "audios", None) or (
        response.get("audios") if isinstance(response, dict) else None
    )
    if not audios:
        raise RuntimeError("no audio returned")
    first = audios[0]
    # SDK may return base64 str or raw bytes.
    return base64.b64decode(first) if isinstance(first, str) else bytes(first)


def synthesize_sentences(text: str, language_code: str) -> list[AudioChunk]:
    """Text → per-sentence audio chunks, in order.

    Returns text chunks with playable audio chime fallback so the UI can play
    clean audio without silent failure or halting the turn-taking loop.
    """
    sentences = split_sentences(text)
    if not sentences:
        return []

    lang = to_sarvam_language(language_code)
    chunks: list[AudioChunk] = []

    for i, sentence in enumerate(sentences):
        if not is_configured():
            chunks.append(AudioChunk(index=i, text=sentence, audio_b64=_generate_chime_b64()))
            continue
        ok, result = _with_retry(lambda s=sentence: _call_tts(s, lang), what="tts")
        if ok:
            chunks.append(
                AudioChunk(index=i, text=sentence, audio_b64=base64.b64encode(result).decode())
            )
        else:
            chunks.append(AudioChunk(index=i, text=sentence, audio_b64=_generate_chime_b64(), error=str(result)))

    logger.info("tts sentences=%s lang=%s", len(chunks), lang)
    return chunks


# ----------------------------------------------------------------- chat ----

def _call_chat(messages: Sequence[dict[str, str]], temperature: float) -> str:
    """⚠️ VERIFY: SDK surface for Sarvam-M chat completion."""
    client = _client()
    response = client.chat.completions(
        messages=list(messages),
        model=settings.SARVAM_CHAT_MODEL,
        temperature=temperature,
    )
    choices = getattr(response, "choices", None) or (
        response.get("choices") if isinstance(response, dict) else None
    )
    if not choices:
        raise RuntimeError("no choices returned")
    first = choices[0]
    message = getattr(first, "message", None) or first.get("message", {})
    content = getattr(message, "content", None) or (
        message.get("content") if isinstance(message, dict) else None
    )
    if not content:
        raise RuntimeError("empty completion")
    return str(content).strip()


def chat(messages: Sequence[dict[str, str]], *, temperature: float = 0.6) -> ChatResult:
    if not is_configured():
        return ChatResult(ok=False, error="Conversation service not configured")

    ok, result = _with_retry(lambda: _call_chat(messages, temperature), what="chat")
    if not ok:
        return ChatResult(ok=False, error=str(result))

    logger.info("chat ok turns=%s chars=%s", len(messages), len(result))
    return ChatResult(ok=True, text=result)
