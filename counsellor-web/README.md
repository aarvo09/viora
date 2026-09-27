# VIORA — counsellor dashboard

Vite + React + TypeScript. Same palette, type scale and motion as the patient
app, at higher density.

## Run

```bash
cd counsellor-web
npm install
cp .env.example .env      # point VITE_API_BASE_URL at the backend
npm run dev               # http://localhost:5173
```

Sign in with the seeded account: `caseworker@viora.local` / `viora1234`.

Set `VITE_API_MODE=mock` to run the whole UI on fixtures with no backend —
useful for design work. A "SAMPLE DATA" chip appears in the header so mock data
can never be mistaken for real cases.

## Screens

| Route | Purpose |
|---|---|
| `/login` | Email + password → JWT |
| `/` | **Today** — triage queue, ranked by who needs attention |
| `/cases` | Filterable table of all cases |
| `/cases/:id` | **Case view** — the main screen |
| `/alerts` | Open alerts with contributing factors |

## Design decisions

**Triage queue, not a stats dashboard.** A caseworker at 9am asks "who do I
contact today", not "how many cases are active". Counts sit in a thin strip;
the ranked queue gets the page.

**Two axes, never merged.** Threat and distress appear side by side everywhere —
queue rows, case header, history table. A person can be composed and in serious
danger, and that case must not be able to hide behind an averaged score. Threat
is listed first because for this population it more often decides the response.

**Current state and trajectory are visibly distinct.** `CRITICAL` and
`ESCALATING` are two different facts shown in two different places. Trajectory
is labelled a prioritisation aid, never a clinical prediction.

**The trajectory quadrant** (`components/TrajectoryQuadrant.tsx`) plots distress
against threat with the case's own history as a trail. Upper-left — *composed
but endangered* — is the case a single score would bury, and here it's
impossible to miss. It's hand-drawn SVG rather than a chart library because
quadrant bands and a directional trail fight the scatter-plot abstraction.

**Colour carries meaning or it isn't used.** Risk bands are the only saturated
colour in the interface. Everything else is ink, muted and line — so a
`CRITICAL` badge still registers when a caseworker is scanning quickly.

**The UI never invents a factor.** Every entry in the *Why* panel comes from the
backend's rule engine with its evidence quote. Nothing is composed, inferred or
padded client-side — that's what makes the explainability claim true rather than
plausible-sounding.

**Baseline confidence is always shown.** A `NONE` or `LOW` confidence baseline is
tagged in amber so it can't be read as trustworthy. Cold start is stated, not
hidden.

**AI recommends, human decides.** *Next action* leads the case view with the
four outcome buttons. The hierarchy is visible in the layout, not just in the
copy.

## Contract

Types in `src/api/types.ts` mirror `backend/app/schemas.py`. The backend is the
single source of truth; if a field changes there it changes here. No secrets
live in this codebase — the browser never talks to Sarvam.
