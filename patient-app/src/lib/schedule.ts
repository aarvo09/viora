/* Scheduling rules for a patient choosing their own next check-in.
 *
 * PURE — no imports, node-testable.
 *
 * This is net-new policy. `safe_contact_start`, `safe_contact_end` and
 * `User.timezone` have existed on the model since the first migration and are
 * returned by the API, but nothing in the backend has ever enforced them: only
 * `seed.py` writes them and only the counsellor view reads them, for display. A
 * predicted follow-up can therefore land at 3am, and until now nothing objected.
 *
 * The safe-contact window is not a preference. For someone whose abuser may be
 * in the house, "call me between 10 and 5" means "those are the hours I am
 * alone" — a check-in outside that window can put a person in danger, which is
 * why an out-of-window slot is refused outright rather than merely discouraged.
 */

export interface SafeWindow {
  /** "HH:MM" local to the person. */
  start: string
  end: string
}

export interface SlotCheck {
  ok: boolean
  /** Why not, phrased for the person rather than for a log. */
  reason?: string
  code?: 'PAST' | 'TOO_SOON' | 'TOO_FAR' | 'OUTSIDE_WINDOW' | 'BAD_WINDOW'
}

/** A slot must be at least this far out. Booking a check-in for 30 seconds from
 *  now is a mis-tap, not an intention. */
export const MIN_LEAD_MINUTES = 15

/** And no further than this. Beyond a couple of months the schedule stops
 *  meaning anything, and the clinical cadence should be driving it by then. */
export const MAX_LEAD_DAYS = 60

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Is `minutes` inside the window?
 *
 *  Windows that wrap past midnight (22:00 → 06:00) are supported: the test
 *  flips to a union of two ranges. No seeded profile uses one today, but a
 *  night-shift worker's safe hours legitimately look like that, and silently
 *  rejecting every slot would be a confusing way to find out.
 */
export function withinWindow(minutes: number, window: SafeWindow): boolean {
  const start = parseClock(window.start)
  const end = parseClock(window.end)
  if (start == null || end == null) return true // unusable window: do not block
  if (start === end) return true // a zero-width window is treated as "any time"
  if (start < end) return minutes >= start && minutes <= end
  return minutes >= start || minutes <= end
}

/** Validate a chosen slot.
 *
 *  `when` and `now` are both local Dates. The person's timezone is handled by
 *  the device already being in it — the backend re-checks against the stored
 *  timezone, so this is the friendly first pass, not the only guard.
 */
export function validateSlot({
  when,
  now,
  window,
}: {
  when: Date
  now: Date
  window: SafeWindow
}): SlotCheck {
  if (Number.isNaN(when.getTime())) {
    return { ok: false, code: 'PAST', reason: 'That does not look like a valid time.' }
  }

  const leadMs = when.getTime() - now.getTime()
  if (leadMs <= 0) {
    return { ok: false, code: 'PAST', reason: 'Please choose a time in the future.' }
  }
  if (leadMs < MIN_LEAD_MINUTES * 60_000) {
    return {
      ok: false,
      code: 'TOO_SOON',
      reason: `Please choose a time at least ${MIN_LEAD_MINUTES} minutes from now.`,
    }
  }
  if (leadMs > MAX_LEAD_DAYS * 86_400_000) {
    return {
      ok: false,
      code: 'TOO_FAR',
      reason: `Please choose a time within the next ${MAX_LEAD_DAYS} days.`,
    }
  }

  const minutes = when.getHours() * 60 + when.getMinutes()
  if (!withinWindow(minutes, window)) {
    return {
      ok: false,
      code: 'OUTSIDE_WINDOW',
      reason: `Your safe hours are ${window.start} to ${window.end}. Please pick a time in that range.`,
    }
  }

  return { ok: true }
}

/** The selectable times for a given day, on the half hour, inside the safe
 *  window and after `now`. This is what the scheduler screen renders, so an
 *  unpickable time is never shown in the first place — a disabled grid of
 *  mostly-grey slots reads as a broken screen. */
export function slotsForDay({
  day,
  now,
  window,
  stepMinutes = 30,
}: {
  day: Date
  now: Date
  window: SafeWindow
  stepMinutes?: number
}): Date[] {
  const start = parseClock(window.start)
  const end = parseClock(window.end)
  if (start == null || end == null) return []

  const out: Date[] = []
  // A wrapping window is walked as start→midnight→end; a normal one start→end.
  const span = start <= end ? end - start : 1440 - start + end

  for (let offset = 0; offset <= span; offset += stepMinutes) {
    const minutes = (start + offset) % 1440
    const slot = new Date(day)
    slot.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
    // A wrapped slot belongs to the following calendar day.
    if (start > end && minutes < start) slot.setDate(slot.getDate() + 1)

    if (validateSlot({ when: slot, now, window }).ok) out.push(slot)
  }
  return out
}

/** The next `count` days starting today — the date strip at the top of the
 *  scheduler. */
export function upcomingDays(now: Date, count = 14): Date[] {
  const out: Date[] = []
  for (let i = 0; i < count; i += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    day.setDate(day.getDate() + i)
    out.push(day)
  }
  return out
}
