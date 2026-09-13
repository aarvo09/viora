/* Turning a clinical report series into something a person can be shown.
 *
 * PURE — no imports, so vitest runs it in node (same rule as `datetime.ts`).
 *
 * This is the most safety-sensitive translation in the app. The backend hands
 * the phone `distress_score`, `threat_score` and `composite_score`, all 0-100
 * where HIGHER IS WORSE, plus a `risk_level` the patient endpoint deliberately
 * withholds. None of those numbers may reach the screen: telling someone their
 * threat score is 78 is not care, and the contract puts risk bands on the
 * caseworker's surface only.
 *
 * What the person sees instead is a "steadiness" reading — the same measurement
 * turned the right way up, so higher means better — plus their own trend in
 * ordinary words. That is enough to feel progress and nothing like enough to
 * self-diagnose.
 */

export type Trend = 'IMPROVING' | 'STABLE' | 'WORSENING' | 'INSUFFICIENT_DATA' | string

export interface SeriesPoint {
  report_version: number
  created_at: string
  distress_score: number
  threat_score: number
  composite_score: number
}

export interface WellbeingInput {
  has_history: boolean
  latest_check_in: string | null
  check_in_count: number
  trend: Trend
  series: SeriesPoint[]
}

export type Band = 'settled' | 'mixed' | 'heavy'
export type Tone = 'good' | 'neutral' | 'watch'

export interface Steadiness {
  /** 0-100, higher is better. The inverse of the composite score. */
  value: number
  band: Band
  /** What the person reads. Felt-state language, never clinical. */
  label: string
}

export interface TrendView {
  word: string
  tone: Tone
  hint: string
}

export interface ChartPoint {
  at: string
  value: number
}

export interface WellbeingView {
  /** Null when there is nothing honest to show — see `isAssessed`. */
  steadiness: Steadiness | null
  trend: TrendView
  points: ChartPoint[]
  /** False when the series is too thin to draw a trajectory from. */
  hasEnough: boolean
  checkInCount: number
}

/** Does this report carry an actual assessment?
 *
 *  A report whose three scores are ALL exactly zero is not a calm week — it is
 *  a check-in whose signal extraction failed. The backend records an honest
 *  all-zero row in that case rather than losing the interaction (see
 *  `_handle_turn` / `empty_signals` in the backend), and two such rows exist in
 *  live data today.
 *
 *  Inverting one would render 100/100 and tell someone they are doing perfectly
 *  when in fact nothing was measured. That is the single worst thing this file
 *  could do, so these rows are excluded from the chart and from the current
 *  reading. Exact-zero is the right test: a genuinely calm check-in still
 *  scores a nonzero fraction on something.
 */
export function isAssessed(point: SeriesPoint): boolean {
  return !(
    point.distress_score === 0 && point.threat_score === 0 && point.composite_score === 0
  )
}

/** Composite (higher = worse) → steadiness (higher = better). */
export function steadinessFrom(composite: number): Steadiness {
  const value = Math.max(0, Math.min(100, Math.round(100 - composite)))
  if (value >= 70) return { value, band: 'settled', label: 'Settled' }
  if (value >= 40) return { value, band: 'mixed', label: 'Some hard days' }
  return { value, band: 'heavy', label: 'Carrying a lot' }
}

/** The trend, in words a person would use about themselves.
 *
 *  `WORSENING` maps to the warm accent, never to the red of a risk band. The
 *  person is being told "this has been harder", which is true and useful; they
 *  are not being told they are a critical case, which is the caseworker's
 *  framing and not theirs.
 */
export function trendView(trend: Trend): TrendView {
  switch (trend) {
    case 'IMPROVING':
      return { word: 'Easing', tone: 'good', hint: 'Things have felt a little lighter lately.' }
    case 'STABLE':
      return { word: 'Steady', tone: 'neutral', hint: 'Things have been holding about the same.' }
    case 'WORSENING':
      return { word: 'Harder lately', tone: 'watch', hint: "The last while has been heavier. You don't have to carry it alone." }
    default:
      return { word: 'Just getting started', tone: 'neutral', hint: 'A few more check-ins and your own pattern will show here.' }
  }
}

/** The whole patient-facing view of a wellbeing payload. */
export function deriveWellbeing(input: WellbeingInput): WellbeingView {
  const assessed = (input.series ?? []).filter(isAssessed)

  const points: ChartPoint[] = assessed.map((point) => ({
    at: point.created_at,
    value: steadinessFrom(point.composite_score).value,
  }))

  const latest = assessed.length > 0 ? assessed[assessed.length - 1] : null

  return {
    steadiness: latest ? steadinessFrom(latest.composite_score) : null,
    trend: trendView(input.trend),
    points,
    // One point is a dot, not a trajectory. Two is the minimum that can honestly
    // be called a trend on a chart.
    hasEnough: input.has_history && points.length >= 2,
    checkInCount: input.check_in_count ?? 0,
  }
}

/** Direction of travel between the first and last drawable point, for a caption
 *  under the chart. Returns null when there is nothing to compare. */
export function movement(points: ChartPoint[]): 'up' | 'down' | 'flat' | null {
  if (points.length < 2) return null
  const delta = points[points.length - 1].value - points[0].value
  if (delta >= 8) return 'up'
  if (delta <= -8) return 'down'
  return 'flat'
}
