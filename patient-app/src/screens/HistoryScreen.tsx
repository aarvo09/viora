/* History screen — past check-ins grouped by Today / Yesterday / Earlier.
 *
 * Reads GET /patients/{uid}/history. Each item is a real interaction: channel,
 * status, timestamp, and a tap through to the full conversation. Grouping is
 * the pure `groupByDay` helper, so the labels and ordering are tested in node.
 */

import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '../api/client'
import type { HistoryItem } from '../api/types'
import { formatTime, groupByDay } from '../lib/datetime'
import { colors, space, type as typeScale } from '../theme'
import { Screen } from '../ui/Screen'
import { Card, Chip, EmptyState, Enter, SectionTitle, Skeleton } from '../ui/kit'
import { Icon } from '../ui/Icon'
import type { Navigator } from '../nav/useNavigator'

const CHANNEL_ICON = { TEXT: 'chat', VOICE: 'mic' } as const
const STATUS_TONE = { COMPLETED: 'good', IN_PROGRESS: 'primary', MISSED: 'neutral' } as const

export function HistoryScreen({ uid, nav }: { uid: string; nav: Navigator }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null)

  useEffect(() => {
    let alive = true
    api.history(uid).then((h) => alive && setItems(h)).catch(() => alive && setItems([]))
    return () => { alive = false }
  }, [uid])

  const grouped = items ? groupByDay(items, (i: HistoryItem) => i.started_at, new Date()) : []
  const total = items?.length ?? 0

  return (
    <Screen scroll padded bottomRoom={100}>
      <Enter index={0}>
        <SectionTitle>Check-ins</SectionTitle>
      </Enter>

      {items === null ? (
        <Enter index={1}>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </Enter>
      ) : total === 0 ? (
        <Enter index={1}>
          <EmptyState
            icon="calendar"
            title="No check-ins yet"
            body="When you complete a check-in, it will appear here."
          />
        </Enter>
      ) : (
        grouped.map(({ bucket, items: slice }, gi) => (
          <Enter key={bucket} index={gi + 1}>
            <View style={styles.group}>
              <Text style={styles.groupLabel}>{bucket.toUpperCase()}</Text>
              <Card>
                {slice.map((item, i) => (
                  <Pressable
                    key={item.interaction_id}
                    onPress={() => nav.push({ name: 'historyDetail', interactionId: item.interaction_id })}
                    style={({ pressed }) => [
                      styles.row,
                      i !== slice.length - 1 && styles.rowDivider,
                      pressed && { opacity: 0.7 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${item.channel === 'VOICE' ? 'voice' : 'text'} check-in`}
                  >
                    <View style={styles.rowIcon}>
                      <Icon
                        name={CHANNEL_ICON[item.channel as 'TEXT' | 'VOICE'] ?? 'chat'}
                        size={18}
                        color={colors.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>
                        {item.channel === 'VOICE' ? 'Voice check-in' : 'Text check-in'}
                      </Text>
                      <Text style={styles.rowTime}>{formatTime(new Date(item.started_at))}</Text>
                    </View>
                    <Chip
                      label={item.status === 'COMPLETED' ? 'Completed' : item.status.toLowerCase()}
                      tone={STATUS_TONE[item.status as keyof typeof STATUS_TONE] ?? 'neutral'}
                    />
                    <Icon name="chevron" size={16} color={colors.muted} />
                  </Pressable>
                ))}
              </Card>
            </View>
          </Enter>
        ))
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  group: { marginBottom: space.sm },
  groupLabel: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.tiny,
    minHeight: 60,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: typeScale.base, color: colors.ink, fontWeight: '600' },
  rowTime: { fontSize: typeScale.xs, color: colors.muted, marginTop: 1 },
})
