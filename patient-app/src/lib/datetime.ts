/* Date and time formatting for patient-facing screens.
 *
 * PURE. No imports at all — not even from 'react-native'. That is deliberate
 * and it is the pattern `audioFormat.ts` and `useVAD.ts` already follow: it
 * lets vitest run these in plain node with no renderer and no native mocks.
 * Anything in here that needed a RN import would have to move to a component.
 *
 * Everything takes an explicit `now`, so tests are not hostage to the clock and
 * "today" means the same thing on every run.
 */

export type DayBucket = 'Today' | 'Yesterday' | 'Earlier'

/** Calendar-day difference in LOCAL time.
 *
 *  Not `(a - b) / 86400000`: that measures elapsed hours, so 11pm and 1am four
 *  hours apart would count as the same day. A check-in last night must read as
 *  "Yesterday", so the comparison is on calendar date with the clock zeroed.
 */
export function daysBetween(a: Date, b: Date): number {
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((dayA - dayB) / 86_400_000)
}

export function bucketFor(when: Date, now: Date): DayBucket {
  const delta = daysBetween(when, now)
  if (delta === 0) return 'Today'
  if (delta === -1) return 'Yesterday'
  return 'Earlier'
}

/** Group items into Today / Yesterday / Earlier, preserving input order inside
 *  each bucket and dropping empty buckets. The history screen renders the
 *  result directly, so the bucket order here is the on-screen order. */
export function groupByDay<T>(
  items: T[],
  at: (item: T) => string | Date,
  now: Date,
): { bucket: DayBucket; items: T[] }[] {
  const order: DayBucket[] = ['Today', 'Yesterday', 'Earlier']
  const buckets = new Map<DayBucket, T[]>()

  for (const item of items) {
    const when = at(item) instanceof Date ? (at(item) as Date) : new Date(at(item) as string)
    if (Number.isNaN(when.getTime())) continue
    const key = bucketFor(when, now)
    const list = buckets.get(key)
    if (list) list.push(item)
    else buckets.set(key, [item])
  }

  return order
    .filter((b) => (buckets.get(b)?.length ?? 0) > 0)
    .map((b) => ({ bucket: b, items: buckets.get(b) as T[] }))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 12-hour clock with am/pm. India reads both, and am/pm removes the "is 18:00
 *  the evening?" pause for a low-literacy reader. */
export function formatTime(when: Date): string {
  const hours = when.getHours()
  const suffix = hours < 12 ? 'am' : 'pm'
  const twelve = hours % 12 === 0 ? 12 : hours % 12
  return `${twelve}:${pad(when.getMinutes())} ${suffix}`
}

export function formatDate(when: Date): string {
  return `${when.getDate()} ${MONTHS[when.getMonth()]}`
}

export function weekdayOf(when: Date): string {
  return WEEKDAYS[when.getDay()]
}

/** "Today", "Tomorrow", "Yesterday", "Thursday", or a date once it is far
 *  enough out that a weekday name stops being useful. */
export function relativeDay(when: Date, now: Date): string {
  const delta = daysBetween(when, now)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  if (delta === -1) return 'Yesterday'
  if (delta > 1 && delta < 7) return weekdayOf(when)
  return formatDate(when)
}

/** The next-check-in line: "Tomorrow, 11:00 am". */
export function formatWhen(when: Date, now: Date): string {
  return `${relativeDay(when, now)}, ${formatTime(when)}`
}

/** Elapsed call time as m:ss (or h:mm:ss past an hour). Drives the voice
 *  screen's duration readout. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}

/** "in 3 days" / "in 4 hours" / "now" — for a due-check-in banner, where the
 *  distance matters more than the timestamp. */
export function timeUntil(when: Date, now: Date): string {
  const ms = when.getTime() - now.getTime()
  if (ms <= 0) return 'now'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.round(ms / 3_600_000)
  if (hours < 24) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const days = Math.round(ms / 86_400_000)
  return `in ${days} ${days === 1 ? 'day' : 'days'}`
}

/** Parse "HH:MM" into minutes since midnight, or null when malformed. Shared by
 *  the scheduler's safe-contact check and the profile editor's validation. */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Minutes since midnight back to "HH:MM". */
export function formatClock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`
}

/** "10:00" → "10:00 am", for showing a safe-contact window to the person. */
export function humanClock(value: string): string {
  const minutes = parseClock(value)
  if (minutes == null) return value
  const hours = Math.floor(minutes / 60)
  const suffix = hours < 12 ? 'am' : 'pm'
  const twelve = hours % 12 === 0 ? 12 : hours % 12
  return `${twelve}:${pad(minutes % 60)} ${suffix}`
}
