"""Patient-facing endpoints — contract §9.

No auth in this build: the phone selects a profile and talks to the backend
directly over the LAN. Everything here is deliberately gentle — the patient app
never receives a risk band, a distress score, or any clinical framing. Those
exist for the caseworker, not for the person living it.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import Case, ConversationMessage, FollowUp, Interaction, Report, User
from app.schemas import (
    AudioSentence,
    CompleteInteractionResponse,
    DueCallResponse,
    HistoryItem,
    OpenInteractionRequest,
    OpenInteractionResponse,
    PatientProfile,
    PatientScheduleRequest,
    PatientScheduleResponse,
    PatientTranscript,
    PatientTranscriptMessage,
    PatientWellbeing,
    PreferencesPatch,
    TextTurnRequest,
    TurnResponse,
    WellbeingPoint,
)
from app.services import assessment, conversation, sarvam, scheduler

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["patient"])


# ------------------------------------------------------------- helpers ----

def _user_or_404(db: Session, uid: str) -> User:
    user = db.scalars(select(User).where(User.uid == uid)).first()
    if user is None:
        raise HTTPException(404, "Profile not found")
    return user


def _active_case(db: Session, user: User) -> Case:
    case = db.scalars(
        select(Case).where(Case.user_id == user.id).order_by(Case.opened_at.desc())
    ).first()
    if case is None:
        raise HTTPException(404, "No case for this profile")
    return case


def _interaction_or_404(db: Session, interaction_id: int) -> Interaction:
    interaction = db.get(Interaction, interaction_id)
    if interaction is None:
        raise HTTPException(404, "Check-in not found")
    return interaction


def _latest_report(db: Session, case_id: int) -> Report | None:
    return db.scalars(
        select(Report).where(Report.case_id == case_id).order_by(Report.report_version.desc())
    ).first()


def _case_context(db: Session, case: Case, user: User) -> dict[str, object]:
    """Relevant, already-derived context for the conversation model.

    Only what helps VIORA ask a better next question. Never raw history, never
    scores — the model must not be able to mention internal state.
    """
    context: dict[str, object] = {"their name": user.display_name}
    report = _latest_report(db, case.id)
    if report is None:
        context["history"] = "This is their first check-in."
        return context

    context["last check-in"] = report.created_at.strftime("%d %B")
    if report.conversation_summary:
        context["what they talked about last time"] = report.conversation_summary
    if report.trend == "WORSENING":
        context["note"] = "Things seemed harder for them at the last check-in than before."
    elif report.trend == "IMPROVING":
        context["note"] = "Things seemed a little easier at the last check-in."

    serious = [
        f["label"] for f in (report.factors or [])
        if isinstance(f, dict) and f.get("severity") == "SERIOUS"
    ]
    if serious:
        context["previously raised"] = ", ".join(serious[:3])
    return context


def _next_follow_up(db: Session, case_id: int) -> FollowUp | None:
    return db.scalars(
        select(FollowUp)
        .where(FollowUp.case_id == case_id, FollowUp.status.in_(("SCHEDULED", "DUE")))
        .order_by(FollowUp.scheduled_for.asc())
    ).first()


def _history_for(db: Session, interaction_id: int) -> list[dict[str, str]]:
    rows = db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.interaction_id == interaction_id)
        .order_by(ConversationMessage.seq.asc())
    ).all()
    return [{"role": m.role, "content": m.content} for m in rows]


def _next_seq(db: Session, interaction_id: int) -> int:
    current = db.scalar(
        select(func.max(ConversationMessage.seq)).where(
            ConversationMessage.interaction_id == interaction_id
        )
    )
    return (current or 0) + 1


def _sentences(text: str, language: str, *, speak: bool) -> list[AudioSentence]:
    """Sentence-chunked reply. Audio only for voice check-ins."""
    if not speak:
        return [
            AudioSentence(index=i, text=s)
            for i, s in enumerate(sarvam.split_sentences(text))
        ]
    return [
        AudioSentence(index=c.index, text=c.text, audio_b64=c.audio_b64)
        for c in sarvam.synthesize_sentences(text, language)
    ]


# -------------------------------------------------------------- profiles ----

@router.get("/patients", response_model=list[PatientProfile])
def list_patients(db: Session = Depends(get_db)) -> list[User]:
    """Profile picker. Ordinary people with ordinary names — nothing here
    marks an account as test data."""
    return list(db.scalars(select(User).order_by(User.display_name.asc())).all())


@router.get("/patients/{uid}", response_model=PatientProfile)
def get_patient(uid: str, db: Session = Depends(get_db)) -> User:
    return _user_or_404(db, uid)


@router.get("/patients/{uid}/wellbeing", response_model=PatientWellbeing)
def get_wellbeing(uid: str, db: Session = Depends(get_db)) -> PatientWellbeing:
    user = _user_or_404(db, uid)
    case = _active_case(db, user)

    reports = db.scalars(
        select(Report).where(Report.case_id == case.id).order_by(Report.report_version.asc())
    ).all()
    follow_up = _next_follow_up(db, case.id)

    return PatientWellbeing(
        uid=uid,
        has_history=bool(reports),
        latest_check_in=reports[-1].created_at if reports else None,
        check_in_count=len(reports),
        # Their own trend, never a risk band.
        trend=reports[-1].trend if reports else "INSUFFICIENT_DATA",
        series=[
            WellbeingPoint(
                report_version=r.report_version,
                created_at=r.created_at,
                distress_score=r.distress_score,
                threat_score=r.threat_score,
                composite_score=r.composite_score,
            )
            for r in reports
        ],
        next_follow_up=follow_up.scheduled_for if follow_up else None,
        next_follow_up_channel=follow_up.channel if follow_up else None,
    )


@router.get("/patients/{uid}/due-call", response_model=DueCallResponse)
def get_due_call(uid: str, db: Session = Depends(get_db)) -> DueCallResponse:
    """Is a check-in due for this person right now?

    The phone polls this. There is no push in this build, so "the call arrives on
    its own" is the app noticing a due follow-up and opening the session — which
    is what makes a counsellor-set time produce an actual call.

    Sweeps first so a time that has just passed is DUE rather than SCHEDULED.
    """
    user = _user_or_404(db, uid)
    case = _active_case(db, user)

    scheduler.sweep(db)
    follow_up = _next_follow_up(db, case.id)

    if follow_up is None:
        return DueCallResponse(due=False)

    scheduled = follow_up.scheduled_for
    now = datetime.now(timezone.utc)
    if scheduled > now:
        return DueCallResponse(
            due=False,
            scheduled_for=scheduled,
            channel=follow_up.channel,
            seconds_until=int((scheduled - now).total_seconds()),
        )

    return DueCallResponse(
        due=True,
        follow_up_id=follow_up.id,
        scheduled_for=scheduled,
        channel=follow_up.channel,
        seconds_until=0,
        # Deliberately NOT the reason string: that is counsellor-facing and names
        # risk bands. The person is told a check-in is due, nothing more.
        set_by_counsellor=(follow_up.source == "COUNSELLOR"),
    )


@router.get("/patients/{uid}/history", response_model=list[HistoryItem])
def get_history(uid: str, db: Session = Depends(get_db)) -> list[HistoryItem]:
    user = _user_or_404(db, uid)
    case = _active_case(db, user)
    rows = db.scalars(
        select(Interaction)
        .where(Interaction.case_id == case.id)
        .order_by(Interaction.started_at.desc())
    ).all()
    return [
        HistoryItem(
            interaction_id=i.id, started_at=i.started_at, ended_at=i.ended_at,
            channel=i.channel, language=i.language, status=i.status, turn_count=i.turn_count,
        )
        for i in rows
    ]


@router.get(
    "/patients/{uid}/interactions/{interaction_id}/transcript",
    response_model=PatientTranscript,
)
def get_patient_transcript(
    uid: str, interaction_id: int, db: Session = Depends(get_db)
) -> PatientTranscript:
    """The person reading back their own conversation.

    Separate from the counsellor's `/interactions/{id}/transcript`, which sits
    behind staff auth and returns `case_id`. The ownership check below is the
    reason this endpoint exists rather than opening the counsellor one up: there
    is no auth on this router, so without it any phone could walk the interaction
    ids and read somebody else's conversation.

    A mismatch is a 404, not a 403 — telling an unauthorised caller "that exists,
    but not for you" confirms the record is real.
    """
    user = _user_or_404(db, uid)
    case = _active_case(db, user)
    interaction = _interaction_or_404(db, interaction_id)
    if interaction.case_id != case.id:
        raise HTTPException(404, "Check-in not found")

    rows = db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.interaction_id == interaction.id)
        .order_by(ConversationMessage.seq.asc())
    ).all()

    return PatientTranscript(
        interaction_id=interaction.id,
        channel=interaction.channel,
        language=interaction.language,
        started_at=interaction.started_at,
        ended_at=interaction.ended_at,
        # Filtered rather than trusted: an unexpected role would fail the
        # response model and turn a person's own history screen into a 500.
        messages=[
            PatientTranscriptMessage(
                seq=m.seq, role=m.role, content=m.content, created_at=m.created_at
            )
            for m in rows
            if m.role in ("USER", "VIORA")
        ],
    )


@router.post("/patients/{uid}/schedule", response_model=PatientScheduleResponse)
def schedule_own_check_in(
    uid: str, body: PatientScheduleRequest, db: Session = Depends(get_db)
) -> PatientScheduleResponse:
    """The person picks when their next check-in happens.

    Validated against their own safe-contact window in their own timezone. The
    patient app checks the same rules before it lets the button be pressed, but
    the phone's clock and timezone are not ours to trust, so this side decides.
    """
    user = _user_or_404(db, uid)
    case = _active_case(db, user)

    problem = scheduler.validate_patient_slot(
        when=body.scheduled_for,
        now=datetime.now(timezone.utc),
        safe_start=user.safe_contact_start,
        safe_end=user.safe_contact_end,
        tz=user.timezone,
    )
    if problem is not None:
        raise HTTPException(422, problem)

    follow_up = scheduler.schedule_patient(
        db, case_id=case.id, scheduled_for=body.scheduled_for, channel=body.channel
    )
    return PatientScheduleResponse(
        scheduled_for=follow_up.scheduled_for,
        channel=follow_up.channel,
        status=follow_up.status,
    )


@router.delete("/patients/{uid}/schedule", status_code=204)
def cancel_own_check_in(uid: str, db: Session = Depends(get_db)) -> None:
    """The person clears their own upcoming check-in.

    One exception: a call a caseworker set deliberately is not cancellable from
    the phone. The person keeps control over WHEN — they can move it to any time
    inside their safe hours — but a caseworker's decision that a check-in should
    happen at all is not silently undone from here. Anything predicted, or that
    the person scheduled themselves, clears without argument.
    """
    user = _user_or_404(db, uid)
    case = _active_case(db, user)

    outstanding = _next_follow_up(db, case.id)
    if outstanding is None:
        return None
    if outstanding.source == "COUNSELLOR":
        raise HTTPException(
            409,
            "Your caseworker asked for this check-in. You can move it to a time "
            "that suits you, but it cannot be removed here.",
        )

    scheduler.cancel_outstanding(db, case_id=case.id)
    return None


@router.patch("/patients/{uid}/preferences", response_model=PatientProfile)
def update_preferences(
    uid: str, body: PreferencesPatch, db: Session = Depends(get_db)
) -> PatientProfile:
    """Language, channel and safe hours — the settings only the person can know.

    The safe window is validated as a pair: a start that parses and an end that
    does not would leave a half-checked window on the model, and every later slot
    check would silently fall through to "cannot verify, allow".
    """
    user = _user_or_404(db, uid)

    if body.preferred_language is not None:
        code = body.preferred_language.lower()[:2]
        if code not in sarvam.SUPPORTED_LANGUAGES:
            raise HTTPException(422, "That language is not supported yet.")
        user.preferred_language = code

    if body.preferred_channel is not None:
        user.preferred_channel = body.preferred_channel

    start = body.safe_contact_start if body.safe_contact_start is not None else user.safe_contact_start
    end = body.safe_contact_end if body.safe_contact_end is not None else user.safe_contact_end
    if body.safe_contact_start is not None or body.safe_contact_end is not None:
        if scheduler.parse_clock(start) is None or scheduler.parse_clock(end) is None:
            raise HTTPException(422, "Please give safe hours as HH:MM, for example 10:00.")
        user.safe_contact_start = start
        user.safe_contact_end = end

    db.commit()
    db.refresh(user)
    return PatientProfile.model_validate(user)


# ---------------------------------------------------------- conversation ----

@router.post("/interactions", response_model=OpenInteractionResponse)
def open_interaction(
    payload: OpenInteractionRequest, db: Session = Depends(get_db)
) -> OpenInteractionResponse:
    """Open a check-in. VIORA speaks first, in the person's own language."""
    user = _user_or_404(db, payload.uid)
    case = _active_case(db, user)

    interaction = Interaction(
        case_id=case.id,
        channel=payload.channel,
        # Language comes from the profile. The app never chooses it.
        language=user.preferred_language,
        status="IN_PROGRESS",
    )
    db.add(interaction)
    db.flush()

    result = conversation.opening_message(
        language=user.preferred_language,
        display_name=user.display_name,
        context=_case_context(db, case, user),
    )
    # A vendor outage must not block the check-in — fall back to a plain,
    # warm greeting rather than failing the request.
    text = result.text if result.ok else _fallback_greeting(user)

    db.add(
        ConversationMessage(interaction_id=interaction.id, seq=1, role="VIORA", content=text)
    )
    interaction.turn_count = 1
    db.commit()
    db.refresh(interaction)

    audio = None
    if payload.channel == "VOICE":
        chunks = sarvam.synthesize_sentences(text, user.preferred_language)
        audio = chunks[0].audio_b64 if chunks else None

    return OpenInteractionResponse(
        interaction_id=interaction.id,
        case_id=case.id,
        language=user.preferred_language,
        channel=payload.channel,
        opening_message=text,
        opening_audio_b64=audio,
    )


