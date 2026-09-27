/* Shared building blocks: cards, buttons, rows, entrance animation, states.
 *
 * These exist so the screens read as one product rather than nine variations on
 * a white rectangle. Every interactive element here is at least `HIT` (48dp)
 * tall, which is the rule that keeps the old voice-button bug from coming back
 * in a new place.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { HIT, colors, motion, radius, shadow, space, type as typeScale } from '../theme'
import { Icon, type IconName } from './Icon'

/* ------------------------------------------------------------- entrance --- */

/** Fade-and-rise, staggered by `index`.
 *
 * This is the "cards assemble themselves" motion from the agreed direction. It
 * runs on the native driver and animates only opacity and translateY, so a
 * dashboard of eight cards costs nothing per frame. `index` multiplies the
 * delay rather than each caller passing a hand-computed one.
 */
export function Enter({
  children,
  index = 0,
  style,
}: {
  children: ReactNode
  index?: number
  style?: StyleProp<ViewStyle>
}) {
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.enterMs,
      delay: index * motion.staggerMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [progress, index])

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}

/* ---------------------------------------------------------------- cards --- */

export function Card({
  children,
  style,
  onPress,
  tone = 'surface',
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  onPress?: () => void
  tone?: 'surface' | 'tint' | 'accent'
}) {
  const toneStyle =
    tone === 'tint' ? styles.cardTint : tone === 'accent' ? styles.cardAccent : styles.cardSurface

  if (!onPress) {
    return <View style={[styles.card, toneStyle, style]}>{children}</View>
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, toneStyle, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  )
}

/** Section label above a group of cards. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{children}</Text>
      {action}
    </View>
  )
}

/** Title row for a full-screen route, with a back target.
 *
 * Exists so the four screens above the tabs don't each invent their own. The
 * old stub header was a 13px text link with 16px of vertical padding sitting
 * under the status bar — the same shape that made the voice control
 * untappable. This one is `HIT` square and `Screen` keeps it clear of system
 * chrome.
 */
export function Header({
  title,
  subtitle,
  onBack,
  action,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  action?: ReactNode
}) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Icon name="chevron" size={18} color={colors.ink} />
        </Pressable>
      )}
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  )
}

/* -------------------------------------------------------------- buttons --- */

export function Button({
  label,
  sublabel,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  busy = false,
  style,
}: {
  label: string
  sublabel?: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  icon?: IconName
  disabled?: boolean
  busy?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const isPrimary = variant === 'primary'
  const fg = isPrimary ? '#fff' : variant === 'secondary' ? colors.primaryDeep : colors.muted

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.btn,
        isPrimary && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        pressed && styles.pressed,
        (disabled || busy) && styles.btnDisabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={20} color={fg} />}
          <View>
            <Text style={[styles.btnLabel, { color: fg }]}>{label}</Text>
            {sublabel && <Text style={[styles.btnSub, { color: fg }]}>{sublabel}</Text>}
          </View>
        </>
      )}
    </Pressable>
  )
}

/** A small labelled pill. Used for channel (Voice/Text) and status. */
export function Chip({
  label,
  icon,
  tone = 'neutral',
}: {
  label: string
  icon?: IconName
  tone?: 'neutral' | 'good' | 'watch' | 'primary'
}) {
  const map = {
    neutral: { bg: '#EFEDE7', fg: colors.inkSoft },
    good: { bg: colors.primaryTint, fg: colors.primaryDeep },
    watch: { bg: colors.accentTint, fg: colors.accentDeep },
    primary: { bg: colors.primaryTint, fg: colors.primaryDeep },
  }[tone]

  return (
    <View style={[styles.chip, { backgroundColor: map.bg }]}>
      {icon && <Icon name={icon} size={13} color={map.fg} />}
      <Text style={[styles.chipText, { color: map.fg }]}>{label}</Text>
    </View>
  )
}

/** A tappable row: icon, label, optional value, chevron. The workhorse of the
 *  profile and support screens. */
export function Row({
  icon,
  label,
  value,
  onPress,
  last = false,
}: {
  icon?: IconName
  label: string
  value?: string
  onPress?: () => void
  last?: boolean
}) {
  const content = (
    <>
      {icon && (
        <View style={styles.rowIcon}>
          <Icon name={icon} size={19} color={colors.primary} />
        </View>
      )}
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value != null && <Text style={styles.rowValue}>{value}</Text>}
        {onPress && <Icon name="chevron" size={16} color={colors.muted} />}
      </View>
    </>
  )

  if (!onPress) return <View style={[styles.row, last && styles.rowLast]}>{content}</View>
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  )
}

/* --------------------------------------------------------------- states --- */

/** Loading placeholder that breathes. Better than a spinner on a dashboard,
 *  because the shape tells you what is arriving. */
export function Skeleton({ height = 84, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.5)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 800, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])

  return <Animated.View style={[styles.skeleton, { height, opacity: pulse }, style]} />
}

export function EmptyState({
  icon = 'chat',
  title,
  body,
}: {
  icon?: IconName
  title: string
  body?: string
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={26} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body && <Text style={styles.emptyBody}>{body}</Text>}
    </View>
  )
}

/* --------------------------------------------------------------- styles --- */

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: space.sm,
    ...shadow.subtle,
  },
  cardSurface: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  cardTint: { backgroundColor: colors.primaryTint },
  cardAccent: { backgroundColor: colors.accentTint },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
    marginTop: space.md,
  },
  section: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: HIT + 8,
    marginBottom: space.xs,
  },
  back: {
    width: HIT,
    height: HIT,
    marginLeft: -space.tiny,
    borderRadius: HIT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // The chevron glyph points right; a back arrow points left.
    transform: [{ rotate: '180deg' }],
  },
  headerText: { flex: 1 },
  headerTitle: { fontSize: typeScale.lg, fontWeight: '700', color: colors.ink },
  headerSub: { fontSize: typeScale.sm, color: colors.muted, marginTop: 1 },

  btn: {
    minHeight: HIT + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.tiny,
  },
  btnPrimary: { backgroundColor: colors.primary, ...shadow.button },
  btnSecondary: { backgroundColor: colors.primaryTint },
  btnGhost: { backgroundColor: 'transparent' },
  btnDisabled: { opacity: 0.45 },
  btnLabel: { fontSize: typeScale.md, fontWeight: '700', textAlign: 'center' },
  btnSub: { fontSize: typeScale.xs, opacity: 0.85, textAlign: 'center', marginTop: 1 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.hair,
    borderRadius: radius.pill,
    paddingHorizontal: space.tiny,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  chipText: { fontSize: typeScale.xs, fontWeight: '700' },

  row: {
    minHeight: HIT + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tiny,
    paddingVertical: space.tiny,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: typeScale.base, color: colors.ink, fontWeight: '600' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rowValue: { fontSize: typeScale.sm, color: colors.muted },

  skeleton: {
    backgroundColor: colors.line,
    borderRadius: radius.lg,
    marginBottom: space.xs,
  },

  empty: { alignItems: 'center', paddingVertical: space.lg, gap: space.xs },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: typeScale.md, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  emptyBody: {
    fontSize: typeScale.sm,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: space.sm,
  },
})
