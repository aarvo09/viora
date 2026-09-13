/* Text session screen — delegates to the existing `Session` component.
 *
 * The `Session` component already owns the text turn-taking and the mock-mode
 * scripted voice orb. This thin wrapper exists to:
 *   1. adapt its simple `onComplete(reportVersion)` to the app's richer
 *      signature (the next follow-up is read live by CompleteScreen anyway, so
 *      we hand null and let it fetch);
 *   2. keep the text↔voice switch wiring in one place for App.tsx.
 *
 * The voice entry point on this screen is the visible "Voice" control in the
 * header (which replaced the old corner link that the status bar was eating)
 * plus the mic button in the composer. Phase 4 rebuilds the composer row as
 * [mic][input][send]; this wrapper keeps the turn loop intact meanwhile.
 */

import { Session } from '../components/Session'

export function SessionScreen({
  uid,
  name,
  language,
  onComplete,
  onExit,
  onSwitchToVoice,
}: {
  uid: string
  name: string
  language: string
  onComplete: (reportVersion: number, nextFollowUp: string | null, nextChannel: string | null) => void
  onExit: () => void
  onSwitchToVoice?: () => void
}) {
  return (
    <Session
      uid={uid}
      name={name}
      language={language}
      initialChannel="TEXT"
      onComplete={(version) => onComplete(version, null, null)}
      onExit={onExit}
      onSwitchToVoice={onSwitchToVoice}
    />
  )
}
