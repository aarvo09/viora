/* Hand-rolled navigator — a stack of `Route` plus a tab cursor.
 *
 * Why not react-navigation: the compiled APK's PackageList.java registers only
 * MainReactPackage + ExpoModulesPackage. react-navigation needs react-native-
 * screens and react-native-gesture-handler, both native, and adding them forces
 * a Gradle rebuild this machine has OOM'd on before.
 *
 * The patterns here are deliberately narrow. There is no nested stack, no
 * drawer, no shared-element transition — just a flat stack of full-screen
 * routes, one active tab, and slide/fade animations between screens. That
 * covers every flow in this app without the complexity that makes a real
 * navigation library worth its native cost.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, BackHandler, Easing } from 'react-native'
import type { Route, Tab } from './routes'
import { motion } from '../theme'

export interface NavigatorState {
  stack: Route[]
  /** Animation progress 0→1 for the top screen entering. */
  progress: Animated.Value
}

export interface Navigator {
  /** The screen the user is currently looking at. */
  current: Route
  /** Slide a new screen in. */
  push: (r: Route) => void
  /** Go back. Resolves to false if we're already at the root (so the caller
   *  can let Android's hardware back key exit the app). */
  pop: () => boolean
  /** Replace the current screen without going back to it. */
  replace: (r: Route) => void
  /** Switch tabs. Resets any stack above the tabs screen. */
  switchTab: (tab: Tab) => void
  /** Clear the stack completely and start fresh. Used on profile switch so no
   *  data from the previous profile is accessible via the back button. */
  resetTo: (r: Route) => void
  progress: Animated.Value
}

export function useNavigator(initial: Route): Navigator {
  const [stack, setStack] = useState<Route[]>([initial])
  const progress = useRef(new Animated.Value(1)).current

  // Animate a new screen entering.
  const enter = useCallback(() => {
    progress.setValue(0)
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.screenMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [progress])

  const push = useCallback(
    (r: Route) => {
      setStack((prev) => [...prev, r])
      enter()
    },
    [enter],
  )

  const pop = useCallback((): boolean => {
    let didPop = false
    setStack((prev) => {
      if (prev.length <= 1) return prev
      didPop = true
      return prev.slice(0, -1)
    })
    if (didPop) enter()
    return didPop
  }, [enter])

  const replace = useCallback(
    (r: Route) => {
      setStack((prev) => [...prev.slice(0, -1), r])
      enter()
    },
    [enter],
  )

  const switchTab = useCallback(
    (tab: Tab) => {
      setStack((prev) => {
        // Keep everything below the tabs screen, then put a fresh tabs route on top.
        const below = prev.findIndex((r) => r.name === 'tabs')
        const base = below === -1 ? prev : prev.slice(0, below)
        return [...base, { name: 'tabs', tab }]
      })
      enter()
    },
    [enter],
  )

  const resetTo = useCallback(
    (r: Route) => {
      setStack([r])
      progress.setValue(0)
      Animated.timing(progress, {
        toValue: 1,
        duration: motion.screenMs * 1.5,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    },
    [progress],
  )

  // Android hardware back.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const popped = pop()
      // Returning false lets Android exit the app when at the root.
      return popped
    })
    return () => sub.remove()
  }, [pop])

  return {
    current: stack[stack.length - 1],
    push,
    pop,
    replace,
    switchTab,
    resetTo,
    progress,
  }
}
