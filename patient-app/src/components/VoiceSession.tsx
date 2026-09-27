/* The real voice check-in screen — the orb driven by the actual turn loop.

This is the device-facing counterpart to the scripted flow in `Session.tsx`.
`Session` still owns the demo path (no microphone, no backend audio, safe for a
stage fallback); this component owns the path where a person really speaks and
`useVoiceTurn` really records, uploads and plays back.

Nothing here decides when a turn ends. That policy lives in `useVAD.ts` and is
reached only through the hook, so this file stays a view.

The one thing it must get right is telling the person whose turn it is. The orb
does that without words, and when the platform gives us no microphone levels it
also has to offer the tap that ends a turn — otherwise, with no way to hear that
someone stopped talking, a turn would only ever close on a timer.
*/

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useVoiceTurn } from '../hooks/useVoiceTurn'
import { colors, radius, space, type as typeScale } from '../theme'
import { Helplines } from './Helplines'
import { VoiceOrb, type OrbState } from './VoiceOrb'

/** Orb state for each phase of the loop.
 *
 *  CONNECTING reads as SPEAKING rather than as a spinner: the person has just
 *  chosen to talk, and a calm orb is a better first frame than a loading state. */
const ORB: Record<string, OrbState> = {
  CONNECTING: 'SPEAKING',
  SPEAKING: 'SPEAKING',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  ENDED: 'THINKING',
  ERROR: 'THINKING',
}

/* Bilingual, because all three test users are Hindi speakers and the English is
   what a caseworker standing beside them reads. */
const LABEL: Record<string, { en: string; hi: string }> = {
  CONNECTING: { en: 'Connecting…', hi: 'जुड़ रही हूँ' },
  SPEAKING: { en: 'Speaking…', hi: 'बोल रही हूँ' },
  LISTENING: { en: 'Listening…', hi: 'आप बोलिए, मैं सुन रही हूँ' },
  THINKING: { en: 'Thinking…', hi: 'आपकी बात समझ रही हूँ' },
  ENDED: { en: 'Finished', hi: 'बात पूरी हुई' },
  ERROR: { en: 'Something went wrong', hi: 'कुछ गड़बड़ हुई' },
}

export function VoiceSession({
  uid,
  name,
  language,
  onComplete,
  onExit,
  onSwitchToText,
}: {
  uid: string
  name: string
  language: string
  onComplete: (reportVersion: number) => void
  onExit: () => void
  /** Dropping to text must always be one tap away: a spoken conversation can be
   *  overheard by the person someone is afraid of. */
  onSwitchToText: () => void
}) {
  const voice = useVoiceTurn({
    uid,
    language,
    enabled: true,
    onEnded: () => {},
  })

  const label = LABEL[voice.phase] ?? LABEL.THINKING
  /* The tap is offered only when it is the only way to finish a turn — where
     metering works, sustained silence ends it and a button would just add a
     decision the person does not need to make. */
  const showDone = voice.phase === 'LISTENING' && voice.listenMode === 'DURATION'

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onExit} hitSlop={16}>
          <Text style={styles.exit}>Exit</Text>
        </Pressable>
        <Text style={styles.name}>{name}</Text>
        <Pressable onPress={onSwitchToText} hitSlop={16}>
          <Text style={styles.mode}>Text</Text>
        </Pressable>
      </View>

      <VoiceOrb state={ORB[voice.phase] ?? 'THINKING'} label={label.en} sublabel={label.hi} />

      {showDone && (
        <Pressable style={styles.done} onPress={voice.finishSpeaking}>
          <Text style={styles.doneText}>Done speaking</Text>
          <Text style={styles.doneSub}>बात पूरी हुई</Text>
        </Pressable>
      )}

      {voice.crisis && <Helplines />}

      {voice.error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{voice.error}</Text>
          <Pressable onPress={onSwitchToText}>
            <Text style={styles.errorAction}>Use text instead</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        style={styles.end}
        onPress={async () => {
          const version = await voice.end()
          if (version != null) onComplete(version)
        }}
        disabled={voice.phase === 'ENDED'}
      >
        <Text style={styles.endText}>End check-in</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: space.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: space.md,
  },
  exit: { color: colors.muted, fontSize: typeScale.xs, textDecorationLine: 'underline' },
  name: { fontSize: typeScale.md, fontWeight: '600', color: colors.ink },
  mode: { color: colors.primary, fontSize: typeScale.xs, fontWeight: '600' },
  done: {
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    marginBottom: space.md,
  },
  doneText: { color: colors.primary, fontSize: typeScale.md, fontWeight: '600' },
  doneSub: { color: colors.muted, fontSize: typeScale.sm, marginTop: 2 },
  errorBox: {
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    gap: space.xs,
  },
  errorText: { color: colors.ink, fontSize: typeScale.sm },
  errorAction: { color: colors.primary, fontSize: typeScale.sm, fontWeight: '600' },
  end: { alignSelf: 'center', padding: space.md },
  endText: { color: colors.muted, fontSize: typeScale.sm, textDecorationLine: 'underline' },
})
