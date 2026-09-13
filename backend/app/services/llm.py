"""LangChain integration for the LLM lane.

Contract §6 names LangGraph for the workflow; this is its companion — the
LangChain surface the conversation and extraction chains run on. Two pieces:

  * `SarvamChatModel` — a LangChain `BaseChatModel` wrapping our own Sarvam
    adapter. There is no official Sarvam LangChain provider package, and we would
    not want one: `services/sarvam.py` already owns the vendor surface, the
    timeout, the single retry and the "never log transcript content" rule. This
    class adapts that adapter to LangChain rather than adding a second path to
    the vendor.

  * `conversation_chain()` / `extraction_chain()` — the prompt → model → parser
    runnables the conversation layer invokes.

WHERE THE DETERMINISM BOUNDARY SITS

Everything in this file is ABOVE the boundary. LangChain is allowed to produce
text and per-signal intensities. It is never allowed to produce a score, a band,
a trend or a factor — those come from the pure services, reached through the
LangGraph workflow in `services/graph.py`. Do not add a chain here that computes
a number, and do not give a chain access to `scoring`, `risk` or `explain`.

Failure posture matches the rest of the vendor lane: if LangChain is not
installed, `is_available()` returns False and `conversation.py` falls back to
calling `sarvam.chat()` directly. A missing dependency must not silence VIORA
mid-conversation.
"""

from __future__ import annotations

import logging
from typing import Any, Iterator, Optional, Sequence

from app.services import sarvam

logger = logging.getLogger(__name__)

# Temperature 0.0 for extraction: as close to deterministic as the vendor allows.
# The graph below the boundary is exactly deterministic; this is not, which is
# precisely why extraction output is hard-validated before it crosses over.
EXTRACTION_TEMPERATURE = 0.0
CONVERSATION_TEMPERATURE = 0.6
OPENING_TEMPERATURE = 0.7


def is_available() -> bool:
    """True when langchain-core is importable."""
    try:
        import langchain_core  # noqa: F401
    except ImportError:
        return False
    return True


# --------------------------------------------------------------------------
# Chat model
# --------------------------------------------------------------------------

def _build_chat_model_class() -> Any:
    """Define SarvamChatModel lazily.

    The class body needs langchain_core at definition time, so it cannot live at
    module scope without making LangChain a hard dependency of app boot.
    """
    from langchain_core.callbacks import CallbackManagerForLLMRun
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, BaseMessage, SystemMessage
    from langchain_core.outputs import ChatGeneration, ChatResult

    def _to_sarvam_role(message: BaseMessage) -> str:
        if isinstance(message, SystemMessage):
            return "system"
        if isinstance(message, AIMessage):
            return "assistant"
        return "user"

    class SarvamChatModel(BaseChatModel):
        """LangChain chat model backed by `services.sarvam.chat`.

        Deliberately thin. All vendor concerns — auth, timeout, retry, the rule
        that transcript text is never logged — stay in the adapter; this class
        only translates message types and surfaces errors as exceptions so
        LangChain's own error handling works normally.
        """

        temperature: float = CONVERSATION_TEMPERATURE

        @property
        def _llm_type(self) -> str:
            return "sarvam-chat"

        @property
        def _identifying_params(self) -> dict[str, Any]:
            # Model id only. Never the API key — this dict lands in traces.
            from app.config import settings

            return {"model": settings.SARVAM_CHAT_MODEL, "temperature": self.temperature}

        def _generate(
            self,
            messages: list[BaseMessage],
            stop: Optional[list[str]] = None,
            run_manager: Optional[CallbackManagerForLLMRun] = None,
            **kwargs: Any,
        ) -> ChatResult:
            payload = [
                {"role": _to_sarvam_role(m), "content": str(m.content)} for m in messages
            ]
            temperature = float(kwargs.get("temperature", self.temperature))
            result = sarvam.chat(payload, temperature=temperature)
            if not result.ok:
                raise RuntimeError(result.error or "chat unavailable")
            return ChatResult(
                generations=[ChatGeneration(message=AIMessage(content=result.text))]
            )

    return SarvamChatModel


_MODEL_CLASS: Any = None


def chat_model(temperature: float = CONVERSATION_TEMPERATURE) -> Any:
    """A SarvamChatModel instance. Raises ImportError without langchain-core."""
    global _MODEL_CLASS
    if _MODEL_CLASS is None:
        _MODEL_CLASS = _build_chat_model_class()
    return _MODEL_CLASS(temperature=temperature)


# --------------------------------------------------------------------------
# Chains
# --------------------------------------------------------------------------

def conversation_chain(
    *,
    system_prompt: str,
    history: Sequence[dict[str, str]],
    temperature: float = CONVERSATION_TEMPERATURE,
) -> Any:
    """prompt → SarvamChatModel → str.

    History is baked into the prompt as concrete messages rather than passed
    through a placeholder: turns come from the database already ordered, and an
    explicit list is easier to reason about when reviewing what the model saw.
    """
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import ChatPromptTemplate

    messages: list[Any] = [SystemMessage(content=system_prompt)]
    for turn in history:
        content = str(turn.get("content", ""))
        if turn.get("role") == "VIORA":
            messages.append(AIMessage(content=content))
        else:
            messages.append(HumanMessage(content=content))
    # The current turn is the only templated slot. `{user_text}` is filled with
    # the person's words, so the template must not interpret them: we pass it as
    # a value at invoke time, never format it into the prompt string.
    messages.append(("human", "{user_text}"))

    prompt = ChatPromptTemplate.from_messages(messages)
    return prompt | chat_model(temperature) | StrOutputParser()


def extraction_chain(*, system_prompt: str) -> Any:
    """prompt → SarvamChatModel(temp 0) → raw string.

    Returns the raw string rather than a JSON parser output: `conversation.py`
    already strips fences and hard-validates the object against the §1 taxonomy,
    and that validation must stay the single gate into the scoring layer. A
    LangChain JSON parser here would create a second, weaker one.
    """
    from langchain_core.messages import SystemMessage
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import ChatPromptTemplate

    # SystemMessage, not a ("system", ...) tuple: the prompt text is already
    # rendered and contains literal JSON braces. A template would read those as
    # variables and raise.
    prompt = ChatPromptTemplate.from_messages(
        [SystemMessage(content=system_prompt), ("human", "{extraction_request}")]
    )
    return prompt | chat_model(EXTRACTION_TEMPERATURE) | StrOutputParser()


__all__ = [
    "is_available",
    "chat_model",
    "conversation_chain",
    "extraction_chain",
    "CONVERSATION_TEMPERATURE",
    "EXTRACTION_TEMPERATURE",
    "OPENING_TEMPERATURE",
]
