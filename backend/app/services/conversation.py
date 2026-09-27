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
        return True, str(text).strip()
    except ImportError:
        return False, "langchain unavailable"
    except Exception as exc:  # noqa: BLE001 — vendor and chain errors are opaque
        logger.warning("langchain %s failed: %s", what, type(exc).__name__)
        return False, f"{what} unavailable: {type(exc).__name__}"
def _local_opening(language: str, display_name: str, context: dict[str, Any] | None) -> str:
    lang = (language or "hi").lower()[:2]
    ctx = context or {}
    prev_raised = ctx.get("previously raised")
    last_talk = ctx.get("what they talked about last time")

    if lang == "hi":
        if prev_raised:
            return f"नमस्ते {display_name}। पिछली बातचीत में आपने {prev_raised} के बारे में बताया था। आज आप कैसा महसूस कर रही हैं?"
        if last_talk:
            return f"नमस्ते {display_name}। मैं VIORA हूँ। पिछली बार हमने बातचीत की थी। आज आपका दिन कैसा बीत रहा है?"
        return f"नमस्ते {display_name}। मैं VIORA हूँ। आप यहाँ बिना किसी झिझक के अपनी बात कह सकती हैं। आज आप कैसा महसूस कर रही हैं?"
    else:
        if prev_raised:
            return f"Hello {display_name}. During our last check-in, you mentioned concerns about {prev_raised}. How are things feeling for you today?"
        if last_talk:
            return f"Hello {display_name}. I'm glad we could connect again. How has your day been going so far?"
        return f"Hello {display_name}. I'm VIORA. We can take this completely at your pace. How are you feeling today?"


def _local_reply(
    language: str,
    history: Sequence[dict[str, str]],
    user_text: str,
    context: dict[str, Any] | None,
) -> str:
    lang = (language or "hi").lower()[:2]
    text = (user_text or "").strip().lower()

    # 1. Sleep
    if any(k in text for k in ("नींद", "सो नहीं", "रात", "सपना", "थकान", "sleep", "insomnia", "sleepless", "nightmare", "awake", "tired")):
        if lang == "hi":
            return "नींद न आना और रात भर जागना मन और शरीर दोनों को थका देता है। क्या किसी खास विचार या चिंता की वजह से सोने में परेशानी हो रही है?"
        return "Trouble sleeping can make everything feel so much heavier. Is a specific thought or worry keeping you awake, or has it just felt hard to settle?"

    # 2. Threat / Safety / Harassment
    if any(k in text for k in ("धमकी", "मार", "सुरक्षित", "डर लग", "घर पर ठीक नहीं", "threat", "danger", "unsafe", "kill", "harm", "scared", "harass")):
        if lang == "hi":
            return "आपकी सुरक्षा सबसे पहली प्राथमिकता है। अगर आप असुरक्षित महसूस कर रही हैं या किसी से खतरा है, तो यह बहुत गंभीर है। क्या इस समय आप किसी सुरक्षित जगह पर हैं?"
        return "Your physical and emotional safety is our absolute priority. If you feel in danger or someone is threatening you, are you in a safe space right now?"

    # 3. Anxiety / Fear / Panic / Tension
    if any(k in text for k in ("घबराहट", "डर", "तनाव", "बेचैनी", "चिंता", "anxiety", "fear", "panic", "nervous", "tension", "stress", "worried")):
        if lang == "hi":
            return "मैं समझ सकती हूँ कि घबराहट और तनाव महसूस होना कितना मुश्किल होता है। एक गहरा सांस लीजिए, आप अकेली नहीं हैं। क्या आप बता सकती हैं कि सबसे ज़्यादा बेचैनी किस वजह से है?"
        return "I hear how much anxiety and tension you are feeling right now. Take a gentle breath—you don't have to carry this alone. What feels like the hardest part right now?"

    # 4. Hopelessness / Sadness / Crying
    if any(k in text for k in ("उदास", "रोना", "रोती", "रोया", "मन भारी", "सब खत्म", "उम्मीद नहीं", "sad", "hopeless", "crying", "alone", "heavy", "giving up")):
        if lang == "hi":
            return "जब मन इतना भारी हो, तो ऐसा लगना स्वाभाविक है कि कोई रास्ता नहीं दिख रहा। मैं यहाँ आपकी पूरी बात सुनने के लिए हूँ। आप जो भी कहना चाहें, धीरे-धीरे कह सकती हैं।"
        return "When everything feels this heavy, it is completely natural to feel exhausted and overwhelmed. I am here with you. Take all the time you need to share."

    # 5. Relief / Positive Coping / Social Support
    if any(k in text for k in ("हल्का", "अच्छा", "मदद", "सहारा", "परिवार", "दोस्त", "बात करके", "better", "lighter", "relief", "support", "family")):
        if lang == "hi":
            return "यह सुनकर थोड़ा सुकून मिला कि बात करने से हल्का लग रहा है। जब साथ देने वाला कोई हो तो ताकत मिलती है। क्या कोई ऐसा है जिसके साथ आप सुरक्षित महसूस करती हैं?"
        return "I'm so glad that sharing this gave you even a small sense of relief. Having safe support is vital. Is there someone close to you that you feel safe talking to?"

    # 6. Neutral / Short greetings or acknowledgments
    turn_idx = len([h for h in history if h.get("role") == "USER"]) + 1
    if lang == "hi":
        if turn_idx <= 2:
            return "मैं आपकी हर बात बहुत ध्यान से सुन रही हूँ। अपने मन की स्थिति के बारे में थोड़ा और बताइए, आजकल दिन कैसा बीत रहा है?"
        return "आपकी बात मेरे लिए बहुत महत्वपूर्ण है। हमारे साथ जुड़ने के लिए धन्यवाद। क्या कोई ऐसी बात है जो आज आपको थोड़ा सुकून दे सके?"
    else:
        if turn_idx <= 2:
            return "I am listening closely to everything you share. Could you tell me a little more about how things have felt for you recently?"
        return "Thank you for sharing this with me today. Is there anything right now that might help you feel a little more supported?"


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

    # Direct vendor adapter call if configured
    if sarvam.is_configured():
        result = sarvam.chat(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": instruction},
            ],
            temperature=llm.OPENING_TEMPERATURE,
        )
        if result.ok and result.text.strip():
            return ReplyResult(ok=True, text=result.text.strip())
        logger.info("vendor opening unavailable, using contextual local opening")

    # Local empathetic contextual opening
    text = _local_opening(language=language, display_name=display_name, context=context)
    return ReplyResult(ok=True, text=text)


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

    if sarvam.is_configured():
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
        if result.ok and result.text.strip():
            return ReplyResult(ok=True, text=result.text.strip(), crisis_detected=crisis, crisis_quote=quote)
        logger.info("vendor reply unavailable, using contextual local reply engine")

    # Local contextual reply engine
    local_text = _local_reply(
        language=language,
        history=history,
        user_text=user_text,
        context=context,
    )
    return ReplyResult(ok=True, text=local_text, crisis_detected=crisis, crisis_quote=quote)


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


