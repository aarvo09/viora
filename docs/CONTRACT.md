# VIORA — FROZEN BUILD CONTRACT v1.0.0

Single source of truth for this build. Every module is written against this file.
If you believe something here is wrong, DO NOT silently deviate — report it back instead.

Product: AI conversational well-being & early-intervention platform for victims of
serious violent crime. Operated by state department / district administration.
Two surfaces (Android patient app, counsellor web dashboard), one backend, one DB.

---

## 0. NON-NEGOTIABLE RULES

1. **The LLM never computes numbers.** It extracts structured signals only.
   All scores/bands/trends/predictions come from pure functions below.
2. **Pure services are pure.** No I/O, no network, no LLM, no `datetime.now()`,
   no randomness. Clock is injected. Same input → identical output, always.
3. **Reports are append-only.** Never UPDATE a report. Never recompute history
   with current values. New assessment = new row with incremented `report_version`.
4. **Explanations are derived, never authored.** Factors come from the rule table
   in §5. An LLM may rephrase a factor's label; it may never invent one.
5. **Case isolation is structural.** Every query scoped by `case_id` at the
   repository layer. User A's history must never touch User B's baseline.
6. **Secrets are server-side only.** `SARVAM_API_KEY` lives in `backend/.env`.
   It must never appear in `patient-app/`, `counsellor-web/`, or any bundle.
7. **Transcripts are untrusted input.** When user speech enters a prompt it is
   fenced and preceded by an instruction-ignoring preamble.

---

## 1. SIGNAL TAXONOMY  (`schema_version: "1.0.0"`)

Exact JSON the extraction LLM must emit. Every signal object is
`{present: bool, intensity: float 0.0–1.0, evidence: str}`.
`intensity` MUST be 0.0 when `present` is false.

```json
{
  "schema_version": "1.0.0",
  "language_detected": "hi",
  "distress_signals": {
    "hopelessness":       {"present": false, "intensity": 0.0, "evidence": ""},
    "sadness_low_mood":   {"present": false, "intensity": 0.0, "evidence": ""},
    "anxiety_fear":       {"present": false, "intensity": 0.0, "evidence": ""},
    "sleep_disturbance":  {"present": false, "intensity": 0.0, "evidence": ""},
    "appetite_change":    {"present": false, "intensity": 0.0, "evidence": ""},
    "social_withdrawal":  {"present": false, "intensity": 0.0, "evidence": ""},
    "somatic_complaints": {"present": false, "intensity": 0.0, "evidence": ""},
    "shame_stigma":       {"present": false, "intensity": 0.0, "evidence": ""},
    "anger_irritability": {"present": false, "intensity": 0.0, "evidence": ""},
    "self_harm_ideation": {"present": false, "intensity": 0.0, "evidence": ""}
  },
  "threat_signals": {
    "direct_threat_received":   {"present": false, "intensity": 0.0, "evidence": ""},
    "new_incident_reported":    {"present": false, "intensity": 0.0, "evidence": ""},
    "intimidation_pressure":    {"present": false, "intensity": 0.0, "evidence": ""},
    "perpetrator_proximity":    {"present": false, "intensity": 0.0, "evidence": ""},
    "unsafe_at_home":           {"present": false, "intensity": 0.0, "evidence": ""},
    "social_boycott":           {"present": false, "intensity": 0.0, "evidence": ""},
    "institutional_inaction":   {"present": false, "intensity": 0.0, "evidence": ""},
    "economic_coercion":        {"present": false, "intensity": 0.0, "evidence": ""}
  },
  "protective_signals": {
    "family_support":          {"present": false, "intensity": 0.0, "evidence": ""},
    "community_support":       {"present": false, "intensity": 0.0, "evidence": ""},
    "legal_progress":          {"present": false, "intensity": 0.0, "evidence": ""},
    "engagement_with_services":{"present": false, "intensity": 0.0, "evidence": ""}
  },
  "engagement": {
    "turn_count": 0,
    "avg_user_chars": 0.0,
    "disclosure_depth": "LOW",
    "cooperativeness": 0.0
  },
  "crisis": {
    "imminent_danger": false,
    "suicidal_intent": false,
    "trigger_quote": ""
  },
  "summary": ""
}
```

`disclosure_depth` ∈ `LOW | MEDIUM | HIGH`. `summary`: 2–3 sentences, neutral
register, no diagnosis, no advice, written in English regardless of conversation
language (counsellor-facing).

---

## 2. SCORING  (`scoring_version: "1.0.0"`, pure)

