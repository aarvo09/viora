"""The Sarvam adapter is checked against the SDK, not against our assumptions.

Why this file exists. Every model id in `config.py` started as a guess, and all
three guesses were wrong — `saarika:v2`, `bulbul:v2` and `sarvam-m` are not what
the installed SDK accepts. The failure mode is nasty: with no API key the app
runs its degraded fallback and looks fine, so an invalid model id stays silent
until the key is added, and then voice fails instead of degrading.

So these tests read the SDK's own `Literal` annotations and assert our
configured defaults are inside them. They need no API key and make no network
call. If Sarvam ships a new SDK that renames a model, this fails at test time
with the accepted values printed, rather than at a demo.

`test_call_kwargs_match_the_sdk_signature` covers the other half: the parameter
names we pass. `_call_tts` was passing `target_language_code`, which is the STT
translate parameter — a guaranteed TypeError on every spoken reply.
"""

from __future__ import annotations

import inspect
import typing

import pytest

from app.config import settings

sarvamai = pytest.importorskip("sarvamai", reason="sarvamai SDK not installed")

from sarvamai.chat.client import ChatClient  # noqa: E402
from sarvamai.speech_to_text.client import SpeechToTextClient  # noqa: E402
from sarvamai.text_to_speech.client import TextToSpeechClient  # noqa: E402


def literal_values(fn: object, param: str) -> set[str]:
    """The string values a Literal-annotated SDK parameter accepts.

    The SDK annotates these as `Union[Literal["a", "b"], Any, None]`, so the
    `Any` arm means an unknown value is not a *type* error — which is exactly why
    a wrong id used to sail through to a runtime API rejection. We dig the
    Literal arm out and treat it as the real allowed set.
    """
    annotation = inspect.signature(fn).parameters[param].annotation
    found: set[str] = set()

    def walk(node: object) -> None:
        origin = typing.get_origin(node)
        if origin is typing.Literal:
            found.update(str(a) for a in typing.get_args(node))
            return
        for arg in typing.get_args(node):
            walk(arg)

    walk(annotation)
    return found


# --------------------------------------------------------------------------
# model ids
# --------------------------------------------------------------------------

def test_stt_model_is_accepted_by_the_sdk():
    allowed = literal_values(SpeechToTextClient.transcribe, "model")
    assert settings.SARVAM_STT_MODEL in allowed, (
        f"SARVAM_STT_MODEL={settings.SARVAM_STT_MODEL!r} not accepted; SDK allows {sorted(allowed)}"
    )


def test_tts_model_is_accepted_by_the_sdk():
    allowed = literal_values(TextToSpeechClient.convert, "model")
    assert settings.SARVAM_TTS_MODEL in allowed, (
        f"SARVAM_TTS_MODEL={settings.SARVAM_TTS_MODEL!r} not accepted; SDK allows {sorted(allowed)}"
    )


def test_chat_model_is_accepted_by_the_sdk():
    allowed = literal_values(ChatClient.completions, "model")
    assert settings.SARVAM_CHAT_MODEL in allowed, (
        f"SARVAM_CHAT_MODEL={settings.SARVAM_CHAT_MODEL!r} not accepted; SDK allows {sorted(allowed)}"
    )


def test_tts_speaker_is_a_real_voice():
    allowed = literal_values(TextToSpeechClient.convert, "speaker")
    assert settings.SARVAM_TTS_SPEAKER in allowed, (
        f"speaker {settings.SARVAM_TTS_SPEAKER!r} not accepted; SDK allows {sorted(allowed)}"
    )


def test_the_configured_voice_is_female():
    """A survivor of gender-based violence is being called by our system.

    A male voice on that call is not a cosmetic mistake, so the chosen speaker is
    pinned here rather than left to whatever the vendor defaults to.
    """
    assert settings.SARVAM_TTS_SPEAKER == "priya"


def test_speech_pace_is_natural():
    """Not slowed. Deliberately slow speech reads as condescending, not calm."""
    assert 0.95 <= settings.SARVAM_TTS_PACE <= 1.1


# --------------------------------------------------------------------------
# parameter names
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "fn,expected",
    [
        (SpeechToTextClient.transcribe, {"file", "model", "language_code"}),
        (TextToSpeechClient.convert, {"text", "language_code", "speaker", "pace", "model"}),
        (ChatClient.completions, {"messages", "model", "temperature"}),
    ],
)
def test_call_kwargs_match_the_sdk_signature(fn, expected):
    """Every kwarg the adapter passes must exist on the SDK method.

    This is what catches `target_language_code`: a plausible-looking name that
    belongs to a different endpoint.
    """
    actual = set(inspect.signature(fn).parameters)
    missing = expected - actual
    assert not missing, f"{fn.__qualname__} has no parameter(s) {sorted(missing)}"


def test_the_adapter_methods_exist():
    """Method names, verified rather than assumed."""
    assert callable(SpeechToTextClient.transcribe)
    assert callable(TextToSpeechClient.convert)
    assert callable(ChatClient.completions)


# --------------------------------------------------------------------------
# the key never leaves the backend
# --------------------------------------------------------------------------

def test_no_api_key_is_committed_to_an_example_env():
    """`.env.example` is committed, so a real key in it is a leaked key."""
    from pathlib import Path

    example = Path(__file__).resolve().parent.parent / ".env.example"
    if not example.exists():
        pytest.skip(".env.example not present")
    for line in example.read_text().splitlines():
        if line.startswith(("SARVAM_API_KEY=", "JWT_SECRET=")):
            value = line.split("=", 1)[1].strip()
            assert value in ("", "change-me"), (
                f"{line.split('=')[0]} in .env.example looks like a real credential"
            )
