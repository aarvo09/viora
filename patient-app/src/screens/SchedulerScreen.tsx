/* Choosing when the next check-in happens.
 *
 * The rules live in `src/lib/schedule.ts` as pure functions and are mirrored on
 * the backend in `scheduler.validate_patient_slot`. Both sides check, and the
 * backend decides — the phone's clock and timezone are not trustworthy, and the
 * safe-contact window is the one setting where being wrong has a cost outside
 * the app.
 *
 * `slotsForDay` returns only pickable times, so this screen never renders a grid
 * of mostly-disabled chips. An empty day says why instead: a disabled screen
 * reads as broken, and a person who cannot tell the difference between "no slots
 * today" and "this app is not working" stops using it.
 *
 * There is no native date picker here. `@react-native-community/datetimepicker`
 * is a native module and this build registers only MainReactPackage +
 * ExpoModulesPackage, so adding one means a Gradle rebuild. A day strip and a
 * grid of half-hours is a better fit anyway: the choice is always inside a
 * narrow window, so a full calendar would mostly be showing unavailable time.
 */

import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { api, ApiError } from '../api/client'
import type { PatientProfile } from '../api/types'
import { formatTime, formatWhen, relativeDay } from '../lib/datetime'
import { slotsForDay, upcomingDays } from '../lib/schedule'
import { colors, radius, space, type as typeScale } from '../theme'
import { Screen } from '../ui/Screen'
import { Button, Card, Enter, Header } from '../ui/kit'
import { Icon } from '../ui/Icon'

const DAYS_SHOWN = 14