def _fallback_greeting(user: User) -> str:
    if user.preferred_language.startswith("hi"):
        return f"नमस्ते {user.display_name}। आप कैसा महसूस कर रहे हैं आजकल?"
    return f"Hello {user.display_name}. How have you been feeling lately?"


def _handle_turn(
    db: Session,
    interaction: Interaction,
    user_text: str,
) -> TurnResponse:
    """Shared path for text and voice turns."""
    if interaction.status != "IN_PROGRESS":
        raise HTTPException(409, "This check-in has already ended")

    case = db.get(Case, interaction.case_id)
    user = db.get(User, case.user_id) if case else None
    if case is None or user is None:
        raise HTTPException(404, "Case not found")

    history = _history_for(db, interaction.id)

    seq = _next_seq(db, interaction.id)
    db.add(
        ConversationMessage(interaction_id=interaction.id, seq=seq, role="USER", content=user_text)
    )

    result = conversation.reply(
        language=interaction.language,
        history=history,
        user_text=user_text,
        context=_case_context(db, case, user),
    )

    # Crisis handling fires on the keyword net even when the model is down, so
    # a vendor outage can never swallow a disclosure. Contract §7.
    if result.crisis_detected:
        db.commit()
        assessment.raise_urgent_alert(
            db, interaction=interaction, trigger_quote=result.crisis_quote
        )

    reply_text = result.text if result.ok else _fallback_reply(interaction.language)

    reply_seq = seq + 1
    db.add(
        ConversationMessage(
            interaction_id=interaction.id, seq=reply_seq, role="VIORA", content=reply_text
        )
    )
    interaction.turn_count = reply_seq
    db.commit()

    return TurnResponse(
        interaction_id=interaction.id,
        seq=reply_seq,
        reply_text=reply_text,
        sentences=_sentences(reply_text, interaction.language, speak=interaction.channel == "VOICE"),
        crisis_detected=result.crisis_detected,
    )


