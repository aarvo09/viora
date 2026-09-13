/* Breathing voice orb — Stitch Serene Well-Being Design.
 *
 * Source of truth: Stitch Project 10820896350954981900 / screen 165a29ca4a3848b594b2f2167d4fdfa8
 *
 * Multi-layered atmospheric halo radiance, breathing sanctuary sphere,
 * audio dBFS responsiveness, state pill, and animated waveform bars.
 */

import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { colors, motion, radius, shadow, space, type as typeScale } from '../theme'
import { Icon } from '../ui/Icon'

export type OrbState = 'SPEAKING' | 'LISTENING' | 'THINKING'

const SCALE = { SPEAKING: 1.08, LISTENING: 1.02, THINKING: 0.94 }
const DURATION = { SPEAKING: motion.breatheMs, LISTENING: motion.breatheMs, THINKING: 3400 }

export function VoiceOrb({
  state,
  label,
  sublabel,
  level = 0,
}: {
  state: OrbState
  label: string
  sublabel?: string
  /** 0..1 speech decibel level. Swells the orb while listening so the user
   *  instantly sees they are being heard in real time. */
  level?: number
}) {
  const scale = useRef(new Animated.Value(0.96)).current
  const haloScale = useRef(new Animated.Value(1)).current
  const opacity = useRef(new Animated.Value(0.85)).current
  const swell = useRef(new Animated.Value(0)).current

  // Breathing motion loop
  useEffect(() => {
    const target = SCALE[state]
    const duration = DURATION[state]
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(scale, {
          toValue: target,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(haloScale, {
          toValue: target * 1.15,
          duration: duration * 1.2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: duration / 2, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.65, duration: duration / 2, useNativeDriver: true }),
        ]),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [state, scale, haloScale, opacity])

  // Audio level reactive swelling
  useEffect(() => {
    const to = state === 'LISTENING' ? Math.min(Math.max(level, 0), 1) : 0
    const animation = Animated.timing(swell, {
      toValue: to,
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [level, state, swell])

  const responsive = Animated.add(
    scale,
    swell.interpolate({ inputRange: [0, 1], outputRange: [0, 0.16] }),
  )

  return (
    <View style={styles.wrap}>
      <View style={styles.orbContainer}>
        {/* Atmospheric Outer Halo 2 */}
        <Animated.View
          style={[
            styles.haloOuter,
            {
              transform: [{ scale: Animated.multiply(haloScale, 1.2) }],
              opacity: Animated.multiply(opacity, 0.35),
            },
          ]}
        />

        {/* Atmospheric Inner Halo 1 */}
        <Animated.View
          style={[
            styles.haloInner,
            {
              transform: [{ scale: responsive }],
              opacity: Animated.multiply(opacity, 0.55),
            },
          ]}
        />

        {/* Core Glowing Breathing Sanctuary Sphere */}
        <Animated.View
          style={[
            styles.core,
            {
              transform: [{ scale: Animated.multiply(responsive, 0.94) }],
              opacity,
            },
          ]}
        >
          {/* Fluid highlight ring inside orb */}
          <View style={styles.fluidHighlight} />
          <View style={styles.fluidBottomAccent} />

          {/* Gentle Sanctuary Center Glyph */}
          <View style={styles.glyphContainer}>
            <Icon name="shield" size={36} color="#FFFFFF" />
          </View>
        </Animated.View>
      </View>

      {/* State Pill Indicator */}
      <View style={styles.statusPill}>
        <View style={[styles.pingDot, state === 'SPEAKING' && styles.pingDotActive]} />
        <Text style={styles.stateLabel}>{label}</Text>
      </View>

      {/* Sublabel / Empathic Note */}
      {sublabel ? <Text style={styles.sublabel}>{sublabel}</Text> : null}

      {/* Audio Waveform Bars (Gentle rhythmic activity) */}
      <View style={styles.waveformRow}>
        <View style={[styles.bar, { height: state === 'SPEAKING' ? 14 : 6 }]} />
        <View style={[styles.bar, { height: state === 'SPEAKING' ? 24 : 10, backgroundColor: colors.primary }]} />
        <View style={[styles.bar, { height: state === 'SPEAKING' ? 18 : 8 }]} />
        <View style={[styles.bar, { height: state === 'SPEAKING' ? 26 : 12, backgroundColor: colors.accent }]} />
        <View style={[styles.bar, { height: state === 'SPEAKING' ? 20 : 8 }]} />
        <View style={[styles.bar, { height: state === 'SPEAKING' ? 12 : 6 }]} />
      </View>
    </View>
  )
}

const ORB_SIZE = 176

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: space.sm,
    paddingVertical: space.md,
  },
  orbContainer: {
    width: ORB_SIZE + 40,
    height: ORB_SIZE + 40,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  haloOuter: {
    position: 'absolute',
    width: ORB_SIZE + 32,
    height: ORB_SIZE + 32,
    borderRadius: (ORB_SIZE + 32) / 2,
    backgroundColor: '#7C5CFC',
  },
  haloInner: {
    position: 'absolute',
    width: ORB_SIZE + 12,
    height: ORB_SIZE + 12,
    borderRadius: (ORB_SIZE + 12) / 2,
    backgroundColor: '#60A5FA',
  },
  core: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    ...shadow.button,
  },
  fluidHighlight: {
    position: 'absolute',
    top: -20,
    left: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  fluidBottomAccent: {
    position: 'absolute',
    bottom: -30,
    right: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#60A5FA',
    opacity: 0.45,
  },
  glyphContainer: {
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadow.subtle,
    marginTop: space.xs,
  },
  pingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  pingDotActive: {
    backgroundColor: colors.accent,
  },
  stateLabel: {
    fontSize: typeScale.sm,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  sublabel: {
    fontSize: typeScale.sm,
    color: colors.inkSoft,
    textAlign: 'center',
    maxWidth: 280,
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 30,
    marginTop: 4,
  },
  bar: {
    width: 3.5,
    borderRadius: 2,
    backgroundColor: colors.primaryTint,
  },
})
