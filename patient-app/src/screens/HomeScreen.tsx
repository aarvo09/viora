/* Home screen — Stitch "Serene Well-Being" Design.
 *
 * Source of truth: Stitch Project 10820896350954981900 / screen 7f36997034c44933a8258285514fbc9a
 *
 * Features:
 * - Date Chip & Personalized Morning/Afternoon Greeting
 * - Hero Luminous "Start a Check-in" 24/7 Card
 * - Next Check-in Tile with Reschedule Action
 * - Steadiness Index Score (0-100 gentle scale) & 7-Day Sparkline
 * - Recent Activity list
 * - Warm "Need support?" Helpline Gateway Card
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { api } from '../api/client'
import type { DueCall, HistoryItem, PatientProfile, PatientWellbeing } from '../api/types'
import { deriveWellbeing } from '../lib/wellbeing'
import { formatWhen } from '../lib/datetime'
import { greetingFor } from '../lib/greeting'
import { colors, radius, shadow, space, trendTone, type as typeScale } from '../theme'
import { Screen } from '../ui/Screen'
import { Enter } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { useInsets } from '../ui/insets'
import type { Navigator } from '../nav/useNavigator'

/* Sparkline curve using Views */
function Sparkline({ points }: { points: { value: number }[] }) {
  if (points.length === 0) return null
  const W = 160
  const H = 48
  const PAD = 8
  const min = Math.max(0, Math.min(...points.map((p) => p.value)) - 10)
  const max = Math.min(100, Math.max(...points.map((p) => p.value)) + 10)
  const range = Math.max(max - min, 20)
  const xs = points.map((_, i) => PAD + ((W - PAD * 2) / Math.max(1, points.length - 1)) * i)
  const ys = points.map((p) => H - PAD - ((p.value - min) / range) * (H - PAD * 2))

  return (
    <View style={{ width: W, height: H, justifyContent: 'center' }}>
      {/* Connecting segments */}
      {points.slice(0, -1).map((_, i) => {
        const x1 = xs[i]
        const y1 = ys[i]
        const x2 = xs[i + 1]
        const y2 = ys[i + 1]
        const dx = x2 - x1
        const dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)
        const angle = Math.atan2(dy, dx) * (180 / Math.PI)
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: x1,
              top: y1 - 1,
              width: len,
              height: 2.5,
              backgroundColor: colors.primary,
              opacity: 0.7,
              transformOrigin: 'left center',
              transform: [{ translateX: len / 2 }, { rotate: `${angle}deg` }, { translateX: -len / 2 }],
            }}
          />
        )
      })}
      {/* Dots */}
      {points.map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: xs[i] - 4,
            top: ys[i] - 4,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i === points.length - 1 ? colors.primary : colors.surface,
            borderWidth: 2,
            borderColor: colors.primary,
          }}
        />
      ))}
    </View>
  )
}

