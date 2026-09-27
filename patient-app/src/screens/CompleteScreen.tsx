/* Post-check-in screen: "Check-in Complete", with the person's current
 * well-being, their trend, and when they'll be spoken to next.
 *
 * Fetches wellbeing fresh on mount rather than trusting the value handed
 * through the route, so a completed check-in always shows the number the
 * assessment actually wrote.
 *
 * Deliberately no score, no risk band, no "CRITICAL". The state is rendered
 * from `deriveWellbeing`, which inverts the composite into a steadiness reading
 * and drops empty reports.
 */

import { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { api } from '../api/client'
import type { PatientWellbeing } from '../api/types'
import { deriveWellbeing } from '../lib/wellbeing'
import { formatWhen } from '../lib/datetime'
import { colors, radius, shadow, space, trendTone, type as typeScale } from '../theme'
import { Screen } from '../ui/Screen'
import { Button, Chip, Enter } from '../ui/kit'
import { Icon } from '../ui/Icon'

export function CompleteScreen({
  name,
  uid,
  nextFollowUp,
  nextChannel,
  onDone,
}: {
  name: string
  uid: string
  reportVersion: number
  nextFollowUp: string | null
  nextChannel: string | null
  onDone: () => void
}) {
  const [wellbeing, setWellbeing] = useState<PatientWellbeing | null>(null)
  const scale = useRef(new Animated.Value(0.6)).current

  useEffect(() => {
    api.wellbeing(uid).then(setWellbeing).catch(() => setWellbeing(null))
  }, [uid])

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      useNativeDriver: true,
    }).start()
  }, [scale])

  const view = wellbeing ? deriveWellbeing(wellbeing) : null
  const trendStyle = view ? trendTone[view.trend.tone] : trendTone.neutral

  const followUp = wellbeing?.next_follow_up ?? nextFollowUp
  const channel = wellbeing?.next_follow_up_channel ?? nextChannel

  return (
    <Screen padded>
      <View style={styles.wrap}>
        {/* Animated check badge */}
        <Animated.View style={[styles.checkOuter, { transform: [{ scale }] }]}>
          <View style={styles.checkInner}>
            <Icon name="check" size={34} color="#fff" />
          </View>
        </Animated.View>

        <Enter index={1}>
          <Text style={styles.title}>Check-in Complete</Text>
          <Text style={styles.thanks}>Thank you, {name}.</Text>
          <Text style={styles.sub}>That was a lot, and you did it. Your words are safe here.</Text>
        </Enter>

        {view && (
          <Enter index={2}>
            <View style={[styles.stateCard, { backgroundColor: trendStyle.bg }]}>
              <Text style={[styles.stateWord, { color: trendStyle.fg }]}>{view.trend.word}</Text>
              <Text style={styles.stateHint}>{view.trend.hint}</Text>
            </View>
          </Enter>
        )}

        {followUp && (
          <Enter index={3}>
            <View style={styles.nextCard}>
              <Text style={styles.cardLabel}>Next Check-in</Text>
              <Text style={styles.nextTime}>{formatWhen(new Date(followUp), new Date())}</Text>
              <Chip
                label={channel === 'VOICE' ? 'Voice' : 'Text'}
                icon={channel === 'VOICE' ? 'mic' : 'chat'}
                tone="primary"
              />
            </View>
          </Enter>
        )}

        <Enter index={4}>
          <Button label="Back to Home" onPress={onDone} style={styles.doneBtn} />
        </Enter>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingBottom: space.xl },
  checkOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.button,
  },
  checkInner: { width: 84, height: 84, borderRadius: 42, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: typeScale.display, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  thanks: { fontSize: typeScale.md, color: colors.primary, fontWeight: '600', textAlign: 'center' },
  sub: { fontSize: typeScale.sm, color: colors.muted, textAlign: 'center', lineHeight: 22, paddingHorizontal: space.md },
  stateCard: { alignSelf: 'stretch', padding: space.md, borderRadius: radius.card, marginHorizontal: space.sm, alignItems: 'center', gap: 4 },
  stateWord: { fontSize: typeScale.md, fontWeight: '700' },
  stateHint: { fontSize: typeScale.xs, color: colors.inkSoft, textAlign: 'center', lineHeight: 18 },
  nextCard: { alignSelf: 'stretch', padding: space.md, borderRadius: radius.card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginHorizontal: space.sm },
  cardLabel: { fontSize: typeScale.xs, color: colors.muted, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  nextTime: { fontSize: typeScale.md, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  doneBtn: { alignSelf: 'stretch', marginHorizontal: space.sm },
})
