"""Conversation engine and signal extraction.

Sits between the API routes and the Sarvam adapter. Two responsibilities:

  * `reply()` — produce VIORA's next turn, in the person's language, with case
    context injected, and flag a crisis disclosure the moment it happens.
  * `extract()` — turn a completed transcript into the §1 signal JSON, hard
    validated so a malformed model response can never reach the scoring layer.

The LLM never computes a score here. Intensities in, arithmetic elsewhere.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Sequence

from app.services import llm, prompts, sarvam
from app.services.signals import (
    DISTRESS_KEYS,
    PROTECTIVE_KEYS,
    SCHEMA_VERSION,
    THREAT_KEYS,
)

logger = logging.getLogger(__name__)

# Regex crisis net. The LLM is the primary detector, but a model that fails or
# times out must not silently swallow a disclosure — so we also match plainly.
# Deliberately high-precision: these phrases are rarely innocent.
_CRISIS_PATTERNS = [
    r"\bkill (?:myself|me)\b", r"\bend (?:my|it all) life\b", r"\bsuicide\b",
    r"\bwant to die\b", r"\bno reason to live\b", r"\bhang myself\b",
    r"\bthey (?:will|are going to) kill\b", r"\bgoing to kill me\b",
    r"आत्महत्या", r"मरना चाहत", r"जान दे", r"मार डालेंगे", r"मार देंगे",
    r"जान से मार",
]
_CRISIS_RE = re.compile("|".join(_CRISIS_PATTERNS), re.IGNORECASE)


@dataclass(slots=True)
class ReplyResult:
    ok: bool
    text: str = ""
    crisis_detected: bool = False
    crisis_quote: str = ""
    error: str | None = None


@dataclass(slots=True)
class ExtractionResult:
    ok: bool
    signals: dict[str, Any] = field(default_factory=dict)
    model_id: str = ""
    error: str | None = None


def detect_crisis(text: str) -> tuple[bool, str]:
    """Fast keyword net over user speech. Complements, never replaces, the LLM."""
    if not text:
        return False, ""
    match = _CRISIS_RE.search(text)
    return (True, text.strip()[:280]) if match else (False, "")


def _language_name(code: str) -> str:
    return prompts.LANGUAGE_NAMES.get((code or "hi").lower()[:2], "Hindi")


def _system_prompt(language: str, context: dict[str, Any] | None) -> str:
    return prompts.CONVERSATION_SYSTEM.format(
        language_name=_language_name(language),
        helplines=prompts.HELPLINES,
        context_block=prompts.build_context_block(context),
    )


def _run_chain(chain_factory: Any, payload: dict[str, str], *, what: str) -> tuple[bool, str]:
    """Invoke a LangChain runnable, reporting failure rather than raising.

    Errors are surfaced as (False, message) so the caller's existing degradation
    path is unchanged. Never logs prompt or reply content.
    """
    try:
        chain = chain_factory()
        text = chain.invoke(payload)
    except ImportError:
        return False, "langchain unavailable"
    except Exception as exc:  # noqa: BLE001 — vendor and chain errors are opaque
        logger.warning("langchain %s failed: %s", what, type(exc).__name__)
        return False, f"{what} unavailable: {type(exc).__name__}"
    return True, str(text).strip()


def opening_message(*, language: str, display_name: str, context: dict[str, Any] | None = None) -> ReplyResult:
    """VIORA speaks first. The person should never face an empty box."""
    system_prompt = _system_prompt(language, context)
    instruction = (
        prompts.OPENING_INSTRUCTION.format(language_name=_language_name(language))
        + f"\nTheir name is {display_name}."
    )

    if llm.is_available():
        ok, text = _run_chain(
            lambda: llm.conversation_chain(
                system_prompt=system_prompt,
                history=(),
                temperature=llm.OPENING_TEMPERATURE,
            ),
            {"user_text": instruction},
            what="opening",
        )
        if ok:
            return ReplyResult(ok=True, text=text)
        logger.info("opening falling back to direct adapter")

    # Fallback: straight to the adapter. A missing or broken chain must not mean
    # a person opens the app to silence.
    result = sarvam.chat(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": instruction},
        ],
        temperature=llm.OPENING_TEMPERATURE,
    )
    if not result.ok:
        return ReplyResult(ok=False, error=result.error)
    return ReplyResult(ok=True, text=result.text)


def reply(
    *,
    language: str,
    history: Sequence[dict[str, str]],
    user_text: str,
    context: dict[str, Any] | None = None,
) -> ReplyResult:
    """VIORA's next turn.

    `history` is [{role: "USER"|"VIORA", content: str}, ...] oldest first.
    Crisis detection runs on the user's words BEFORE the model call so the
    caller can raise an URGENT alert even if the vendor is down.
    """
    crisis, quote = detect_crisis(user_text)
    system_prompt = _system_prompt(language, context)

    if llm.is_available():
        ok, text = _run_chain(
            lambda: llm.conversation_chain(
                system_prompt=system_prompt,
                history=history,
                temperature=llm.CONVERSATION_TEMPERATURE,
            ),
            {"user_text": user_text},
            what="reply",
        )
        if ok:
            return ReplyResult(
                ok=True, text=text, crisis_detected=crisis, crisis_quote=quote
            )
        logger.info("reply falling back to direct adapter")

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for turn in history:
        messages.append(
            {
                "role": "assistant" if turn.get("role") == "VIORA" else "user",
                "content": str(turn.get("content", "")),
            }
        )
    messages.append({"role": "user", "content": user_text})

    result = sarvam.chat(messages, temperature=llm.CONVERSATION_TEMPERATURE)
    if not result.ok:
        return ReplyResult(ok=False, crisis_detected=crisis, crisis_quote=quote, error=result.error)

    return ReplyResult(ok=True, text=result.text, crisis_detected=crisis, crisis_quote=quote)


# ----------------------------------------------------------- extraction ----

def _empty_signal() -> dict[str, Any]:
    return {"present": False, "intensity": 0.0, "evidence": ""}


def _coerce_group(raw: Any, keys: tuple[str, ...]) -> dict[str, Any]:
    """Force a signal group into shape. Repair rather than reject: a single
    malformed key must not discard an otherwise usable extraction."""
    raw = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    for key in keys:
        item = raw.get(key)
        if not isinstance(item, dict):
            out[key] = _empty_signal()
            continue
        present = bool(item.get("present", False))
        try:
            intensity = float(item.get("intensity", 0.0) or 0.0)
        except (TypeError, ValueError):
            intensity = 0.0
        intensity = min(1.0, max(0.0, intensity))
        # Contract invariant: absent means zero.
        if not present:
            intensity = 0.0
        # present=true with zero intensity is a model slip — treat as absent
        # rather than letting a weightless "present" signal fire a factor.
        elif intensity == 0.0:
            present = False
        evidence = item.get("evidence", "")
        out[key] = {
            "present": present,
            "intensity": intensity,
            "evidence": str(evidence)[:400] if isinstance(evidence, str) else "",
        }
    return out


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    # Some models prepend prose; take the outermost JSON object.
    start, end = text.find("{"), text.rfind("}")
    return text[start : end + 1] if start != -1 and end > start else text


def normalise(raw: dict[str, Any], *, turn_count: int, avg_user_chars: float) -> dict[str, Any]:
    """Coerce a model response into a valid §1 object. Always returns something
    scoreable — never a partial object."""
    engagement = raw.get("engagement") if isinstance(raw.get("engagement"), dict) else {}
    depth = str(engagement.get("disclosure_depth", "LOW")).upper()
    if depth not in ("LOW", "MEDIUM", "HIGH"):
        depth = "LOW"

    crisis = raw.get("crisis") if isinstance(raw.get("crisis"), dict) else {}

    try:
        coop = min(1.0, max(0.0, float(engagement.get("cooperativeness", 0.0) or 0.0)))
    except (TypeError, ValueError):
        coop = 0.0

    return {
        "schema_version": SCHEMA_VERSION,
        "language_detected": str(raw.get("language_detected", "hi"))[:5],
        "distress_signals": _coerce_group(raw.get("distress_signals"), DISTRESS_KEYS),
        "threat_signals": _coerce_group(raw.get("threat_signals"), THREAT_KEYS),
        "protective_signals": _coerce_group(raw.get("protective_signals"), PROTECTIVE_KEYS),
        "engagement": {
            # Turn count and message length are FACTS the backend already knows.
            # Never trust the model's arithmetic for them.
            "turn_count": turn_count,
            "avg_user_chars": round(avg_user_chars, 1),
            "disclosure_depth": depth,
            "cooperativeness": coop,
        },
        "crisis": {
            "imminent_danger": bool(crisis.get("imminent_danger", False)),
            "suicidal_intent": bool(crisis.get("suicidal_intent", False)),
            "trigger_quote": str(crisis.get("trigger_quote", ""))[:400],
        },
        "summary": str(raw.get("summary", ""))[:1200],
    }


def empty_signals(*, turn_count: int = 0, avg_user_chars: float = 0.0) -> dict[str, Any]:
    """A valid all-zero signal object. Used when extraction is unavailable, so a
    vendor outage produces an honest empty assessment rather than no report."""
    return normalise({}, turn_count=turn_count, avg_user_chars=avg_user_chars)


def extract(
    *,
    messages: Sequence[dict[str, str]],
    turn_count: int,
    avg_user_chars: float,
) -> ExtractionResult:
    """Transcript → validated §1 signals.

    The transcript is fenced as untrusted data (contract rule 7): instructions
    embedded in a person's speech must not steer extraction or contaminate the
    counsellor-facing summary.
    """
    transcript = "\n".join(
        f"{'PERSON' if m.get('role') == 'USER' else 'VIORA'}: {m.get('content', '')}"
        for m in messages
    )

    if not transcript.strip():
        return ExtractionResult(
            ok=True,
            signals=empty_signals(turn_count=turn_count, avg_user_chars=avg_user_chars),
            model_id="none",
        )

    extraction_request = prompts.EXTRACTION_USER.format(
        transcript=transcript, schema=prompts.EXTRACTION_SCHEMA
    )

    raw_text = ""
    error: str | None = None

    if llm.is_available():
        ok, out = _run_chain(
            lambda: llm.extraction_chain(system_prompt=prompts.EXTRACTION_SYSTEM),
            {"extraction_request": extraction_request},
            what="extraction",
        )
        if ok:
            raw_text = out
        else:
            error = out
            logger.info("extraction falling back to direct adapter")

    if not raw_text:
        result = sarvam.chat(
            [
                {"role": "system", "content": prompts.EXTRACTION_SYSTEM},
                {"role": "user", "content": extraction_request},
            ],
            # Extraction must be as close to deterministic as the vendor allows.
            temperature=llm.EXTRACTION_TEMPERATURE,
        )
        if not result.ok:
            logger.warning("extraction unavailable: %s", result.error)
            return ExtractionResult(ok=False, error=result.error or error)
        raw_text = result.text

    try:
        parsed = json.loads(_strip_fences(raw_text))
        if not isinstance(parsed, dict):
            raise ValueError("not an object")
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("extraction parse failed: %s", type(exc).__name__)
        return ExtractionResult(ok=False, error="Malformed extraction response")

    signals = normalise(parsed, turn_count=turn_count, avg_user_chars=avg_user_chars)
    return ExtractionResult(ok=True, signals=signals, model_id="sarvam-m")
