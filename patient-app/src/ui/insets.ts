/* Window insets, computed without `react-native-safe-area-context`.
 *
 * This module is the fix for a real bug, not a nicety. React Native's
 * `SafeAreaView` applies NO top inset on Android — it is an iOS-only component
 * that degrades to a plain `View` elsewhere. So every screen that relied on it
 * was drawing its top row UNDERNEATH the system status bar, and the status bar
 * window swallowed the touches. That is what made the "Voice" control in the
 * old chat header effectively untappable: it was not a z-index problem, a
 * pointer-events problem, or a bad handler. It was 32dp of system chrome
 * sitting on top of a 13px text button.
 *
 * Measured on the Pixel 7 AVD this app targets (1080x2400, 420dpi):
 *
 *     statusBars      inset  top = 136px  (32dp)
 *     navigationBars  inset  bot =  63px  (15dp)
 *     usable app area       1080 x 2201   (2400 - 136 - 63)
 *
 * Why not `safe-area-context`: it ships native code, and the compiled APK on
 * this project registers only `MainReactPackage` + `ExpoModulesPackage`. Adding
 * it would force a Gradle rebuild, which is exactly the operation that has
 * OOM'd this machine before. Everything here is pure JS on RN core.
 */

import { Dimensions, Platform, StatusBar, useWindowDimensions } from 'react-native'

export interface Insets {
  top: number
  bottom: number
}

/** Fallbacks used when the platform tells us nothing useful. Both are the
 *  common Android values rather than 0: too much padding looks slightly loose,
 *  while too little puts a tap target back under system chrome — which is the
 *  bug this module exists to prevent. */
const FALLBACK_TOP = 24
const FALLBACK_BOTTOM = 16

/* A gesture-navigation handle is ~15dp; a three-button bar is ~48dp. Anything
   larger than that is not a navigation bar and is not ours to pad for. */
const MAX_BOTTOM = 48

export function topInset(): number {
  if (Platform.OS !== 'android') return 0
  // Android reports this natively and it already accounts for a cutout.
  return StatusBar.currentHeight ?? FALLBACK_TOP
}

/** Bottom inset, derived from the gap between the physical screen and the app
 *  window.
 *
 *  The obvious formula — `screen.height - window.height` — is WRONG on Android,
 *  and quietly so. On this device it yields 199px, because the window height
 *  excludes the status bar as well as the navigation bar (2400 - 2201 = 136 +
 *  63). Subtracting the top inset recovers the navigation bar alone. Clamped,
 *  because the relationship between these two numbers is not guaranteed across
 *  OEM skins, split-screen, or a floating window, and a wrong large value would
 *  push the tab bar off screen.
 */
export function bottomInset(windowHeight?: number): number {
  if (Platform.OS !== 'android') return 0
  const screenHeight = Dimensions.get('screen').height
  const height = windowHeight ?? Dimensions.get('window').height
  const gap = screenHeight - height - topInset()
  if (!Number.isFinite(gap) || gap <= 0) return FALLBACK_BOTTOM
  return Math.min(gap, MAX_BOTTOM)
}

/** Insets that recompute when the window changes (rotation, split screen, or a
 *  keyboard that resizes rather than overlays). */
export function useInsets(): Insets {
  const { height } = useWindowDimensions()
  return { top: topInset(), bottom: bottomInset(height) }
}
