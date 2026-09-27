import { describe, expect, it } from 'vitest'
import {
  bucketFor,
  daysBetween,
  formatClock,
  formatDate,
  formatDuration,
  formatTime,
  formatWhen,
  groupByDay,
  humanClock,
  parseClock,
  relativeDay,
  timeUntil,
} from './datetime'

// Anchor. The functions use local time, so this is fine without timezone mocking.
const NOW = new Date('2026-09-09T14:30:00')

function hoursAgo(h: number) {
  return new Date(NOW.getTime() - h * 3_600_000)
}
function daysAgo(d: number) {
  const dt = new Date(NOW)
  dt.setDate(dt.getDate() - d)
  return dt
}
function daysAhead(d: number) {
  const dt = new Date(NOW)
  dt.setDate(dt.getDate() + d)
  return dt
}

// ----------------------------------------------------------------- buckets ---

describe('daysBetween', () => {
  it('same day → 0', () => {
    expect(daysBetween(NOW, new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 0, 0, 0))).toBe(0)
  })
  it('23h before midnight vs 1h after midnight → still 1 day apart', () => {
    const late = new Date('2026-09-09T23:00:00')
    const early = new Date('2026-09-10T01:00:00')
    expect(daysBetween(late, early)).toBe(-1)
  })
  it('one calendar day ago', () => {
    expect(daysBetween(daysAgo(1), NOW)).toBe(-1)
  })
})

describe('bucketFor', () => {
  it('same day → Today', () => expect(bucketFor(hoursAgo(1), NOW)).toBe('Today'))
  it('1 day ago → Yesterday', () => expect(bucketFor(daysAgo(1), NOW)).toBe('Yesterday'))
  it('2 days ago → Earlier', () => expect(bucketFor(daysAgo(2), NOW)).toBe('Earlier'))
})

describe('groupByDay', () => {
  const items = [
    { label: 'A', at: hoursAgo(2).toISOString() },
    { label: 'B', at: daysAgo(1).toISOString() },
    { label: 'C', at: daysAgo(3).toISOString() },
    { label: 'D', at: daysAgo(4).toISOString() },
  ]

  it('produces three buckets in order', () => {
    const result = groupByDay(items, (i) => i.at, NOW)
    expect(result.map((r) => r.bucket)).toEqual(['Today', 'Yesterday', 'Earlier'])
  })

  it('groups correctly', () => {
    const result = groupByDay(items, (i) => i.at, NOW)
    expect(result.find((r) => r.bucket === 'Today')?.items.map((i) => i.label)).toEqual(['A'])
    expect(result.find((r) => r.bucket === 'Earlier')?.items.map((i) => i.label)).toEqual(['C', 'D'])
  })

  it('skips empty buckets', () => {
    const noYesterday = [items[0], items[2]]
    const result = groupByDay(noYesterday, (i) => i.at, NOW)
    expect(result.some((r) => r.bucket === 'Yesterday')).toBe(false)
  })

  it('silently drops items with invalid dates', () => {
    const withBad = [...items, { label: 'X', at: 'not-a-date' }]
    const result = groupByDay(withBad, (i) => i.at, NOW)
    const total = result.reduce((n, r) => n + r.items.length, 0)
    expect(total).toBe(items.length)
  })
})

// --------------------------------------------------------------- formatting ---

describe('formatTime', () => {
  it('midnight → 12:00 am', () => expect(formatTime(new Date('2026-09-09T00:00:00'))).toBe('12:00 am'))
  it('noon → 12:00 pm', () => expect(formatTime(new Date('2026-09-09T12:00:00'))).toBe('12:00 pm'))
  it('23:30 → 11:30 pm', () => expect(formatTime(new Date('2026-09-09T23:30:00'))).toBe('11:30 pm'))
  it('09:05 → 9:05 am', () => expect(formatTime(new Date('2026-09-09T09:05:00'))).toBe('9:05 am'))
})

describe('relativeDay', () => {
  it('today', () => expect(relativeDay(NOW, NOW)).toBe('Today'))
  it('tomorrow', () => expect(relativeDay(daysAhead(1), NOW)).toBe('Tomorrow'))
  it('yesterday', () => expect(relativeDay(daysAgo(1), NOW)).toBe('Yesterday'))
  it('6 days ahead → weekday name', () => {
    const d = relativeDay(daysAhead(6), NOW)
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    expect(weekdays).toContain(d)
  })
  it('14 days ahead → date string', () => {
    const d = relativeDay(daysAhead(14), NOW)
    expect(d).toMatch(/^\d+ [A-Z][a-z]+$/)
  })
})

describe('formatDate', () => {
  it('formats as day + abbreviated month', () => {
    expect(formatDate(new Date('2026-09-09T12:00:00'))).toBe('9 Sep')
  })
})

describe('formatWhen', () => {
  it('tomorrow + time', () => {
    const tomorrow = daysAhead(1)
    tomorrow.setHours(11, 0, 0, 0)
    expect(formatWhen(tomorrow, NOW)).toBe('Tomorrow, 11:00 am')
  })
})

describe('formatDuration', () => {
  it('0ms → 0:00', () => expect(formatDuration(0)).toBe('0:00'))
  it('90s → 1:30', () => expect(formatDuration(90_000)).toBe('1:30'))
  it('3661s → 1:01:01', () => expect(formatDuration(3_661_000)).toBe('1:01:01'))
  it('negative → 0:00', () => expect(formatDuration(-1000)).toBe('0:00'))
})

describe('timeUntil', () => {
  it('past → now', () => expect(timeUntil(hoursAgo(1), NOW)).toBe('now'))
  it('45 min → in 45 min', () => expect(timeUntil(new Date(NOW.getTime() + 45 * 60_000), NOW)).toBe('in 45 min'))
  it('3 hours', () => expect(timeUntil(new Date(NOW.getTime() + 3 * 3_600_000), NOW)).toBe('in 3 hours'))
  it('1 hour (singular)', () => expect(timeUntil(new Date(NOW.getTime() + 3_700_000), NOW)).toBe('in 1 hour'))
  it('2 days', () => expect(timeUntil(new Date(NOW.getTime() + 2 * 86_400_000), NOW)).toBe('in 2 days'))
})

describe('parseClock / formatClock / humanClock', () => {
  it('valid "10:30" → 630', () => expect(parseClock('10:30')).toBe(630))
  it('valid "0:00" → 0', () => expect(parseClock('0:00')).toBe(0))
  it('valid "23:59" → 1439', () => expect(parseClock('23:59')).toBe(1439))
  it('invalid "24:00" → null', () => expect(parseClock('24:00')).toBeNull())
  it('invalid "10:61" → null', () => expect(parseClock('10:61')).toBeNull())
  it('invalid text → null', () => expect(parseClock('noon')).toBeNull())
  it('formatClock round-trips', () => expect(formatClock(630)).toBe('10:30'))
  it('formatClock pads', () => expect(formatClock(65)).toBe('01:05'))
  it('humanClock converts "09:00" to 12h', () => expect(humanClock('09:00')).toBe('9:00 am'))
  it('humanClock converts "17:00"', () => expect(humanClock('17:00')).toBe('5:00 pm'))
})
