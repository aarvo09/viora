/* Bottom tab bar — Stitch Serene Well-Being Design.
 *
 * Four primary tabs with Stitch pill active states and a raised luminous
 * center action button that invokes Check-in from anywhere in the app.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, HIT, radius, shadow, space, type as typeScale } from '../theme'
import { useInsets } from '../ui/insets'
import { Icon } from '../ui/Icon'
import type { Navigator } from './useNavigator'
import type { Tab } from './routes'

const TABS: { id: Tab; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'checkins', label: 'Check-ins', icon: 'calendar' },
  { id: 'wellbeing', label: 'Well-being', icon: 'chart' },
  { id: 'profile', label: 'Profile', icon: 'person' },
]

export function TabBar({
  active,
  nav,
  onStartCheckin,
}: {
  active: Tab
  nav: Navigator
  onStartCheckin: () => void
}) {
  const insets = useInsets()

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom || space.xs }]}>
      {/* Left two tabs */}
      {TABS.slice(0, 2).map((t) => (
        <TabItem key={t.id} tab={t} active={active === t.id} onPress={() => nav.switchTab(t.id)} />
      ))}

      {/* Raised centre action */}
      <View style={styles.centreWrap}>
        <Pressable
          onPress={onStartCheckin}
          style={({ pressed }) => [styles.centre, pressed && { opacity: 0.9, transform: [{ scale: 0.94 }] }]}
          accessibilityLabel="Start a check-in"
          accessibilityRole="button"
        >
          <Icon name="plus" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.centreLabel}>Check-in</Text>
      </View>

      {/* Right two tabs */}
      {TABS.slice(2).map((t) => (
        <TabItem key={t.id} tab={t} active={active === t.id} onPress={() => nav.switchTab(t.id)} />
      ))}
    </View>
  )
}

function TabItem({
  tab,
  active,
  onPress,
}: {
  tab: (typeof TABS)[number]
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
    >
      <View style={[styles.pill, active && styles.pillActive]}>
        <Icon name={tab.icon} size={20} color={active ? colors.primary : colors.muted} />
        <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
      </View>
    </Pressable>
  )
}

const BAR_HEIGHT = 64

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    minHeight: BAR_HEIGHT,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space.hair,
    ...shadow.subtle,
  },
  tab: {
    flex: 1,
    height: BAR_HEIGHT - 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: HIT,
  },
  pill: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    gap: 2,
  },
  pillActive: {
    backgroundColor: colors.primaryTint,
  },
  label: {
    fontSize: typeScale.xs - 2,
    color: colors.muted,
    fontWeight: '500',
  },
  labelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  centreWrap: {
    width: 68,
    alignItems: 'center',
    gap: 3,
    paddingBottom: 2,
  },
  centre: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    ...shadow.button,
  },
  centreLabel: {
    fontSize: typeScale.xs - 2,
    color: colors.primary,
    fontWeight: '700',
  },
})