export function HomeScreen({
  profile,
  nav,
  onStartCheckin,
  onSwitchProfile,
}: {
  profile: PatientProfile
  nav: Navigator
  onStartCheckin: () => void
  onSwitchProfile: () => void
}) {
  const insets = useInsets()
  const [wellbeing, setWellbeing] = useState<PatientWellbeing | null>(null)
  const [history, setHistory] = useState<HistoryItem[] | null>(null)
  const [dueCall, setDueCall] = useState<DueCall | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const [wb, hist, due] = await Promise.allSettled([
      api.wellbeing(profile.uid),
      api.history(profile.uid),
      api.dueCall(profile.uid),
    ])
    if (wb.status === 'fulfilled') setWellbeing(wb.value)
    if (hist.status === 'fulfilled') setHistory(hist.value)
    if (due.status === 'fulfilled') setDueCall(due.value)
  }, [profile.uid])

  useEffect(() => {
    void load()
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const hour = new Date().getHours()
  const greeting = greetingFor(hour)
  const view = wellbeing ? deriveWellbeing(wellbeing) : null
  const trendStyle = view ? trendTone[view.trend.tone] : trendTone.neutral
  const recentItems = (history ?? []).slice(0, 3)

  const todayStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })

  return (
    <Screen scroll padded bottomRoom={84 + insets.bottom} onRefresh={onRefresh} refreshing={refreshing}>
      {/* Top Header */}
      <Enter index={0}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.logoPip}>
              <Icon name="shield" size={18} color={colors.primary} />
            </View>
            <Text style={styles.brandText}>VIORA</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => nav.push({ name: 'support' })}
              style={styles.headerBtn}
              accessibilityLabel="Support and resources"
            >
              <Icon name="shield" size={20} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={onSwitchProfile}
              style={styles.avatarBtn}
              accessibilityLabel="Switch profile"
            >
              <Text style={styles.avatarText}>
                {profile.display_name.slice(0, 1).toUpperCase()}
              </Text>
            </Pressable>
          </View>
        </View>
      </Enter>

      {/* Date Chip & Warm Personalized Greeting */}
      <Enter index={1}>
        <View style={styles.greetSection}>
          <View style={styles.dateChipRow}>
            <View style={styles.dateChip}>
              <Icon name="calendar" size={14} color={colors.primary} />
              <Text style={styles.dateChipText}>{todayStr}</Text>
            </View>
            <View style={styles.uidChip}>
              <Text style={styles.uidChipText}>UID {profile.uid}</Text>
            </View>
          </View>
          <Text style={styles.greetingTitle}>
            {greeting.en}, {profile.display_name.split(' ')[0]}
          </Text>
          <Text style={styles.greetingSub}>
            We're here for you. How are you feeling today?
          </Text>
        </View>
      </Enter>

      {/* Due Banner if Active */}
      {dueCall?.due && (
        <Enter index={2}>
          <Pressable
            onPress={onStartCheckin}
            style={({ pressed }) => [styles.dueBanner, pressed && { opacity: 0.9 }]}
          >
            <View style={styles.pingDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dueBannerTitle}>Your check-in is due now</Text>
              <Text style={styles.dueBannerSub}>Caseworker scheduled follow-up</Text>
            </View>
            <Icon name="chevron" size={16} color={colors.primary} />
          </Pressable>
        </Enter>
      )}

      {/* Hero "Start a Check-in" Card */}
      <Enter index={3}>
        <View style={styles.heroCard}>
          <View style={styles.heroGlowCircle} />
          <View style={styles.heroTopRow}>
            <View style={styles.heroIconBox}>
              <Icon name="mic" size={26} color={colors.primary} />
            </View>
            <View style={styles.heroLiveBadge}>
              <View style={styles.pingDotSmall} />
              <Text style={styles.heroLiveText}>Available 24/7</Text>
            </View>
          </View>

          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>Start a Check-in</Text>
            <Text style={styles.heroSubtitle}>
              Talk with VIORA whenever you need, with no rush.
            </Text>
          </View>

          <Pressable
            onPress={onStartCheckin}
            style={({ pressed }) => [
              styles.heroButton,
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            ]}
          >
            <Text style={styles.heroButtonText}>Start Check-in</Text>
            <Icon name="chevron" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </Enter>

      {/* Next Check-in Tile */}
      <Enter index={4}>
        <View style={styles.tileCard}>
          <View style={styles.tileHeader}>
            <View style={styles.tileTitleRow}>
              <View style={styles.tileIconPip}>
                <Icon name="clock" size={18} color={colors.primary} />
              </View>
              <Text style={styles.tileLabel}>Next Check-in</Text>
            </View>
            <View style={styles.tileChannelChip}>
              <Text style={styles.tileChannelText}>
                {wellbeing?.next_follow_up_channel === 'VOICE' ? 'Voice Call' : 'Text Chat'}
              </Text>
            </View>
          </View>

          <View style={styles.tileBodyRow}>
            <View>
              <Text style={styles.tileTime}>
                {wellbeing?.next_follow_up
                  ? formatWhen(new Date(wellbeing.next_follow_up), new Date())
                  : 'Tomorrow · 6:30 PM'}
              </Text>
              <Text style={styles.tileSub}>Scheduled safe contact time</Text>
            </View>
            <Pressable
              onPress={() => nav.push({ name: 'scheduler', mode: 'reschedule' })}
              style={styles.rescheduleLink}
            >
              <Text style={styles.rescheduleText}>Reschedule</Text>
              <Icon name="chevron" size={14} color={colors.primary} />
            </Pressable>
          </View>
        </View>
      </Enter>

      {/* Your Well-being Card (Steadiness Score & Sparkline) */}
      <Enter index={5}>
        <View style={styles.tileCard}>
          <View style={styles.tileHeader}>
            <Text style={styles.tileLabel}>Your Well-being</Text>
            <View style={[styles.trendChip, { backgroundColor: trendStyle.bg }]}>
              <Icon name="chart" size={14} color={trendStyle.fg} />
              <Text style={[styles.trendChipText, { color: trendStyle.fg }]}>
                {view?.trend.word ?? 'Steady'}
              </Text>
            </View>
          </View>

          <View style={styles.wellbeingBody}>
            <View>
              <View style={styles.steadinessRow}>
                <Text style={styles.steadinessNumber}>
                  {view?.steadiness?.value != null ? Math.round(view.steadiness.value) : 64}
                </Text>
                <Text style={styles.steadinessTotal}> / 100</Text>
              </View>
              <Text style={styles.steadinessLabel}>
                {view?.steadiness?.label ?? 'Gentle & Steady'}
              </Text>
            </View>

            {view?.points && view.points.length > 1 && (
              <Sparkline points={view.points} />
            )}
          </View>

          <Pressable
            onPress={() => nav.switchTab('wellbeing')}
            style={styles.seeHistoryRow}
          >
            <Text style={styles.seeHistoryText}>See full well-being history</Text>
            <Icon name="chevron" size={14} color={colors.primary} />
          </Pressable>
        </View>
      </Enter>

      {/* Recent Activity */}
      <Enter index={6}>
        <View style={styles.activitySection}>
          <View style={styles.activityHeader}>
            <Text style={styles.activityTitle}>RECENT ACTIVITY</Text>
            <Pressable onPress={() => nav.switchTab('checkins')}>
              <Text style={styles.seeAllLink}>View all</Text>
            </Pressable>
          </View>

          <View style={styles.activityList}>
            {recentItems.length === 0 ? (
              <View style={styles.activityCard}>
                <Text style={styles.activitySub}>No recent sessions completed yet.</Text>
              </View>
            ) : (
              recentItems.map((item) => (
                <View key={item.interaction_id} style={styles.activityCard}>
                  <View style={styles.activityLeft}>
                    <View style={styles.activityIconBox}>
                      <Icon
                        name={item.channel === 'VOICE' ? 'mic' : 'chat'}
                        size={18}
                        color={colors.primary}
                      />
                    </View>
                    <View>
                      <Text style={styles.activityItemTitle}>
                        {item.channel === 'VOICE' ? 'Voice Check-in' : 'Text Check-in'}
                      </Text>
                      <Text style={styles.activitySub}>
                        {new Date(item.started_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.doneBadge}>
                    <Icon name="check" size={14} color={colors.tertiary} />
                    <Text style={styles.doneText}>Done</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      </Enter>

      {/* "Need support?" Sanctuary Card */}
      <Enter index={7}>
        <View style={styles.supportCard}>
          <View style={{ flex: 1 }}>
            <View style={styles.supportTitleRow}>
              <Icon name="shield" size={18} color={colors.primary} />
              <Text style={styles.supportTitle}>Need support?</Text>
            </View>
            <Text style={styles.supportSub}>
              Find helpful resources and people you can reach out to anytime.
            </Text>
          </View>
          <Pressable
            onPress={() => nav.push({ name: 'support' })}
            style={styles.supportBtn}
          >
            <Text style={styles.supportBtnText}>Get Support →</Text>
          </Pressable>
        </View>
      </Enter>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  logoPip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    fontSize: typeScale.base,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: 1.5,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.subtle,
  },
  avatarText: {
    fontSize: typeScale.sm,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  greetSection: {
    gap: 4,
    marginTop: space.xs,
    marginBottom: space.sm,
  },
  dateChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginBottom: 4,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
  uidChip: {
    backgroundColor: colors.primaryTint,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  uidChipText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  dateChipText: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  greetingTitle: {
    fontSize: typeScale.xl,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.5,
  },
  greetingSub: {
    fontSize: typeScale.base,
    color: colors.muted,
  },
  dueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.primaryTint,
    padding: space.md,
    borderRadius: radius.card,
    marginBottom: space.sm,
  },
  pingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  dueBannerTitle: {
    fontSize: typeScale.sm,
    fontWeight: '700',
    color: colors.primaryDeep,
  },
  dueBannerSub: {
    fontSize: typeScale.xs,
    color: colors.primaryDeep,
    opacity: 0.8,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.lg,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
    gap: space.md,
    marginBottom: space.sm,
  },
  heroGlowCircle: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primaryTint,
    opacity: 0.6,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  pingDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.tertiary,
  },
  heroLiveText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.tertiaryDeep,
  },
  heroContent: {
    gap: 4,
  },
  heroTitle: {
    fontSize: typeScale.lg,
    fontWeight: '800',
    color: colors.ink,
  },
  heroSubtitle: {
    fontSize: typeScale.sm,
    color: colors.muted,
  },
  heroButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    ...shadow.button,
  },
  heroButtonText: {
    fontSize: typeScale.base,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tileCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.subtle,
    gap: space.xs,
    marginBottom: space.sm,
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tileIconPip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontSize: typeScale.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  tileChannelChip: {
    backgroundColor: colors.primaryTint,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  tileChannelText: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.primaryDeep,
  },
  tileBodyRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  tileTime: {
    fontSize: typeScale.base,
    fontWeight: '700',
    color: colors.ink,
  },
  tileSub: {
    fontSize: typeScale.xs,
    color: colors.muted,
    marginTop: 2,
  },
  rescheduleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  rescheduleText: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.primary,
  },
  trendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  trendChipText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
  },
  wellbeingBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.xs,
  },
  steadinessRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  steadinessNumber: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.ink,
  },
  steadinessTotal: {
    fontSize: typeScale.sm,
    color: colors.muted,
  },
  steadinessLabel: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 2,
  },
  seeHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingTop: 4,
  },
  seeHistoryText: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.primary,
  },
  activitySection: {
    gap: space.xs,
    marginBottom: space.sm,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  activityTitle: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 1,
  },
  seeAllLink: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.primary,
  },
  activityList: {
    gap: 8,
  },
  activityCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.line,
  },
  activityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  activityIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityItemTitle: {
    fontSize: typeScale.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  activitySub: {
    fontSize: typeScale.xs,
    color: colors.muted,
  },
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  doneText: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.tertiary,
  },
  supportCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.card,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  supportTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  supportTitle: {
    fontSize: typeScale.base,
    fontWeight: '700',
    color: colors.ink,
  },
  supportSub: {
    fontSize: typeScale.xs,
    color: colors.muted,
    marginTop: 2,
  },
  supportBtn: {
    backgroundColor: colors.surface,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    ...shadow.subtle,
  },
  supportBtnText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.primary,
  },
})
