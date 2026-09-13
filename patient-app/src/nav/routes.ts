/* Route union — the single place where every screen in the app is named.
 *
 * A route is a value that fully describes where the user is, including any
 * parameters needed to render that screen without further state lookups. This
 * keeps the navigator a pure stack-of-routes and avoids a parallel parameter
 * object that could fall out of sync.
 */

export type Tab = 'home' | 'checkins' | 'wellbeing' | 'profile'

export type Route =
  | { name: 'welcome' }
  | { name: 'pick' }
  | { name: 'tabs'; tab: Tab }
  | { name: 'checkinChoice' }
  | { name: 'session'; channel: 'TEXT' | 'VOICE' }
  | { name: 'complete'; reportVersion: number; nextFollowUp: string | null; nextChannel: string | null }
  | { name: 'scheduler'; mode: 'new' | 'reschedule' }
  | { name: 'historyDetail'; interactionId: number }
  | { name: 'support' }
