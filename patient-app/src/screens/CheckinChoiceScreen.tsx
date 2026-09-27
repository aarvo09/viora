/* CheckinChoiceScreen — Stitch "Serene Well-Being" Check-in Selection.
 *
 * Source of truth: Stitch Project 10820896350954981900 / screen 49fcb21ca0cb484c98894df6231c518b
 *
 * Presents Voice Call (Luminous, Natural Flow) vs Text Chat (Quiet, Unhurried)
 * with gentle sanctuary framing and safety assurance.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { PatientProfile } from '../api/types'
import { colors, radius, shadow, space, type as typeScale } from '../theme'
import { Screen } from '../ui/Screen'
import { Enter, Header } from '../ui/kit'
import { Icon } from '../ui/Icon'

export function CheckinChoiceScreen({
  profile: _profile,
  onText,
  onVoice,
  onBack,
}: {
  profile: PatientProfile
  onText: () => void
  onVoice: () => void
  onBack: () => void
}) {
  return (
    <Screen scroll padded>
      <Enter index={0}>
        <Header title="Start Check-in" onBack={onBack} />
      </Enter>

      {/* Gentle Sanctuary Framing Header */}
      <Enter index={1}>
        <View style={styles.promptCard}>
          <View style={styles.promptGlow} />
          <View style={styles.sanctuaryChip}>
            <View style={styles.sanctuaryDot} />
            <Text style={styles.sanctuaryText}>Gentle Sanctuary</Text>
          </View>
          <Text style={styles.promptTitle}>How would you like to connect?</Text>
          <Text style={styles.promptSub}>
            Choose whichever feels most comfortable right now. There is no rush.
          </Text>
        </View>
      </Enter>

      {/* 1. Voice Call Card (Luminous & Recommended) */}
      <Enter index={2}>
        <View style={styles.choiceCard}>
          <View style={styles.choiceGlow} />
          <View style={styles.choiceTopRow}>
            <View style={styles.badgePill}>
              <Text style={styles.badgeText}>Recommended for natural flow</Text>
            </View>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live Companion</Text>
            </View>
          </View>

          <View style={styles.cardMain}>
            <View style={styles.orbAvatar}>
              <View style={styles.orbHalo} />
              <View style={styles.orbCore}>
                <Icon name="mic" size={26} color="#FFFFFF" />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.choiceTitle}>Voice Call</Text>
              <Text style={styles.choiceDescription}>
                Speak naturally with VIORA, in Hindi or English, hands-free.
              </Text>
            </View>
          </View>

          <View style={styles.tagRow}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>Hands-free</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagText}>Real-time voice</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagText}>English &amp; हिंदी</Text>
            </View>
          </View>

          <Pressable
            onPress={onVoice}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            ]}
          >
            <Text style={styles.primaryButtonText}>Start Voice Call</Text>
            <Icon name="chevron" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </Enter>

      {/* 2. Text Chat Card (Quiet & Private) */}
      <Enter index={3}>
        <View style={[styles.choiceCard, styles.choiceCardSecondary]}>
          <View style={styles.choiceTopRow}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>Quiet &amp; Unhurried</Text>
            </View>
            <Text style={styles.secondaryMeta}>Self-paced</Text>
          </View>

          <View style={styles.cardMain}>
            <View style={styles.textIconBox}>
              <Icon name="chat" size={26} color={colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.choiceTitle}>Text Chat</Text>
              <Text style={styles.choiceDescription}>
                Share at your own pace. Type thoughtful messages and read replies comfortably.
              </Text>
            </View>
          </View>

          <View style={styles.tagRow}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>Private</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagText}>Take your time</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagText}>Encrypted</Text>
            </View>
          </View>

          <Pressable
            onPress={onText}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            ]}
          >
            <Text style={styles.secondaryButtonText}>Start Text Chat</Text>
            <Icon name="chevron" size={18} color={colors.ink} />
          </Pressable>
        </View>
      </Enter>

      {/* Safety & Confidentiality Note */}
      <Enter index={4}>
        <View style={styles.safetyNote}>
          <Icon name="shield" size={18} color={colors.primary} />
          <Text style={styles.safetyNoteText}>
            A voice check-in can be overheard. If someone is nearby, text is
            quieter. You can switch between them mid-conversation anytime.
          </Text>
        </View>
      </Enter>
    </Screen>
  )
}

const styles = StyleSheet.create({
  promptCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.lg,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.subtle,
    gap: space.xs,
    marginBottom: space.md,
  },
  promptGlow: {
    position: 'absolute',
    top: -30,
    right: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primaryTint,
    opacity: 0.5,
  },
  sanctuaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
  sanctuaryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.tertiary,
  },
  sanctuaryText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.inkSoft,
  },
  promptTitle: {
    fontSize: typeScale.lg,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.3,
  },
  promptSub: {
    fontSize: typeScale.sm,
    color: colors.muted,
    lineHeight: 20,
  },
  choiceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
    gap: space.md,
    position: 'relative',
    overflow: 'hidden',
    marginBottom: space.md,
  },
  choiceCardSecondary: {
    ...shadow.subtle,
  },
  choiceGlow: {
    position: 'absolute',
    bottom: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primaryTint,
    opacity: 0.6,
  },
  choiceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgePill: {
    backgroundColor: colors.primaryTint,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.primaryDeep,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  liveText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  secondaryMeta: {
    fontSize: typeScale.xs,
    color: colors.muted,
    fontWeight: '600',
  },
  cardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  orbAvatar: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  orbHalo: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryTint,
    opacity: 0.8,
  },
  orbCore: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textIconBox: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.secondaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceTitle: {
    fontSize: typeScale.md,
    fontWeight: '800',
    color: colors.ink,
  },
  choiceDescription: {
    fontSize: typeScale.xs + 1,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 18,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  tagText: {
    fontSize: typeScale.xs - 1,
    color: colors.inkSoft,
    fontWeight: '600',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.pill,
    ...shadow.button,
  },
  primaryButtonText: {
    fontSize: typeScale.base,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 14,
    borderRadius: radius.pill,
  },
  secondaryButtonText: {
    fontSize: typeScale.base,
    fontWeight: '700',
    color: colors.ink,
  },
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.card,
    padding: space.md,
    marginTop: space.xs,
  },
  safetyNoteText: {
    flex: 1,
    fontSize: typeScale.xs,
    color: colors.muted,
    lineHeight: 18,
  },
})
