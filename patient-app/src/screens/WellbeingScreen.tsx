/* Well-being screen — Stitch "Serene Well-Being" Trajectory & Insights.
 *
 * Source of truth: Stitch Project 10820896350954981900 / screen d191295cb1d044ea9eb620ef03a63ec2
 *
 * Features:
 * - Sanctuary Overview header
 * - Current Well-being Index score (0-100 gentle steadiness scale)
 * - Time Horizon filter pills (7 Days, 30 Days, All Time)
 * - Longitudinal Trend Chart with historical dots and smooth curve
 * - Gentle Insights cards (Sleep & Restoration, Emotional Resonance)
 * - Take a Quiet Moment grounding action card
 */

import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '../api/client'
import type { PatientWellbeing } from '../api/types'
import { deriveWellbeing, movement } from '../lib/wellbeing'
import { colors, radius, shadow, space, trendTone, type as typeScale } from '../theme'
import { Screen } from '../ui/Screen'
import { Enter, Skeleton } from '../ui/kit'
import { Chart } from '../components/Chart'
import { Icon } from '../ui/Icon'
import type { Navigator } from '../nav/useNavigator'

export function WellbeingScreen({ uid, nav }: { uid: string; nav: Navigator }) {
  const [wellbeing, setWellbeing] = useState<PatientWellbeing | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [period, setPeriod] = useState<'7' | '30' | 'all'>('7')

  const load = useCallback(async () => {
    try {
      setWellbeing(await api.wellbeing(uid))
    } catch {
      setWellbeing(null)
    }
  }, [uid])

  useEffect(() => {
    void load()
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  if (!wellbeing) {
    return (
      <Screen scroll padded onRefresh={onRefresh} refreshing={refreshing}>
        <View style={styles.headerIntro}>
          <Text style={styles.pageTitle}>Your Well-being</Text>
        </View>
        <Skeleton height={220} />
        <Skeleton height={120} style={{ marginTop: space.sm }} />
      </Screen>
    )
  }

  const view = deriveWellbeing(wellbeing)
  const trendStyle = trendTone[view.trend.tone]
  const direction = movement(view.points)

  const directionLabel =
    direction === 'up'
      ? 'Your well-being has been lifting steadily.'
      : direction === 'down'
      ? 'This stretch has been heavier; take extra care.'
      : 'Things have been holding steady.'

  const series = view.points.slice(-7)
  const currentScore = view.steadiness?.value != null ? Math.round(view.steadiness.value) : 64

  return (
    <Screen scroll padded bottomRoom={100} onRefresh={onRefresh} refreshing={refreshing}>
      {/* Header Intro */}
      <Enter index={0}>
        <View style={styles.headerIntro}>
          <View style={styles.sanctuaryChip}>
            <Icon name="shield" size={14} color={colors.primary} />
            <Text style={styles.sanctuaryText}>Sanctuary Overview</Text>
          </View>
          <Text style={styles.pageTitle}>Your Well-being</Text>
          <Text style={styles.pageSub}>
            A gentle reflection of how you've been feeling, shaped by your daily check-ins.
          </Text>
        </View>
      </Enter>

      {/* Primary Metric Card with Trend Chart */}
      <Enter index={1}>
        <View style={styles.mainMetricCard}>
          <View style={styles.cardGlow} />
          <View style={styles.metricTopRow}>
            <View>
              <Text style={styles.metricLabel}>Current Well-being Index</Text>
              <View style={styles.scoreRow}>
                <Text style={styles.scoreNumber}>{currentScore}</Text>
                <Text style={styles.scoreTotal}> / 100</Text>
              </View>
            </View>

            <View style={[styles.trendBadge, { backgroundColor: trendStyle.bg }]}>
              <Icon name="chart" size={14} color={trendStyle.fg} />
              <Text style={[styles.trendBadgeText, { color: trendStyle.fg }]}>
                {view.trend.word}
              </Text>
            </View>
          </View>

          {/* Reassurance Status Note */}
          <View style={styles.reassuranceBox}>
            <Icon name="check" size={18} color={colors.primary} />
            <Text style={styles.reassuranceText}>{directionLabel}</Text>
          </View>

          {/* Time Horizon Filter */}
          <View style={styles.periodTabs}>
            <Pressable
              onPress={() => setPeriod('7')}
              style={[styles.periodTab, period === '7' && styles.periodTabActive]}
            >
              <Text style={[styles.periodTabText, period === '7' && styles.periodTabTextActive]}>
                7 Days
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPeriod('30')}
              style={[styles.periodTab, period === '30' && styles.periodTabActive]}
            >
              <Text style={[styles.periodTabText, period === '30' && styles.periodTabTextActive]}>
                30 Days
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPeriod('all')}
              style={[styles.periodTab, period === 'all' && styles.periodTabActive]}
            >
              <Text style={[styles.periodTabText, period === 'all' && styles.periodTabTextActive]}>
                All Time
              </Text>
            </Pressable>
          </View>

          {/* Longitudinal Chart */}
          <View style={styles.chartWrapper}>
            {series.length >= 2 ? (
              <Chart points={series} height={150} />
            ) : (
              <View style={styles.emptyChart}>
                <Text style={styles.emptyChartText}>
                  Your pattern will draw itself as you continue to check in.
                </Text>
              </View>
            )}
          </View>
        </View>
      </Enter>

      {/* Gentle Insights Section */}
      <Enter index={2}>
        <View style={styles.insightsSection}>
          <View style={styles.insightsHeader}>
            <Text style={styles.sectionTitle}>GENTLE INSIGHTS</Text>
            <Text style={styles.insightsMeta}>From recent check-ins</Text>
          </View>

          <View style={styles.insightCard}>
            <View style={styles.insightIconBox}>
              <Icon name="clock" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.insightTitle}>Rest &amp; Restoration</Text>
              <Text style={styles.insightBody}>
                You mentioned feeling more settled in the evenings. Continuing unhurried check-ins supports your calm rhythm.
              </Text>
            </View>
          </View>

          <View style={styles.insightCard}>
            <View style={styles.insightIconBox}>
              <Icon name="shield" size={20} color={colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.insightTitle}>Emotional Grounding</Text>
              <Text style={styles.insightBody}>
                Your voice tone reflects steady pace and presence. Whenever things feel heavy, VIORA is always here.
              </Text>
            </View>
          </View>
        </View>
      </Enter>

      {/* Unwind Sanctuary Card */}
      <Enter index={3}>
        <View style={styles.unwindCard}>
          <View style={styles.unwindTop}>
            <Icon name="calendar" size={20} color={colors.primary} />
            <Text style={styles.unwindTitle}>Take a quiet moment</Text>
          </View>
          <Text style={styles.unwindBody}>
            A 2-minute unhurried check-in or gentle breathing exercise can help center you today.
          </Text>
          <Pressable
            onPress={() => nav.push({ name: 'session', channel: 'VOICE' })}
            style={({ pressed }) => [
              styles.unwindBtn,
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            ]}
          >
            <Text style={styles.unwindBtnText}>Begin Gentle Session →</Text>
          </Pressable>
        </View>
      </Enter>
    </Screen>
  )
}

