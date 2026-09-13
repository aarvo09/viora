/* The voice call screen — Stitch "Serene Well-Being" Voice Sanctuary.
 *
 * Source of truth: Stitch Project 10820896350954981900 / screen 165a29ca4a3848b594b2f2167d4fdfa8
 *
 * Preserves completely:
 * - `useVoiceTurn` audio turn-taking loop with expo-av and Android dBFS normalization
 * - Real speech level reactivity on the VoiceOrb
 * - Mute toggling, crisis handling, and exit/completion routing
 */

import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useVoiceTurn } from '../hooks/useVoiceTurn'
import { formatDuration } from '../lib/datetime'
import { colors, radius, shadow, space, type as typeScale } from '../theme'
import { Screen } from '../ui/Screen'
import { Icon } from '../ui/Icon'
import { Helplines } from '../components/Helplines'
import { VoiceOrb, type OrbState } from '../components/VoiceOrb'

const ORB: Record<string, OrbState> = {
  CONNECTING: 'SPEAKING',
  SPEAKING: 'SPEAKING',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  ENDED: 'THINKING',
  ERROR: 'THINKING',
}

const LABEL: Record<string, { en: string; hi: string }> = {
  CONNECTING: { en: 'Connecting…', hi: 'जुड़ रही हूँ' },
  SPEAKING: { en: 'VIORA is speaking…', hi: 'बोल रही हूँ' },
  LISTENING: { en: 'Listening to you…', hi: 'आप बोलिए, मैं सुन रही हूँ' },
  THINKING: { en: 'Reflecting…', hi: 'आपकी बात समझ रही हूँ' },
  ENDED: { en: 'Finished', hi: 'बात पूरी हुई' },
  ERROR: { en: 'Something went wrong', hi: 'कुछ गड़बड़ हुई' },
}

