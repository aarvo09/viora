import { describe, expect, it } from 'vitest'
import {
  deriveWellbeing,
  isAssessed,
  movement,
  steadinessFrom,
  trendView,
  type SeriesPoint,
  type WellbeingInput,
} from './wellbeing'

function makePoint(
  version: number,
  daysAgo: number,
  distress: number,
  threat: number,
  composite: number,
): SeriesPoint {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  return {
    report_version: version,
    created_at: d.toISOString(),
    distress_score: distress,
    threat_score: threat,
    composite_score: composite,
  }
}

// -------------------------------------------------------------- isAssessed ---

describe('isAssessed', () => {
  it('returns false when all three scores are exactly 0', () => {
    expect(isAssessed(makePoint(1, 0, 0, 0, 0))).toBe(false)
  })
  it('returns true when any score is nonzero', () => {
    expect(isAssessed(makePoint(1, 0, 0.1, 0, 0))).toBe(true)
    expect(isAssessed(makePoint(1, 0, 0, 0, 0.1))).toBe(true)
  })
  it('returns true for a normal assessed report', () => {
    expect(isAssessed(makePoint(1, 0, 11.6, 0, 8.1))).toBe(true)
  })
})

// ----------------------------------------------------------- steadinessFrom ---

describe('steadinessFrom', () => {
  it('0 composite → 100 steadiness (settled)', () => {
    const s = steadinessFrom(0)
    expect(s.value).toBe(100)
    expect(s.band).toBe('settled')
  })
  it('composite 30 → steadiness 70 (settled boundary)', () => {
    const s = steadinessFrom(30)
    expect(s.value).toBe(70)
    expect(s.band).toBe('settled')
  })
  it('composite 31 → steadiness 69 (mixed)', () => {
    const s = steadinessFrom(31)
    expect(s.value).toBe(69)
    expect(s.band).toBe('mixed')
  })
  it('composite 60 → steadiness 40 (mixed boundary)', () => {
    const s = steadinessFrom(60)
    expect(s.value).toBe(40)
    expect(s.band).toBe('mixed')
  })
  it('composite 61 → steadiness 39 (heavy)', () => {
    const s = steadinessFrom(61)
    expect(s.value).toBe(39)
    expect(s.band).toBe('heavy')
  })
  it('composite 100 → steadiness 0 (heavy)', () => {
    const s = steadinessFrom(100)
    expect(s.value).toBe(0)
    expect(s.band).toBe('heavy')
  })
  it('composite out of range clamped to 0-100', () => {
    expect(steadinessFrom(-10).value).toBe(100)
    expect(steadinessFrom(110).value).toBe(0)
  })
})

// ---------------------------------------------------------------- trendView ---

describe('trendView', () => {
  it('IMPROVING → good', () => expect(trendView('IMPROVING').tone).toBe('good'))
  it('STABLE → neutral', () => expect(trendView('STABLE').tone).toBe('neutral'))
  it('WORSENING → watch (amber, not red)', () => expect(trendView('WORSENING').tone).toBe('watch'))
  it('INSUFFICIENT_DATA → neutral', () => expect(trendView('INSUFFICIENT_DATA').tone).toBe('neutral'))
  it('unknown string → neutral', () => expect(trendView('??').tone).toBe('neutral'))
})

// ------------------------------------------------------------- deriveWellbeing ---

describe('deriveWellbeing — Meera-like (3 assessed, improving)', () => {
  const input: WellbeingInput = {
    has_history: true,
    latest_check_in: new Date().toISOString(),
    check_in_count: 3,
    trend: 'STABLE',
    series: [
      makePoint(1, 28, 11.6, 0, 8.1),
      makePoint(2, 14, 6.7, 0, 4.7),
      makePoint(3, 3, 2.5, 0, 1.8),
    ],
  }
  const view = deriveWellbeing(input)

  it('has a steadiness value', () => expect(view.steadiness).not.toBeNull())
  it('latest point used for steadiness (composite 1.8 → ~98)', () => {
    expect(view.steadiness?.value).toBe(98)
    expect(view.steadiness?.band).toBe('settled')
  })
  it('3 chart points', () => expect(view.points.length).toBe(3))
  it('hasEnough true', () => expect(view.hasEnough).toBe(true))
  it('points are in ascending value (improving trajectory)', () => {
    const vals = view.points.map((p) => p.value)
    expect(vals[2]).toBeGreaterThan(vals[0])
  })
})

describe('deriveWellbeing — Kavita-like (empty v4/v5 must be filtered)', () => {
  const input: WellbeingInput = {
    has_history: true,
    latest_check_in: new Date().toISOString(),
    check_in_count: 5,
    trend: 'STABLE',
    series: [
      makePoint(1, 24, 10.8, 12.3, 11.8),
      makePoint(2, 12, 22.8, 25.8, 24.9),
      makePoint(3, 2, 35.4, 54.7, 48.9),
      makePoint(4, 1, 0, 0, 0),   // empty — extraction failed
      makePoint(5, 0, 0, 0, 0),   // empty — extraction failed
    ],
  }
  const view = deriveWellbeing(input)

  it('empty reports excluded from chart', () => expect(view.points.length).toBe(3))
  it('latest non-empty report used for steadiness (composite 48.9 → 51)', () => {
    expect(view.steadiness?.value).toBe(51)
    expect(view.steadiness?.band).toBe('mixed')
  })
  it('does NOT render the empty report as 100 steadiness', () => {
    expect(view.steadiness?.value).not.toBe(100)
  })
})

describe('deriveWellbeing — no history', () => {
  const input: WellbeingInput = {
    has_history: false,
    latest_check_in: null,
    check_in_count: 0,
    trend: 'INSUFFICIENT_DATA',
    series: [],
  }
  const view = deriveWellbeing(input)

  it('null steadiness', () => expect(view.steadiness).toBeNull())
  it('hasEnough false', () => expect(view.hasEnough).toBe(false))
  it('0 points', () => expect(view.points.length).toBe(0))
})

describe('deriveWellbeing — all empty reports (worst case)', () => {
  const input: WellbeingInput = {
    has_history: true,
    latest_check_in: new Date().toISOString(),
    check_in_count: 2,
    trend: 'STABLE',
    series: [makePoint(1, 2, 0, 0, 0), makePoint(2, 0, 0, 0, 0)],
  }
  const view = deriveWellbeing(input)

  it('null steadiness when all points are unassessed', () => expect(view.steadiness).toBeNull())
  it('0 chart points', () => expect(view.points.length).toBe(0))
  it('hasEnough false', () => expect(view.hasEnough).toBe(false))
})

// ---------------------------------------------------------------- movement ---

describe('movement', () => {
  it('null for empty', () => expect(movement([])).toBeNull())
  it('null for single point', () => expect(movement([{ at: '', value: 50 }])).toBeNull())
  it('up when first < last by ≥ 8', () => {
    expect(movement([{ at: '', value: 40 }, { at: '', value: 50 }])).toBe('up')
  })
  it('down when first > last by ≥ 8', () => {
    expect(movement([{ at: '', value: 60 }, { at: '', value: 50 }])).toBe('down')
  })
  it('flat when delta < 8', () => {
    expect(movement([{ at: '', value: 50 }, { at: '', value: 55 }])).toBe('flat')
  })
})
