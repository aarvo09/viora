import { describe, expect, it } from 'vitest'
import {
  MIN_LEAD_MINUTES,
  MAX_LEAD_DAYS,
  slotsForDay,
  upcomingDays,
  validateSlot,
  withinWindow,
} from './schedule'

const NOW = new Date('2026-09-09T10:00:00') // 10am local

function minutesFrom(hour: number, minute = 0): number {
  return hour * 60 + minute
}

function at(hoursFromNow: number): Date {
  return new Date(NOW.getTime() + hoursFromNow * 3_600_000)
}

const WINDOW_10_17 = { start: '10:00', end: '17:00' }
const WINDOW_WRAP  = { start: '22:00', end: '06:00' } // wraps midnight

// ---------------------------------------------------------- withinWindow ---

describe('withinWindow', () => {
  it('inside a normal window', () => {
    expect(withinWindow(minutesFrom(13), WINDOW_10_17)).toBe(true)
  })
  it('at the window start', () => {
    expect(withinWindow(minutesFrom(10), WINDOW_10_17)).toBe(true)
  })
  it('at the window end', () => {
    expect(withinWindow(minutesFrom(17), WINDOW_10_17)).toBe(true)
  })
  it('before the window', () => {
    expect(withinWindow(minutesFrom(8), WINDOW_10_17)).toBe(false)
  })
  it('after the window', () => {
    expect(withinWindow(minutesFrom(18), WINDOW_10_17)).toBe(false)
  })
  it('wrapping window: time after midnight start', () => {
    expect(withinWindow(minutesFrom(23), WINDOW_WRAP)).toBe(true)
  })
  it('wrapping window: time before morning end', () => {
    expect(withinWindow(minutesFrom(4), WINDOW_WRAP)).toBe(true)
  })
  it('wrapping window: time in the gap', () => {
    expect(withinWindow(minutesFrom(12), WINDOW_WRAP)).toBe(false)
  })
  it('unusable window (bad parse) → always true (do not block)', () => {
    expect(withinWindow(minutesFrom(3), { start: 'bad', end: '10:00' })).toBe(true)
  })
  it('zero-width window → always true', () => {
    expect(withinWindow(minutesFrom(10), { start: '10:00', end: '10:00' })).toBe(true)
  })
})

// ---------------------------------------------------------- validateSlot ---

describe('validateSlot', () => {
  it('future + inside window → ok', () => {
    const slot = new Date(NOW)
    slot.setHours(11, 30, 0, 0)
    slot.setDate(slot.getDate() + 1) // tomorrow, definitely future
    expect(validateSlot({ when: slot, now: NOW, window: WINDOW_10_17 }).ok).toBe(true)
  })

  it('past → PAST', () => {
    const result = validateSlot({ when: at(-2), now: NOW, window: WINDOW_10_17 })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('PAST')
  })

  it('too soon → TOO_SOON', () => {
    // 5 minutes ahead is inside the lead floor
    const result = validateSlot({
      when: new Date(NOW.getTime() + 5 * 60_000),
      now: NOW,
      window: WINDOW_10_17,
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('TOO_SOON')
  })

  it('exactly at min lead → ok', () => {
    const slot = new Date(NOW.getTime() + MIN_LEAD_MINUTES * 60_000)
    // force it inside the window
    slot.setHours(11, slot.getMinutes(), 0, 0)
    if (slot.getTime() <= NOW.getTime()) slot.setDate(slot.getDate() + 1)
    // just check that the TOO_SOON code is not returned
    const result = validateSlot({ when: slot, now: NOW, window: WINDOW_10_17 })
    expect(result.code).not.toBe('TOO_SOON')
  })

  it('too far ahead → TOO_FAR', () => {
    const wayOut = new Date(NOW.getTime() + (MAX_LEAD_DAYS + 1) * 86_400_000)
    const result = validateSlot({ when: wayOut, now: NOW, window: WINDOW_10_17 })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('TOO_FAR')
  })

  it('outside window → OUTSIDE_WINDOW', () => {
    const tomorrow8am = new Date(NOW)
    tomorrow8am.setDate(tomorrow8am.getDate() + 1)
    tomorrow8am.setHours(8, 0, 0, 0) // outside 10:00–17:00
    const result = validateSlot({ when: tomorrow8am, now: NOW, window: WINDOW_10_17 })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('OUTSIDE_WINDOW')
  })

  it('reason string names the window', () => {
    const tomorrow8am = new Date(NOW)
    tomorrow8am.setDate(tomorrow8am.getDate() + 1)
    tomorrow8am.setHours(8, 0, 0, 0)
    const result = validateSlot({ when: tomorrow8am, now: NOW, window: WINDOW_10_17 })
    expect(result.reason).toContain('10:00')
    expect(result.reason).toContain('17:00')
  })
})

// ---------------------------------------------------------- slotsForDay ---

describe('slotsForDay', () => {
  it('returns slots inside the safe-contact window', () => {
    // Use a day well in the future so all slots pass the lead-time check.
    const day = new Date(NOW)
    day.setDate(day.getDate() + 5)
    const slots = slotsForDay({ day, now: NOW, window: WINDOW_10_17 })
    for (const s of slots) {
      const mins = s.getHours() * 60 + s.getMinutes()
      expect(mins).toBeGreaterThanOrEqual(10 * 60)
      expect(mins).toBeLessThanOrEqual(17 * 60)
    }
  })

  it('excludes slots in the past for today', () => {
    // NOW is 10:00; if step=30 the 10:00 slot fails the min-lead check.
    const slots = slotsForDay({ day: new Date(NOW), now: NOW, window: WINDOW_10_17 })
    for (const s of slots) {
      const leadMs = s.getTime() - NOW.getTime()
      expect(leadMs).toBeGreaterThanOrEqual(MIN_LEAD_MINUTES * 60_000)
    }
  })

  it('respects step', () => {
    const day = new Date(NOW)
    day.setDate(day.getDate() + 5)
    const slots = slotsForDay({ day, now: NOW, window: WINDOW_10_17, stepMinutes: 60 })
    for (const s of slots) {
      expect(s.getMinutes()).toBe(0)
    }
  })
})

// ---------------------------------------------------------- upcomingDays ---

describe('upcomingDays', () => {
  it('returns the requested count', () => {
    expect(upcomingDays(NOW, 14).length).toBe(14)
  })
  it('first day is today', () => {
    const days = upcomingDays(NOW)
    const first = days[0]
    expect(first.getFullYear()).toBe(NOW.getFullYear())
    expect(first.getMonth()).toBe(NOW.getMonth())
    expect(first.getDate()).toBe(NOW.getDate())
  })
  it('days are sequential', () => {
    const days = upcomingDays(NOW, 5)
    for (let i = 1; i < days.length; i++) {
      const diff = (days[i].getTime() - days[i - 1].getTime()) / 86_400_000
      expect(diff).toBe(1)
    }
  })
})