export function VoiceCallScreen({
  uid,
  language,
  onComplete,
  onExit,
  onSwitchToText,
}: {
  uid: string
  name: string
  language: string
  onComplete: (reportVersion: number, nextFollowUp: string | null, nextChannel: string | null) => void
  onExit: () => void
  onSwitchToText: () => void
}) {
  const voice = useVoiceTurn({ uid, language, enabled: true, onEnded: () => {} })
  const [elapsed, setElapsed] = useState(0)
  const [ending, setEnding] = useState(false)

  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Date.now() - started), 500)
    return () => clearInterval(timer)
  }, [])

  const label = LABEL[voice.phase] ?? LABEL.THINKING
  const showDone = voice.phase === 'LISTENING' && voice.listenMode === 'DURATION'
  const subtitles = voice.messages.slice(-3)

  const endCall = async () => {
    if (ending) return
    setEnding(true)
    const version = await voice.end()
    if (version != null) onComplete(version, null, null)
    else setEnding(false)
  }

  return (
    <Screen padded>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <Pressable onPress={onExit} style={styles.backBtn} accessibilityLabel="Exit call">
          <Icon name="close" size={20} color={colors.ink} />
        </Pressable>
        <View style={styles.headerTitleRow}>
          <View style={styles.headerEmblem}>
            <Icon name="shield" size={16} color={colors.primary} />
          </View>
          <Text style={styles.headerTitle}>Active Session</Text>
        </View>
        <View style={styles.placeholderBox} />
      </View>

      {/* Call Metas Strip */}
      <View style={styles.metaStrip}>
        <View style={styles.metaLeft}>
          <View style={styles.liveChip}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
          <View style={styles.timerChip}>
            <Text style={styles.timerText}>{formatDuration(elapsed)}</Text>
          </View>
        </View>

        <View style={styles.langPill}>
          <Text style={styles.langText}>
            {language === 'hi' ? 'हिंदी / English' : 'English / हिंदी'}
          </Text>
        </View>
      </View>

      {/* Center Voice Orb Stage */}
      <View style={styles.stage}>
        <VoiceOrb
          state={ORB[voice.phase] ?? 'THINKING'}
          label={label.en}
          sublabel={label.hi}
          level={voice.level}
        />
      </View>

      {/* Subtitles / Real-Time Dialogue Stream Card */}
      <View style={styles.subtitleCard}>
        <View style={styles.subtitleAccentBar} />
        <View style={styles.subtitleContent}>
          <View style={styles.subtitleHeaderRow}>
            <Text style={styles.subtitleHeader}>VIORA COMPANION</Text>
          </View>
          <ScrollView
            style={styles.subtitlesScroll}
            contentContainerStyle={styles.subtitlesInner}
            showsVerticalScrollIndicator={false}
          >
            {subtitles.length === 0 ? (
              <Text style={styles.subtitlePrompt}>
                "I'm listening whenever you're ready to share..."
              </Text>
            ) : (
              subtitles.map((m, i) => (
                <Text
                  key={i}
                  style={[
                    styles.subtitleText,
                    m.role === 'VIORA' ? styles.subtitleViora : styles.subtitleUser,
                    i === subtitles.length - 1 && styles.subtitleLatest,
                  ]}
                >
                  {m.role === 'VIORA' ? '' : 'You: '}
                  {m.text}
                </Text>
              ))
            )}
          </ScrollView>
        </View>
      </View>

      {/* Crisis Panel if Triggered */}
      {voice.crisis && <Helplines />}

      {/* Error Banner if Any */}
      {voice.error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{voice.error}</Text>
          <Pressable onPress={onSwitchToText}>
            <Text style={styles.errorAction}>Switch to text instead</Text>
          </Pressable>
        </View>
      )}

      {/* Manual "Done speaking" button if no audio levels */}
      {showDone && (
        <Pressable style={styles.doneBtn} onPress={voice.finishSpeaking}>
          <Text style={styles.doneText}>Done speaking</Text>
          <Text style={styles.doneSub}>बात पूरी हुई</Text>
        </Pressable>
      )}

      {/* Bottom Interactive Control Tray */}
      <View style={styles.controlTray}>
        <View style={styles.mainButtonsRow}>
          {/* Mute Button */}
          <Pressable
            onPress={() => voice.setMuted(!voice.muted)}
            style={[styles.roundControlBtn, voice.muted && styles.roundControlBtnActive]}
            accessibilityLabel={voice.muted ? 'Unmute' : 'Mute'}
          >
            <Icon
              name={voice.muted ? 'muted' : 'mic'}
              size={24}
              color={voice.muted ? colors.primary : colors.inkSoft}
            />
          </Pressable>

          {/* End Call Button (Heroic, Red, 64px) */}
          <Pressable
            onPress={endCall}
            disabled={ending}
            style={({ pressed }) => [
              styles.endCallBtn,
              pressed && { opacity: 0.9, transform: [{ scale: 0.94 }] },
            ]}
            accessibilityLabel="End call"
          >
            <Icon name="phone" size={28} color="#FFFFFF" />
          </Pressable>

          {/* Speaker Button (State indicator) */}
          <View style={styles.roundControlBtn}>
            <Icon name="speaker" size={24} color={colors.primary} />
          </View>
        </View>

        {/* Quick Switch to Text Button */}
        <Pressable
          onPress={onSwitchToText}
          style={({ pressed }) => [
            styles.switchTextBtn,
            pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
          ]}
        >
          <Icon name="chat" size={18} color={colors.primary} />
          <Text style={styles.switchTextLabel}>Switch to Text Chat</Text>
        </Pressable>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.xs,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerEmblem: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typeScale.base,
    fontWeight: '700',
    color: colors.ink,
  },
  placeholderBox: {
    width: 40,
  },
  metaStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.xs,
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.tertiary,
  },
  liveText: {
    fontSize: typeScale.xs,
    fontWeight: '800',
    color: colors.tertiaryDeep,
    textTransform: 'uppercase',
  },
  timerChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  timerText: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.inkSoft,
    fontVariant: ['tabular-nums'],
  },
  langPill: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.subtle,
  },
  langText: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.primary,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 280,
  },
  subtitleCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.subtle,
    position: 'relative',
    overflow: 'hidden',
    marginBottom: space.sm,
    maxHeight: 120,
  },
  subtitleAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: colors.primary,
  },
  subtitleContent: {
    paddingLeft: space.xs,
    gap: 4,
  },
  subtitleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subtitleHeader: {
    fontSize: typeScale.xs - 2,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 1,
  },
  subtitlesScroll: {
    maxHeight: 70,
  },
  subtitlesInner: {
    gap: 4,
  },
  subtitlePrompt: {
    fontSize: typeScale.sm,
    color: colors.inkSoft,
    fontStyle: 'italic',
  },
  subtitleText: {
    fontSize: typeScale.sm,
    lineHeight: 20,
  },
  subtitleViora: {
    color: colors.ink,
    fontWeight: '600',
  },
  subtitleUser: {
    color: colors.muted,
  },
  subtitleLatest: {
    opacity: 1,
  },
  doneBtn: {
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: space.lg,
    marginBottom: space.xs,
  },
  doneText: {
    color: colors.primary,
    fontSize: typeScale.sm,
    fontWeight: '700',
  },
  doneSub: {
    color: colors.muted,
    fontSize: typeScale.xs,
  },
  errorBox: {
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.riskCritical,
    gap: 2,
    marginBottom: space.xs,
  },
  errorText: {
    color: colors.riskCritical,
    fontSize: typeScale.xs,
  },
  errorAction: {
    color: colors.primary,
    fontSize: typeScale.xs,
    fontWeight: '700',
  },
  controlTray: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xs,
    paddingBottom: space.sm,
  },
  mainButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: '100%',
    paddingHorizontal: space.md,
  },
  roundControlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.subtle,
  },
  roundControlBtnActive: {
    backgroundColor: colors.primaryTint,
  },
  endCallBtn: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: colors.riskCritical,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '135deg' }],
    ...shadow.button,
  },
  switchTextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  switchTextLabel: {
    fontSize: typeScale.sm,
    fontWeight: '700',
    color: colors.ink,
  },
})
