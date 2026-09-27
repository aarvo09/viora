/* The frame every screen sits in.
 *
 * One job above all others: nothing interactive may render underneath the
 * system status bar or navigation bar. The old screens used React Native's
 * `SafeAreaView`, which does nothing at all on Android, and their top rows were
 * being drawn under 32dp of system chrome that ate the taps. `Screen` replaces
 * it everywhere and takes its padding from the measured insets instead.
 *
 * It also carries the ambient wash. There is no `expo-linear-gradient` in this
 * build (native module, would force a rebuild), so the gradient is two large
 * translucent circles bleeding into the cream ground — cheap, static, and close
 * enough to the agreed "soft gradient washes" that nobody would ask for the
 * dependency back.
 */

import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native'
import { colors, space } from '../theme'
import { useInsets } from './insets'

export function Screen({
  children,
  scroll = false,
  padded = true,
  /** Extra bottom room so a fixed tab bar cannot cover the last card. */
  bottomRoom = 0,
  onRefresh,
  refreshing = false,
  style,
}: {
  children: ReactNode
  scroll?: boolean
  padded?: boolean
  bottomRoom?: number
  onRefresh?: () => void
  refreshing?: boolean
  style?: ViewStyle
}) {
  const insets = useInsets()

  const body = (
    <>
      <Wash />
      {children}
    </>
  )

  const pad: ViewStyle = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom + bottomRoom,
    paddingHorizontal: padded ? space.md : 0,
  }

  if (!scroll) {
    return <View style={[styles.root, pad, style]}>{body}</View>
  }

  return (
    <View style={[styles.root, style]}>
      <Wash />
      {/* `height` rather than `padding`: Android resizes the window for the
          keyboard, and `padding` then double-counts it and leaves a gap. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={pad}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh
              ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
              : undefined
          }
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

/** Two soft washes over the cream ground. Rendered behind everything and
 *  non-interactive, so it can never intercept a tap — the whole point of this
 *  file is that taps land where they look like they will. */
function Wash() {
  return (
    <View style={styles.wash} pointerEvents="none">
      <View style={styles.washTeal} />
      <View style={styles.washBlush} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  wash: { ...StyleSheet.absoluteFillObject },
  washTeal: {
    position: 'absolute',
    top: -220,
    right: -140,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: colors.bgGlowA,
    opacity: 0.75,
  },
  washBlush: {
    position: 'absolute',
    bottom: -260,
    left: -160,
    width: 460,
    height: 460,
    borderRadius: 230,
    backgroundColor: colors.bgGlowB,
    opacity: 0.6,
  },
})