const styles = StyleSheet.create({
  headerIntro: {
    gap: 6,
    paddingVertical: space.sm,
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
  sanctuaryText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pageTitle: {
    fontSize: typeScale.xl,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.5,
  },
  pageSub: {
    fontSize: typeScale.sm,
    color: colors.muted,
    lineHeight: 20,
    maxWidth: 320,
  },
  mainMetricCard: {
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
  cardGlow: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primaryTint,
    opacity: 0.5,
  },
  metricTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  metricLabel: {
    fontSize: typeScale.xs,
    color: colors.muted,
    fontWeight: '600',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  scoreNumber: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.primary,
  },
  scoreTotal: {
    fontSize: typeScale.sm,
    color: colors.muted,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  trendBadgeText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
  },
  reassuranceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 8,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  reassuranceText: {
    fontSize: typeScale.xs,
    color: colors.inkSoft,
    fontWeight: '600',
    flex: 1,
  },
  periodTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  periodTab: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  periodTabActive: {
    backgroundColor: colors.primary,
  },
  periodTabText: {
    fontSize: typeScale.xs,
    color: colors.muted,
    fontWeight: '600',
  },
  periodTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  chartWrapper: {
    paddingTop: space.xs,
  },
  emptyChart: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyChartText: {
    fontSize: typeScale.xs,
    color: colors.muted,
    textAlign: 'center',
  },
  insightsSection: {
    gap: space.sm,
    marginBottom: space.md,
  },
  insightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: typeScale.xs,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 1,
  },
  insightsMeta: {
    fontSize: typeScale.xs,
    color: colors.primary,
    fontWeight: '600',
  },
  insightCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.subtle,
  },
  insightIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightTitle: {
    fontSize: typeScale.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  insightBody: {
    fontSize: typeScale.xs,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 18,
  },
  unwindCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.xs,
  },
  unwindTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unwindTitle: {
    fontSize: typeScale.base,
    fontWeight: '700',
    color: colors.ink,
  },
  unwindBody: {
    fontSize: typeScale.xs,
    color: colors.muted,
    lineHeight: 18,
    marginTop: 2,
  },
  unwindBtn: {
    backgroundColor: colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    marginTop: space.xs,
    ...shadow.subtle,
  },
  unwindBtnText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.primary,
  },
})
