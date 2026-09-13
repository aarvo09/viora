/* A line chart drawn from plain Views.
 *
 * No `react-native-svg` — it is a native module not in the compiled APK, and
 * adding it would force a Gradle rebuild. Every primitive here is a `View`.
 *
 * Technique: each segment between consecutive points is a thin bar, positioned
 * at (x₁, y₁), of length `len`, rotated by `angle`. The transform is applied
 * around the bar's left edge via the translate→rotate→translate sandwich
 * (rotate happens after translating to the centre, then un-translating), which
 * is the standard way to rotate a View about a chosen pivot.
 *
 * The draw animates: a single `progress` value 0→1 drives every segment's
 * scaleX, each starting at a small stagger, so the line appears to be drawn
 * left to right. The dots fade in as the line passes them. All native-driver.
 *
 * Y values are 0..100 patient "steadiness" (higher = better), and the chart
 * pads a margin so a flat series still shows as a gentle line rather than a
 * bar on the floor.
 */

import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { colors, motion } from '../theme'

export interface ChartPoint {
  at: string
  value: number
}

export function Chart({ points, height = 140 }: { points: ChartPoint[]; height?: number }) {
  const width = 280 // rendered inside a card with fixed horizontal padding
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    progress.setValue(0)
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: motion.slowMs + points.length * motion.staggerMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [progress, points])

  if (points.length === 0) return <View style={{ height }} />

  const PAD_X = 14
  const PAD_Y = 18
  const innerW = width - PAD_X * 2
  const innerH = height - PAD_Y * 2

  const values = points.map((p) => p.value)
  const min = Math.max(0, Math.min(...values) - 12)
  const max = Math.min(100, Math.max(...values) + 12)
  const range = Math.max(max - min, 30)

  const xs = points.map((_, i) => PAD_X + (innerW / Math.max(1, points.length - 1)) * i)
  const ys = points.map((p) => height - PAD_Y - ((p.value - min) / range) * innerH)

  return (
    <View style={{ width, height }}>
      {/* baseline */}
      <View style={styles.gridLine} />
      <View style={[styles.gridLine, { top: height - PAD_Y }]} />

      {/* connecting segments */}
      {points.slice(0, -1).map((_, i) => {
        const x1 = xs[i]; const y1 = ys[i]
        const x2 = xs[i + 1]; const y2 = ys[i + 1]
        const dx = x2 - x1
        const dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI

        /* Progress of THIS segment = the global progress, but clamped so each
           segment waits its turn. Segment i starts at i/n, so they draw in
           sequence. */
        const start = i / Math.max(1, points.length - 1)
        const scaleX = progress.interpolate({
          inputRange: [0, start, 1],
          outputRange: [0, 0, 1],
        })

        return (
          <Animated.View
            key={`seg-${i}`}
            style={{
              position: 'absolute',
              left: x1,
              top: y1 - 1,
              width: len,
              height: 2,
              backgroundColor: colors.primary,
              borderRadius: 1,
              transformOrigin: 'left center',
              transform: [
                { translateX: len / 2 },
                { rotate: `${angle}deg` },
                { translateX: -len / 2 },
                { scaleX },
              ],
            }}
          />
        )
      })}

      {/* dots */}
      {points.map((_, i) => {
        const start = i / Math.max(1, points.length - 1)
        const opacity = progress.interpolate({
          inputRange: [0, Math.max(start, 0.001), 1],
          outputRange: [0, 0, 1],
        })
        return (
          <Animated.View
            key={`dot-${i}`}
            style={[
              styles.dot,
              {
                left: xs[i] - 4.5,
                top: ys[i] - 4.5,
                backgroundColor: i === points.length - 1 ? colors.primary : colors.primaryTint,
                borderWidth: 1.5,
                borderColor: colors.primary,
                opacity,
                transform: [
                  {
                    scale: progress.interpolate({
                      inputRange: [0, start, 1],
                      outputRange: [0.6, 0.6, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 1,
    backgroundColor: colors.line,
    opacity: 0.5,
  },
  dot: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
})