### 2.1 Distress score → 0–100, one decimal

```
WEIGHTS_DISTRESS = {
  hopelessness: 1.0,  self_harm_ideation: 1.0, anxiety_fear: 0.8,
  sadness_low_mood: 0.7, sleep_disturbance: 0.6, social_withdrawal: 0.6,
  shame_stigma: 0.5, anger_irritability: 0.5,
  appetite_change: 0.4, somatic_complaints: 0.4
}
W_SUM_DISTRESS = 6.5

raw       = Σ (weight_i × intensity_i)
base      = 100 × raw / 6.5
dampener  = 1 - (0.15 × mean(intensity of PRESENT protective signals))   # 0 if none
score     = round(clamp(base × dampener, 0, 100), 1)

HARD FLOOR: if self_harm_ideation.present and intensity >= 0.5:
              score = max(score, 75.0)
```

### 2.2 Threat score → 0–100, one decimal

```
WEIGHTS_THREAT = {
  direct_threat_received: 1.0, new_incident_reported: 1.0,
  intimidation_pressure: 0.9,  unsafe_at_home: 0.9,
  perpetrator_proximity: 0.8,  social_boycott: 0.6,
  institutional_inaction: 0.5, economic_coercion: 0.5
}
W_SUM_THREAT = 6.2

raw   = Σ (weight_i × intensity_i)
score = round(clamp(100 × raw / 6.2, 0, 100), 1)

HARD FLOOR: if crisis.imminent_danger: score = max(score, 85.0)
```

**No protective dampening on threat.** Deliberate: emotional support does not
reduce actual physical danger. Do not "improve" this.

### 2.3 Composite (display + prediction only, never stored as the risk band)

```
composite = round(max(distress, threat) * 0.7 + min(distress, threat) * 0.3, 1)
```

---

## 3. BASELINE & TREND  (pure)

Baseline is **per-case**, computed over that case's own prior reports only.

```
prior = distress_scores of up to 5 most recent PRIOR reports (excl. current)

if len(prior) == 0:  baseline = current; confidence = "NONE";   deviation = 0.0
if len(prior) == 1:  baseline = prior[0]; confidence = "LOW"
if 2 <= len(prior) <= 4: baseline = mean(prior); confidence = "MEDIUM"
if len(prior) >= 5:  baseline = mean(prior); confidence = "HIGH"

deviation = round(current - baseline, 1)      # forced 0.0 when confidence == NONE
```

Trend from previous report's distress score:

```
change = current - previous            # None if no previous
WORSENING  if change >= +8
IMPROVING  if change <= -8
STABLE     otherwise
INSUFFICIENT_DATA if previous is None
```

**Cold start is explicit, not hidden.** UI must show `baseline_confidence`.
Never present a baseline as trustworthy when confidence is NONE/LOW.

---

## 4. RISK BANDING  (pure)

```
URGENT    if crisis.imminent_danger or crisis.suicidal_intent
CRITICAL  elif threat >= 70 or distress >= 80
HIGH      elif threat >= 50 or distress >= 60
MODERATE  elif threat >= 30 or distress >= 40
LOW       else
```

Threat thresholds sit lower than distress on purpose: a composed person under
credible threat must escalate. Bands: `LOW | MODERATE | HIGH | CRITICAL | URGENT`.

### Predictive risk (separate from current state)

```
window = distress scores of last 3 prior reports + current  (chronological)
slope  = least-squares slope over index (0..n-1); 0.0 if n < 3

ESCALATING     if slope >= +4.0
DE_ESCALATING  if slope <= -4.0
STABLE         otherwise
INSUFFICIENT_DATA if n < 3

escalation_risk = round(clamp(
    0.5 * composite + 0.3 * clamp(slope * 5, 0, 100) + 0.2 * threat, 0, 100), 1)
```

Return `horizon: "NEXT_2_CHECKINS"`. This is a prioritisation aid — never labelled
as clinical prediction anywhere in the UI.

---

## 5. EXPLANATION RULE TABLE  (pure — the ONLY source of factors)

Each fired rule emits `{code, label, severity, evidence, value}`.
`severity ∈ INFO | CONCERN | SERIOUS`. Ordered SERIOUS → CONCERN → INFO.