def _fallback_reply(language: str) -> str:
    if language.startswith("hi"):
        return "मैं सुन रही हूँ। थोड़ा और बताइए, क्या चल रहा है?"
    return "I'm here, and I'm listening. Can you tell me a little more?"


@router.post("/interactions/{interaction_id}/messages", response_model=TurnResponse)
def text_turn(
    interaction_id: int, payload: TextTurnRequest, db: Session = Depends(get_db)
) -> TurnResponse:
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(422, "Empty message")
    return _handle_turn(db, _interaction_or_404(db, interaction_id), text)


@router.post("/interactions/{interaction_id}/voice-turn", response_model=TurnResponse)
async def voice_turn(
    interaction_id: int,
    audio: UploadFile = File(...),
    language: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> TurnResponse:
    """One spoken turn: audio in, transcript + reply + sentence audio out.

    Audio is transcribed and discarded — never written to disk, never persisted.
    """
    interaction = _interaction_or_404(db, interaction_id)
    payload = await audio.read()

    stt = sarvam.transcribe(payload, language or interaction.language)
    del payload  # audio is not retained

    if not stt.ok:
        raise HTTPException(503, stt.error or "Could not process audio")
    if not stt.text.strip():
        raise HTTPException(422, "No speech detected")

    response = _handle_turn(db, interaction, stt.text.strip())
    response.transcript = stt.text.strip()
    return response


@router.post("/interactions/{interaction_id}/complete", response_model=CompleteInteractionResponse)
def complete_interaction(
    interaction_id: int, db: Session = Depends(get_db)
) -> CompleteInteractionResponse:
    """End the check-in and run the full assessment pipeline.

    This is the moment the patient side and the counsellor side converge: the
    report written here is what the caseworker opens.
    """
    interaction = _interaction_or_404(db, interaction_id)
    if interaction.status == "COMPLETED":
        raise HTTPException(409, "This check-in has already ended")

    messages = _history_for(db, interaction.id)
    user_messages = [m for m in messages if m["role"] == "USER"]
    avg_chars = (
        sum(len(m["content"]) for m in user_messages) / len(user_messages)
        if user_messages
        else 0.0
    )

    extraction = conversation.extract(
        messages=messages, turn_count=len(user_messages), avg_user_chars=avg_chars
    )
    if extraction.ok:
        raw_signals, model_id = extraction.signals, extraction.model_id
    else:
        # Never lose the check-in because extraction failed. Persist an honest
        # all-zero assessment; the counsellor sees a report with no signals
        # rather than a missing check-in.
        logger.warning("extraction failed for interaction=%s; recording empty signals", interaction.id)
        raw_signals = conversation.empty_signals(
            turn_count=len(user_messages), avg_user_chars=avg_chars
        )
        model_id = "unavailable"

    now = datetime.now(timezone.utc)

    # Close whatever was outstanding BEFORE the assessment runs — the assessment
    # schedules the *next* follow-up, and closing afterwards would satisfy the
    # new row instead of the one this check-in actually answered.
    scheduler.complete_for_case(
        db, case_id=interaction.case_id, interaction_id=interaction.id, now=now
    )

    result = assessment.run_assessment(
        db,
        interaction=interaction,
        raw_signals=raw_signals,
        model_id=model_id,
        now=now,
    )

    return CompleteInteractionResponse(
        interaction_id=interaction.id,
        report_version=result.report.report_version,
        next_follow_up=result.follow_up.scheduled_for if result.follow_up else None,
        next_follow_up_channel=result.follow_up.channel if result.follow_up else None,
    )
