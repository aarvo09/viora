# VIORA — backend

Conversational well-being and early-intervention platform. The patient app and
the counsellor dashboard are two views of **one case**, backed by one database.

Read `../docs/CONTRACT.md` before changing anything — it is the frozen spec for
scoring, risk, explanations and the API surface.

---

## Setup

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# then edit .env:
#   SARVAM_API_KEY=<your key>
#   JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
```

## Run

```bash
python -m app.seed                                  # three cases with real computed history
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` matters: the phone reaches the backend at your laptop's LAN
address, not `localhost`. Find it with `hostname -I`.

- API docs: http://localhost:8000/docs
- Health:   http://localhost:8000/api/v1/health

Dashboard login after seeding: `caseworker@viora.local` / `viora1234`
(local development only — change it before this leaves your machine).

## Tests

```bash
python -m pytest tests/ -v
```

The suite pins the deterministic core against hand-computed values from the
contract. If a score formula changes, expected values must be **recomputed by
hand** — never pasted in from whatever the code now returns.

---

## Architecture

```
conversation ──────────────► ConversationMessage      [LangChain, per turn]
      │
      ▼
signal extraction ─────────► InteractionAnalysis      [LangChain, JSON only]
      │                      typed signals + intensities
      │
══════╪═════════════ DETERMINISM BOUNDARY ═══════════════════
      ▼
LangGraph workflow  (services/graph.py) — orchestrates, computes NOTHING
      │
      ├─ scoring   (pure) ──► distress · threat · composite
      ├─ baseline  (pure) ──► personal baseline · confidence · trend
      ├─ risk      (pure) ──► current band
      ├─ predict   (pure) ──► direction · escalation risk
      ├─ explain   (pure) ──► contributing factors
      └─ decide          ──► alert? · follow-up interval
      │
      ▼
assessment (services/assessment.py) — persists only
      │                      Report · RiskAssessment · RiskPrediction
      │                      · Alert · HumanReview · FollowUp · WorkflowEvent
```

### LangChain and LangGraph, and where they may not go

Contract §6 names LangGraph, and the LLM lane runs on LangChain. Both sit in
specific places:

- `services/graph.py` — the LangGraph `StateGraph`. Its nodes call the pure
  services and thread the results. **No arithmetic lives in that file and none
  may be added to it.**
- `services/llm.py` — `SarvamChatModel`, a LangChain `BaseChatModel` wrapping our
  own adapter, plus the conversation and extraction chains. There is no official
  Sarvam LangChain provider, and we would not want one: `services/sarvam.py`
  already owns auth, timeout, retry and the "never log transcript content" rule,
  so the chat model adapts that adapter rather than opening a second path to the
  vendor.

Both degrade rather than fail. Without `langgraph`, `graph.run_workflow` walks
the same node table sequentially — `test_graph.py` asserts the two executors
produce identical output. Without `langchain-core`, `conversation.py` calls
`sarvam.chat()` directly. A missing dependency changes performance, never a
person's risk band, and never leaves VIORA silent mid-conversation.

**The LLM never computes a number.** It emits per-signal intensities; every
score, band, trend and factor below the boundary comes from a pure function with
no clock, no randomness and no I/O. That is what makes the same interaction
score identically every time, and what makes "explainable" true rather than
merely plausible.

### Two axes, deliberately not merged

`distress_score` measures internal state; `threat_score` measures external
danger. They are banded together but stored apart, because a person can be
psychologically composed and in acute physical danger — the case a single
blended score would hide. Threat thresholds sit *lower* than distress
thresholds for the same reason, and protective factors dampen distress but
never threat.

### Append-only history

`Report`, `InteractionAnalysis`, `RiskAssessment`, `RiskPrediction` and
`WorkflowEvent` are never updated. A new assessment is a new row with an
incremented `report_version`, carrying its own `signals_snapshot` and `factors`,
so a historical report always shows the state as assessed at that time.

---

## Layout

```
app/
├── main.py                 FastAPI app, CORS, health
├── config.py               settings — SARVAM_API_KEY lives here, server-side only
├── models.py               15 entities, append-only where the contract requires
├── schemas.py              wire contract (what both frontends generate clients from)
├── seed.py                 three controlled cases, history via the real pipeline
├── core/
│   ├── database.py         engine, session, SQLite WAL
│   └── security.py         password hashing, JWT, staff dependency
├── api/
│   ├── patient.py          profiles, conversation, check-in completion
│   └── counsellor.py       auth, cases, reports, telemetry, alerts, reviews
├── alembic/                migrations; 0001_initial matches §8 exactly
└── services/
    ├── signals.py          §1 taxonomy types            ← pure
    ├── scoring.py          §2 distress · threat         ← pure
    ├── baseline.py         §3 baseline · trend          ← pure
    ├── risk.py             §4 banding · trajectory      ← pure
    ├── explain.py          §5 rule table                ← pure
    ├── graph.py            §6 LangGraph workflow        ← orchestrates only
    ├── scheduler.py        follow-up state transitions
    ├── sarvam.py           vendor adapter (STT/TTS/chat)
    ├── llm.py              LangChain chat model + chains
    ├── prompts.py          conversation + extraction prompts
    ├── conversation.py     reply, crisis detection, extraction + validation
    └── assessment.py       persistence; the only place a Report is created