| code | fires when | severity | label |
|---|---|---|---|
| `CRISIS_IMMINENT_DANGER` | crisis.imminent_danger | SERIOUS | Immediate danger disclosed |
| `CRISIS_SUICIDAL_INTENT` | crisis.suicidal_intent | SERIOUS | Suicidal intent disclosed |
| `SELF_HARM_IDEATION` | self_harm_ideation ≥ 0.5 | SERIOUS | Self-harm ideation present |
| `NEW_INCIDENT` | new_incident_reported present | SERIOUS | New incident reported |
| `DIRECT_THREAT` | direct_threat_received ≥ 0.5 | SERIOUS | Direct threat received |
| `UNSAFE_AT_HOME` | unsafe_at_home ≥ 0.5 | SERIOUS | Reports not feeling safe at home |
| `WITHDRAWAL_PRESSURE` | intimidation_pressure ≥ 0.5 | SERIOUS | Pressure to withdraw complaint |
| `DISTRESS_ABOVE_BASELINE` | deviation ≥ +10 and confidence ≠ NONE | CONCERN | Distress above personal baseline |
| `DISTRESS_ROSE` | change ≥ +8 | CONCERN | Distress increased since last check-in |
| `THREAT_ELEVATED` | threat ≥ 50 | CONCERN | Elevated external threat |
| `PERPETRATOR_NEARBY` | perpetrator_proximity ≥ 0.5 | CONCERN | Perpetrator in proximity |
| `SLEEP_CONCERN` | sleep_disturbance ≥ 0.5 | CONCERN | Sleep disturbance |
| `HOPELESSNESS` | hopelessness ≥ 0.5 | CONCERN | Expressions of hopelessness |
| `SOCIAL_ISOLATION` | social_withdrawal ≥ 0.5 or social_boycott ≥ 0.5 | CONCERN | Social isolation |
| `INSTITUTIONAL_INACTION` | institutional_inaction ≥ 0.5 | CONCERN | Reports institutional inaction |
| `ENGAGEMENT_DECLINED` | avg_user_chars < 60% of case mean (≥2 priors) | CONCERN | Engagement declined |
| `TREND_ESCALATING` | direction == ESCALATING | CONCERN | Pattern suggests escalation |
| `DISTRESS_FELL` | change ≤ -8 | INFO | Distress decreased since last check-in |
| `PROTECTIVE_SUPPORT` | any protective ≥ 0.5 | INFO | Support factors present |
| `LEGAL_PROGRESS` | legal_progress ≥ 0.5 | INFO | Legal process progressing |
| `BASELINE_UNRELIABLE` | confidence in (NONE, LOW) | INFO | Baseline not yet established |

---

## 6. WORKFLOW  (LangGraph — decides operational next step)

```
ingest → extract → score → baseline → risk → predict → explain → decide → persist
```

`decide` outcomes, driven by risk band only:

| band | actions |
|---|---|
| LOW | FollowUp +14d, no alert |
| MODERATE | FollowUp +7d, no alert |
| HIGH | FollowUp +3d, Alert(HIGH), HumanReview pending |
| CRITICAL | FollowUp +1d, Alert(CRITICAL), HumanReview pending |
| URGENT | FollowUp +1d, Alert(URGENT) **written mid-interaction, not at end**, HumanReview pending |

Every node transition writes a `WorkflowEvent` row. That table is the audit trail.

`HumanReview.outcome ∈ CONTINUE_MONITORING | INTERVENTION_REQUIRED | ESCALATE | CLOSED`
`Intervention.type ∈ PSYCH_SUPPORT | POLICE_PROTECTION | RELOCATION | LEGAL_AID | MEDICAL | COMPENSATION_FOLLOWUP`

---

## 7. CRISIS PROTOCOL  (in-conversation, decided by product owner)

On `crisis.imminent_danger` or `crisis.suicidal_intent` detected in a turn:

1. **Stay in the conversation.** Never end, never deflect to "please contact support".
2. Acknowledge directly and plainly. No minimising, no clinical distance.
3. Surface helplines in the user's language:
   - `112` — emergency
   - `1091` — women's helpline
   - `14416` — Tele-MANAS (mental health)
4. Offer to notify their caseworker **now**, as a question, not an announcement.
5. Fire `Alert(URGENT)` **immediately in that turn** — not at interaction end.
6. Continue the conversation normally afterward.

VIORA must never: promise a specific response time, claim to have contacted
police, diagnose, or advise on legal strategy.

---

## 8. ENTITIES