export function SchedulerScreen({
  uid,
  profile,
  mode,
  onDone,
  onBack,
}: {
  uid: string
  profile: PatientProfile
  mode: 'new' | 'reschedule'
  onDone: () => void
  onBack: () => void
}) {
  /* Pinned once per mount. A `new Date()` evaluated during render would make
     every slot shift under the person while they are choosing, and the "is this
     still in the future" check would disagree with what they tapped. */
  const now = useMemo(() => new Date(), [])
  const window = useMemo(
    () => ({ start: profile.safe_contact_start, end: profile.safe_contact_end }),
    [profile.safe_contact_start, profile.safe_contact_end],
  )

  const days = useMemo(() => upcomingDays(now, DAYS_SHOWN), [now])
  const [dayIndex, setDayIndex] = useState(0)
  const [chosen, setChosen] = useState<Date | null>(null)
  const [channel, setChannel] = useState<'TEXT' | 'VOICE'>(profile.preferred_channel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slots = useMemo(
    () => slotsForDay({ day: days[dayIndex], now, window }),
    [days, dayIndex, now, window],
  )

  const confirm = useCallback(async () => {
    if (!chosen) return
    setBusy(true)
    setError(null)
    try {
      await api.scheduleCall(uid, chosen.toISOString(), channel)
      onDone()
    } catch (e: unknown) {
      /* The backend re-checks the same window against the stored timezone, so a
         422 here is its wording of a rule this screen also knows. Show it rather
         than a generic failure — it is written for the person. */
      setError(
        e instanceof ApiError && e.status === 422
          ? 'That time is outside your safe hours. Please choose another.'
          : 'Could not save that time. Please check your connection and try again.',
      )
      setBusy(false)
    }
  }, [chosen, channel, uid, onDone])

  return (
    <Screen scroll padded bottomRoom={16}>
      <Enter index={0}>
        <Header
          title={mode === 'reschedule' ? 'Move your check-in' : 'Book a check-in'}
          subtitle={`Your safe hours are ${window.start} to ${window.end}`}
          onBack={onBack}
        />
      </Enter>

      {/* Day strip */}
      <Enter index={1}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {days.map((day, i) => {
            const active = i === dayIndex
            return (
              <Pressable
                key={day.toISOString()}
                onPress={() => {
                  setDayIndex(i)
                  setChosen(null)
                }}
                style={({ pressed }) => [
                  styles.day,
                  active && styles.dayActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={relativeDay(day, now)}
              >
                <Text style={[styles.dayName, active && styles.dayNameActive]}>
                  {relativeDay(day, now)}
                </Text>
                <Text style={[styles.dayNum, active && styles.dayNumActive]}>
                  {day.getDate()}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      </Enter>

      {/* Times */}
      <Enter index={2}>
        <Text style={styles.label}>Pick a time</Text>
        {slots.length === 0 ? (
          <Card tone="tint">
            <Text style={styles.emptyTitle}>No times left on this day</Text>
            <Text style={styles.emptyBody}>
              Your safe hours are {window.start} to {window.end}, and they have
              passed for {relativeDay(days[dayIndex], now).toLowerCase()}. Try
              another day.
            </Text>
          </Card>
        ) : (
          <View style={styles.slots}>
            {slots.map((slot) => {
              const active = chosen?.getTime() === slot.getTime()
              return (
                <Pressable
                  key={slot.toISOString()}
                  onPress={() => setChosen(slot)}
                  style={({ pressed }) => [
                    styles.slot,
                    active && styles.slotActive,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.slotText, active && styles.slotTextActive]}>
                    {formatTime(slot)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        )}
      </Enter>

      {/* Channel */}
      <Enter index={3}>
        <Text style={styles.label}>How would you like to check in?</Text>
        <View style={styles.channels}>
          {(['TEXT', 'VOICE'] as const).map((option) => {
            const active = channel === option
            return (
              <Pressable
                key={option}
                onPress={() => setChannel(option)}
                style={({ pressed }) => [
                  styles.channel,
                  active && styles.channelActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Icon
                  name={option === 'TEXT' ? 'chat' : 'mic'}
                  size={20}
                  color={active ? colors.primaryDeep : colors.muted}
                />
                <Text style={[styles.channelText, active && styles.channelTextActive]}>
                  {option === 'TEXT' ? 'By text' : 'By voice'}
                </Text>
              </Pressable>
            )
          })}
        </View>
        {/* Not a warning, just the fact. Voice is never the default anywhere in
            this app, and the reason is worth stating once at the point of choice. */}
        <Text style={styles.channelNote}>
          A voice check-in can be overheard. Text is quieter if someone is nearby.
        </Text>
      </Enter>

      {error && (
        <Enter index={4}>
          <View style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        </Enter>
      )}

      <Enter index={5}>
        <View style={styles.confirmWrap}>
          {chosen && (
            <Text style={styles.summary}>
              {formatWhen(chosen, now)} · {channel === 'TEXT' ? 'by text' : 'by voice'}
            </Text>
          )}
          <Button
            label={mode === 'reschedule' ? 'Move my check-in' : 'Book this time'}
            onPress={confirm}
            disabled={!chosen}
            busy={busy}
          />
        </View>
      </Enter>
    </Screen>
  )
}

const styles = StyleSheet.create({
  strip: { gap: space.xs, paddingVertical: space.hair, paddingRight: space.md },
  day: {
    minWidth: 76,
    minHeight: 68,
    paddingHorizontal: space.tiny,
    paddingVertical: space.xs,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayName: { fontSize: typeScale.xs, color: colors.muted, fontWeight: '600' },
  dayNameActive: { color: '#fff' },
  dayNum: { fontSize: typeScale.md, color: colors.ink, fontWeight: '700' },
  dayNumActive: { color: '#fff' },

  label: {
    fontSize: typeScale.sm,
    fontWeight: '700',
    color: colors.inkSoft,
    marginTop: space.md,
    marginBottom: space.xs,
  },

  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  slot: {
    minWidth: 92,
    minHeight: 48,
    paddingHorizontal: space.tiny,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  slotText: { fontSize: typeScale.base, color: colors.ink, fontWeight: '600' },
  slotTextActive: { color: colors.primaryDeep, fontWeight: '700' },

  emptyTitle: { fontSize: typeScale.base, fontWeight: '700', color: colors.primaryDeep },
  emptyBody: {
    fontSize: typeScale.sm,
    color: colors.inkSoft,
    lineHeight: 22,
    marginTop: space.hair,
  },

  channels: { flexDirection: 'row', gap: space.xs },
  channel: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  channelActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  channelText: { fontSize: typeScale.base, color: colors.muted, fontWeight: '600' },
  channelTextActive: { color: colors.primaryDeep, fontWeight: '700' },
  channelNote: {
    fontSize: typeScale.xs,
    color: colors.muted,
    marginTop: space.xs,
    lineHeight: 18,
  },

  error: {
    marginTop: space.sm,
    padding: space.tiny,
    borderRadius: radius.sm,
    backgroundColor: colors.accentTint,
    borderLeftWidth: 3,
    borderLeftColor: colors.accentDeep,
  },
  errorText: { fontSize: typeScale.sm, color: colors.accentDeep, lineHeight: 20 },

  confirmWrap: { marginTop: space.lg, gap: space.xs },
  summary: { fontSize: typeScale.sm, color: colors.inkSoft, textAlign: 'center' },

  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
})