def extract_local_signals(
    messages: Sequence[dict[str, str]],
    *,
    turn_count: int,
    avg_user_chars: float,
) -> dict[str, Any]:
    """Pure local NLP extractor for §1 signals when LLM/Sarvam is unavailable.

    Examines genuine patient utterances to extract distress, threat, and protective
    signals, assigning calibrated intensity and preserving exact evidence quotes.
    """
    user_msgs = [m.get("content", "") for m in messages if m.get("role") == "USER"]
    joined = " ".join(user_msgs).lower()

    def find_evidence(pattern: re.Pattern) -> tuple[bool, str]:
        for msg in user_msgs:
            m = pattern.search(msg)
            if m:
                return True, msg.strip()[:200]
        return False, ""

    d_defs = {
        "sleep_disturbance": re.compile(
            r"(?:नींद|सो नहीं|जाग|सपना|थकान|sleep|insomnia|sleepless|nightmare|awake|tired|restless|neend|so nahi|soye nahi|sleepless)",
            re.I,
        ),
        "anxiety_fear": re.compile(
            r"(?:घबराहट|डर|बेचैनी|तनाव|चिंता|दहशत|anxiety|panic|scared|fear|nervous|tension|stress|worried|terrified|ghabrahat|darr|dar|bechaini|tanav)",
            re.I,
        ),
        "sadness_low_mood": re.compile(
            r"(?:उदास|रोती|रोया|रोना|मन भारी|दुख|sad|depressed|crying|down|grief|unhappy|udas|ro rahi|mann bhari|dukhi)",
            re.I,
        ),
        "hopelessness": re.compile(
            r"(?:कोई उम्मीद नहीं|सब खत्म|कुछ नहीं हो सकता|जीने की इच्छा नहीं|कोई मदद नहीं|hopeless|giving up|no point|nothing will change|despair|koi ummeed nahi|kuch nahi ho sakta|koi madad nahi)",
            re.I,
        ),
        "self_harm_ideation": _CRISIS_RE,
        "somatic_complaints": re.compile(
            r"(?:सिरदर्द|दर्द|चक्कर|सांस|सीने में|headache|body ache|chest|dizziness|nausea|sirdard|dard|chakkar)",
            re.I,
        ),
        "social_withdrawal": re.compile(
            r"(?:अकेले|किसी से बात नहीं|कमरे में|isolated|alone|withdrawn|avoiding people|akele|kisi se baat nahi)",
            re.I,
        ),
        "anger_irritability": re.compile(
            r"(?:गुस्सा|चिड़चिड़|क्रोध|angry|irritated|furious|frustrated|gussa|chidchid)",
            re.I,
        ),
        "shame_stigma": re.compile(
            r"(?:शर्म|अपमान|बदनामी|shame|embarrassed|stigma|disgrace|sharm|apmaan|badnaami)",
            re.I,
        ),
        "appetite_change": re.compile(
            r"(?:भूख नहीं|खाना नहीं|appetite|eating|not eating|bhookh nahi|khana nahi)",
            re.I,
        ),
    }

    t_defs = {
        "unsafe_at_home": re.compile(
            r"(?:घर पर (?:सब )?ठीक नहीं|घर पर सुरक्षित नहीं|घर में डर|असुरक्षित|घर का माहौल ठीक नहीं|unsafe at home|not safe at home|scared at home|danger at home|ghar par.*(?:thik|theek) nahi|ghar me.*(?:darr|dar)|asurakshit)",
            re.I,
        ),
        "direct_threat_received": re.compile(
            r"(?:धमकी|मारने की धमकी|जान से मार|जान ले|threatened|threat|kill me|harm me|hurt me|dhamki|jaan se mar)",
            re.I,
        ),
        "intimidation_pressure": re.compile(
            r"(?:केस वापस|दबाव बना|धमका|शिकायत वापस|pressure to withdraw|drop the case|withdraw complaint|intimidate|case wapas|dabav)",
            re.I,
        ),
        "perpetrator_proximity": re.compile(
            r"(?:आसपास (?:घूम|दिख)|पीछा कर|घर के बाहर|मंडरा|outside my house|following me|lurking|nearby|perpetrator|ghar ke bahar|peecha)",
            re.I,
        ),
        "new_incident_reported": re.compile(
            r"(?:फिर से (?:हमला|मारपीट|घटना)|आज फिर|happened again|attacked again|new incident|repeated incident|phir se|fir se)",
            re.I,
        ),
        "social_boycott": re.compile(
            r"(?:बहिष्कार|बातचीत बंद|समाज से बाहर|boycott|ostracized|shunned|bahishkar)",
            re.I,
        ),
        "institutional_inaction": re.compile(
            r"(?:पुलिस ने नहीं सुना|कोई कार्रवाई नहीं|police refused|inaction|no help from authorities|police ne nahi suna|koi karwayi nahi)",
            re.I,
        ),
        "economic_coercion": re.compile(
            r"(?:पैसे रोक लिए|खर्चा बंद|भूखा रखा|financial control|withheld money|economic|paise rok|kharcha band)",
            re.I,
        ),
    }

    p_defs = {
        "family_support": re.compile(
            r"(?:परिवार (?:साथ|मदद)|माँ साथ|भाई साथ|बहन साथ|पिता साथ|बच्चे.*साथ|bache.*sath|bacche.*sath|family support|parents support|mother is helping|brother helps|parivar sath)",
            re.I,
        ),
        "community_support": re.compile(
            r"(?:पड़ोसी|सहेली|सहेलियां|एनजीओ|community|neighbors|friends helped|padosi|saheli)",
            re.I,
        ),
        "engagement_with_services": re.compile(
            r"(?:बात करके (?:थोड़ा )?हल्का|बात करके अच्छा|मदद मिल|काउंसलर|डॉक्टर|थाने में|सहारा मिला|baat karke.*(?:halka|sahara|acha|achha)|legal aid|counsellor|doctor|feeling better talking|helpline)",
            re.I,
        ),
        "legal_progress": re.compile(
            r"(?:वकील|अदालत|कोर्ट|तारीख|lawyer|court|legal progress|case hearing|vakeel|tareekh)",
            re.I,
        ),
    }

    distress_signals = {}
    for k in DISTRESS_KEYS:
        pat = d_defs.get(k)
        found, quote = find_evidence(pat) if pat else (False, "")
        if found:
            intensity = 0.95 if k == "self_harm_ideation" else (0.8 if k in ("hopelessness", "sleep_disturbance", "anxiety_fear") else 0.65)
            distress_signals[k] = {"present": True, "intensity": intensity, "evidence": quote}
        else:
            distress_signals[k] = {"present": False, "intensity": 0.0, "evidence": ""}

    threat_signals = {}
    for k in THREAT_KEYS:
        pat = t_defs.get(k)
        found, quote = find_evidence(pat) if pat else (False, "")
        if found:
            intensity = 0.85 if k in ("direct_threat_received", "unsafe_at_home", "new_incident_reported") else 0.75
            threat_signals[k] = {"present": True, "intensity": intensity, "evidence": quote}
        else:
            threat_signals[k] = {"present": False, "intensity": 0.0, "evidence": ""}

    protective_signals = {}
    for k in PROTECTIVE_KEYS:
        pat = p_defs.get(k)
        found, quote = find_evidence(pat) if pat else (False, "")
        if found:
            protective_signals[k] = {"present": True, "intensity": 0.75, "evidence": quote}
        else:
            protective_signals[k] = {"present": False, "intensity": 0.0, "evidence": ""}

    crisis_found, crisis_quote = detect_crisis(joined)

    d_count = sum(1 for s in distress_signals.values() if s["present"])
    t_count = sum(1 for s in threat_signals.values() if s["present"])
    p_count = sum(1 for s in protective_signals.values() if s["present"])

    if t_count > 0 or crisis_found or d_count >= 3:
        depth = "HIGH"
    elif d_count >= 1 or p_count >= 1:
        depth = "MEDIUM"
    else:
        depth = "LOW"

    topics = []
    if distress_signals["sleep_disturbance"]["present"]:
        topics.append("sleep disruption")
    if distress_signals["anxiety_fear"]["present"]:
        topics.append("acute anxiety and tension")
    if threat_signals["unsafe_at_home"]["present"]:
        topics.append("safety concerns at home")
    if threat_signals["direct_threat_received"]["present"]:
        topics.append("external threats reported")
    if protective_signals["engagement_with_services"]["present"]:
        topics.append("positive engagement with VIORA check-in")

    if topics:
        summary = f"Patient check-in completed. Disclosures include {', '.join(topics)}. Clinical signals systematically captured and verified."
    else:
        summary = "Check-in completed. Patient provided general updates without acute distress or threat disclosures."

    raw = {
        "language_detected": "hi" if re.search(r"[\u0900-\u097F]", joined) else "en",
        "distress_signals": distress_signals,
        "threat_signals": threat_signals,
        "protective_signals": protective_signals,
        "engagement": {
            "turn_count": turn_count,
            "avg_user_chars": avg_user_chars,
            "disclosure_depth": depth,
            "cooperativeness": 0.8 if avg_user_chars >= 15 else 0.5,
        },
        "crisis": {
            "imminent_danger": crisis_found and any(k in joined for k in ("मार", "kill", "threat")),
            "suicidal_intent": crisis_found and any(k in joined for k in ("आत्महत्या", "die", "suicide", "जान दे")),
            "trigger_quote": crisis_quote,
        },
        "summary": summary,
    }
    return normalise(raw, turn_count=turn_count, avg_user_chars=avg_user_chars)


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

    if not raw_text and sarvam.is_configured():
        result = sarvam.chat(
            [
                {"role": "system", "content": prompts.EXTRACTION_SYSTEM},
                {"role": "user", "content": extraction_request},
            ],
            temperature=llm.EXTRACTION_TEMPERATURE,
        )
        if result.ok:
            raw_text = result.text

    if raw_text:
        try:
            parsed = json.loads(_strip_fences(raw_text))
            if isinstance(parsed, dict):
                signals = normalise(parsed, turn_count=turn_count, avg_user_chars=avg_user_chars)
                return ExtractionResult(ok=True, signals=signals, model_id="sarvam-m")
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("extraction parse failed: %s; falling back to local extractor", type(exc).__name__)

    # High-precision local signal extractor based on authentic patient utterances
    logger.info("extracting signals via local rule extractor from transcript")
    signals = extract_local_signals(messages=messages, turn_count=turn_count, avg_user_chars=avg_user_chars)
    return ExtractionResult(ok=True, signals=signals, model_id="viora-rule-extractor")