`User` uid(anon) · display_name · preferred_language · preferred_channel ·
safe_contact_start · safe_contact_end · timezone · **is_controlled_test** · created_at
`Consent` user_id · version · audio_retention_opt_in(default FALSE) · granted_at · revoked_at
`StaffUser` name · email · password_hash · role(`DSWO|DM|SP|SPP|ADMIN`)
`Case` user_id · case_ref · status · legal_stage · assigned_staff_id · opened_at
`Interaction` case_id · channel(`VOICE|TEXT`) · language · status · turn_count · started_at · ended_at
`ConversationMessage` interaction_id · seq · role(`USER|VIORA`) · content · created_at
`InteractionAnalysis` interaction_id · signals(JSON) · schema_version · model_id · created_at
`Report` case_id · interaction_id · report_version · distress_score · threat_score ·
composite_score · risk_level · baseline_score · baseline_confidence · previous_score ·
score_change · baseline_deviation · trend · signals_snapshot(JSON) · factors(JSON) ·
conversation_summary · scoring_version · created_at   **← APPEND ONLY**
`RiskAssessment` case_id · report_id · risk_level · distress · threat · created_at
`RiskPrediction` case_id · report_id · direction · escalation_risk · horizon · factors(JSON)
`Alert` case_id · report_id · severity · status(`OPEN|ACKNOWLEDGED|CLOSED`) · factors(JSON) · created_at
`HumanReview` case_id · alert_id · staff_id · outcome · notes · decided_at
`Intervention` case_id · review_id · type · status · staff_id · created_at
`FollowUp` case_id · scheduled_for · channel · status(`SCHEDULED|DUE|COMPLETED|MISSED|CANCELLED`) · reason · policy_version
`WorkflowEvent` case_id · interaction_id · node · from_state · to_state · payload(JSON) · created_at

`is_controlled_test` is internal only. Never rendered. Always excluded from aggregates.

---

## 9. API SURFACE  (all under `/api/v1`)

```
GET  /health
POST /auth/login                      → JWT            (staff only)
GET  /patients                        → profile list (patient app picker)
GET  /patients/{uid}                  → profile + active case summary
GET  /patients/{uid}/wellbeing        → latest report + series
GET  /patients/{uid}/history          → interaction list
POST /interactions                    → open interaction  {case_id, channel}
POST /interactions/{id}/messages      → text turn  → VIORA reply
POST /interactions/{id}/voice-turn    → audio in  → {transcript, reply_text, sentences[], audio_b64}
POST /interactions/{id}/complete      → runs workflow → Report + Risk + Alert/FollowUp
GET  /interactions/{id}/transcript
GET  /cases                           → counsellor case list + filters
GET  /cases/{id}                      → latest report first
GET  /cases/{id}/reports              → all versions, newest first
GET  /cases/{id}/telemetry            → longitudinal series
GET  /cases/{id}/follow-ups
GET  /alerts                          → open alerts
POST /alerts/{id}/acknowledge
POST /cases/{id}/reviews              → HumanReview outcome
GET  /dashboard/summary               → counts, risk distribution, pending
```

Backend binds `0.0.0.0:8000`. CORS: explicit origins only, never `*`.

---

## 10. DESIGN TOKENS  (both surfaces — this is what makes it ONE product)

```
ink        #1B2432     surface    #FFFFFF     bg        #F7F5F2   (warm off-white)
muted      #6B7684     line       #E4E0DA     primary   #2E7D74   (calm teal)
primaryTint#E6F0EE     accent     #E8A87C     focus     #2E7D74

risk.LOW   #4C9A78     risk.MODERATE #D9A23B  risk.HIGH #D9703B
risk.CRITICAL #C0453C  risk.URGENT   #8E2A26

font  Inter, system-ui fallback
scale 12 · 14 · 16 · 20 · 24 · 32        patient base 17px   counsellor base 14px
space 4 · 8 · 12 · 16 · 24 · 32 · 48
radius  patient 12   counsellor 8
motion  180ms ease-out standard · 240ms screen transition
```

Never use pure `#FFF` on `#000`, never clinical blue-white, never red except real
alerts. Patient surfaces breathe (more space, larger type, softer radius);
counsellor surfaces are denser. Same palette, same type, same motion.

---

## 11. PATH OWNERSHIP  (do not write outside your lane)

| lane | owns |
|---|---|
| spine (lead) | `backend/app/{main,config}.py` `core/` `models/` `schemas/` `api/` `workflow/` `seed/` `alembic/` `requirements.txt` |
| pure services | `backend/app/services/{scoring,baseline,risk,explain}/` `backend/tests/` |
| sarvam & llm | `backend/app/services/{voice,llm}/` |
| counsellor web | `counsellor-web/` |
| patient app | `patient-app/` |

Need a dependency you don't own? Append it to `docs/DEPS_REQUESTS.md`. Do not edit
`requirements.txt` or another lane's files.