```

---

## Security and privacy

- `SARVAM_API_KEY` is **server-side only**. It must never appear in
  `patient-app/` or `counsellor-web/`. The phone talks to this backend; only
  this backend talks to Sarvam.
- **Audio is never persisted.** It is transcribed in memory and dropped in the
  same request. `Consent.audio_retention_opt_in` defaults to false.
- **Transcripts are untrusted input.** They are fenced with an
  instruction-ignoring preamble before entering any prompt, so words spoken by a
  member of the public cannot steer extraction or contaminate the
  counsellor-facing summary.
- **Logs carry identifiers and durations only** — never transcript content,
  never audio, never the key.
- **Case isolation is structural**: history is loaded scoped by `case_id`, so
  one person's baseline cannot be influenced by another's.
- CORS is an explicit allowlist. Never `*`.

## Crisis handling

On a disclosure of imminent danger or suicidal intent, an `Alert(URGENT)` is
written **mid-conversation**, not at check-in completion — a caseworker should
not learn about it only after the person hangs up. Detection runs both through
the model and through a keyword net, so a vendor outage cannot silently swallow
a disclosure. VIORA stays in the conversation, surfaces 112 / 1091 / 14416 in
the person's language, and offers to notify their caseworker as a question.

---

## Migrations

```bash
alembic upgrade head          # apply
alembic revision --autogenerate -m "what changed"
alembic downgrade -1          # roll back one
```

`init_db()` still creates tables on first boot so a fresh clone runs with no
extra step, but Alembic owns every change after that. Revision `0001_initial` is
hand-written to match `models.py` table by table, so it is reviewable against
contract §8.

SQLite cannot `ALTER` a column in place, so `env.py` sets `render_as_batch=True`.
Without it, column alterations silently fail to generate.

## Follow-up scheduler

`services/scheduler.py` advances follow-up state:

```
SCHEDULED → DUE      when scheduled_for has passed
DUE       → MISSED   after a grace period (URGENT/CRITICAL 2d, HIGH 3d, else 7d)
```

It runs in-process on a 300s interval (`SCHEDULER_ENABLED`,
`SCHEDULER_INTERVAL_SECONDS`), sweeps once at boot to catch up after downtime,
and `GET /follow-ups/due` sweeps before reading so a caseworker never sees a
stale status. Completing a real check-in closes the outstanding row.

The grace period is deliberate: a person who does not answer on the day is not a
missed follow-up, they are a person who had a hard day. Marking MISSED too early
turns an ordinary delay into a red flag on their record. The window is short
where it matters — an unanswered next-day URGENT check-in surfaces in two days.

**It does not contact anyone.** There is no push delivery in this build, and a
scheduler that silently "notified" someone who never got a message would be
worse than one that plainly marks work as outstanding.

## Roles

`core/security.py` provides `require_roles(...)`. The split is a safety decision:

- **Reading is open to every authenticated role.** A DM, an SP and a prosecutor
  all have legitimate reason to see that someone is in danger. A role check that
  hid an URGENT alert from the person who could act on it would be worse than no
  check at all.
- **Writing is gated.** Acknowledging an alert, recording a review outcome and
  escalating are accountable decisions, and the record needs to show who was
  entitled to make them.

| action | roles |
|---|---|
| acknowledge alert | DSWO · SP · DM · ADMIN |
| record review outcome | DSWO · ADMIN |
| outcome = ESCALATE | DSWO · SP · DM · ADMIN |

Refusals return 403, never 401 — a valid session must not be bounced to the login
screen for attempting someone else's decision.

---

## Known gaps

- **Sarvam SDK surface is still unverified.** Method names, model ids and the
  female speaker id in `config.py` are best-effort guesses. All vendor calls are
  isolated in `services/sarvam.py` (`_call_stt`, `_call_tts`, `_call_chat`) —
  correcting them is a three-function change. **Verify against
  https://docs.sarvam.ai before relying on voice.** Text is the reliable path.
- No push delivery. The scheduler marks follow-ups due; a human still contacts
  the person.
- SQLite (WAL) rather than Postgres. Fine at this scale; `DATABASE_URL` is the
  only change needed to move.
- The patient app has no login — the phone picks a profile. Acceptable for
  controlled testing, not for general release.
