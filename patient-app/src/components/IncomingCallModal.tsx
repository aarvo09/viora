/* Incoming Check-in call experience — Stitch "Serene Well-Being" Voice Sanctuary.
 *
 * Appears when an automated VIORA AI or Counsellor follow-up becomes due.
 * Provides real-time incoming call sensation with ringing animation, vibration,
 * and two clear options: [Decline / Later] and [Answer Check-in].
 */

import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native'
import { colors, radius, shadow, space } from '../theme'
import { Icon } from '../ui/Icon'
import type { PatientProfile } from '../api/types'

interface IncomingCallModalProps {
  visible: boolean
  profile: PatientProfile
  channel?: 'VOICE' | 'TEXT'
  onAnswer: () => void
  onDecline: () => void
}

export function IncomingCallModal({
  visible,
  profile,
  channel = 'VOICE',
  onAnswer,
  onDecline,
}: IncomingCallModalProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current
  const ringAnim1 = useRef(new Animated.Value(0.7)).current
  const ringAnim2 = useRef(new Animated.Value(0.5)).current

  useEffect(() => {
    if (!visible) return

    // Trigger phone vibration pattern for incoming check-in
    try {
      Vibration.vibrate([0, 500, 400, 500], true)
    } catch {
      /* ignore vibration permission/device restrictions */
    }

    // Breathing / ringing ripple animation
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    )

    const rings = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(ringAnim1, {
            toValue: 1.4,
            duration: 1800,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ringAnim1, {
            toValue: 0.7,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(ringAnim2, {
            toValue: 1.7,
            duration: 1800,
            delay: 400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ringAnim2, {
            toValue: 0.5,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    )

    pulse.start()
    rings.start()

    return () => {
      pulse.stop()
      rings.stop()
      try {
        Vibration.cancel()
      } catch {
        /* ignore */
      }
    }
  }, [visible, pulseAnim, ringAnim1, ringAnim2])

  if (!visible) return null

  const isHindi = profile.preferred_language?.startsWith('hi')

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onDecline}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Top Brand Tag */}
          <View style={styles.brandRow}>
            <View style={styles.shieldPip}>
              <Icon name="shield" size={16} color={colors.primary} />
            </View>
            <Text style={styles.brandText}>VIORA VOICE SANCTUARY</Text>
          </View>

          {/* Center Ringing Emblem */}
          <View style={styles.stage}>
            <Animated.View
              style={[
                styles.ring,
                styles.ringOuter,
                { transform: [{ scale: ringAnim2 }], opacity: 0.25 },
              ]}
            />
            <Animated.View
              style={[
                styles.ring,
                styles.ringMid,
                { transform: [{ scale: ringAnim1 }], opacity: 0.4 },
              ]}
            />
            <Animated.View
              style={[
                styles.orbCore,
                { transform: [{ scale: pulseAnim }] },
              ]}
            >
              <Icon name={channel === 'VOICE' ? 'mic' : 'chat'} size={38} color="#FFFFFF" />
            </Animated.View>
          </View>

          {/* Content & Call Metadata */}
          <View style={styles.content}>
            <Text style={styles.statusLabel}>
              {isHindi ? 'इनकमिंग चेक-इन' : 'INCOMING CHECK-IN'}
            </Text>
            <Text style={styles.callerTitle}>
              {channel === 'VOICE' ? 'VIORA Voice Sanctuary' : 'VIORA Text Check-in'}
            </Text>
            <Text style={styles.subtitle}>
              {isHindi
                ? `नमस्ते ${profile.display_name.split(' ')[0]}। क्लिनिकल टीम द्वारा निर्धारित समय पर चेक-इन उपलब्ध है।`
                : `Hello ${profile.display_name.split(' ')[0]}. Your scheduled check-in is ready.`}
            </Text>

            <View style={styles.patientBadge}>
              <View style={styles.patientDot} />
              <Text style={styles.patientBadgeText}>
                {profile.display_name} • UID {profile.uid}
              </Text>
            </View>
          </View>

          {/* Action Controls: Decline vs Answer */}
          <View style={styles.actionRow}>
            {/* Decline */}
            <View style={styles.btnColumn}>
              <Pressable
                onPress={() => {
                  try { Vibration.cancel() } catch {}
                  onDecline()
                }}
                style={({ pressed }) => [
                  styles.circleBtn,
                  styles.declineBtn,
                  pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] },
                ]}
                accessibilityLabel="Decline or postpone check-in"
              >
                <Icon name="close" size={26} color="#DC2626" />
              </Pressable>
              <Text style={styles.btnLabel}>{isHindi ? 'बाद में' : 'Decline'}</Text>
            </View>

            {/* Answer */}
            <View style={styles.btnColumn}>
              <Pressable
                onPress={() => {
                  try { Vibration.cancel() } catch {}
                  onAnswer()
                }}
                style={({ pressed }) => [
                  styles.circleBtn,
                  styles.answerBtn,
                  pressed && { opacity: 0.9, transform: [{ scale: 0.96 }] },
                ]}
                accessibilityLabel="Answer check-in"
              >
                <Icon name="phone" size={32} color="#FFFFFF" />
              </Pressable>
              <Text style={[styles.btnLabel, styles.answerLabel]}>
                {isHindi ? 'बातचीत शुरू करें' : 'Answer Check-in'}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    ...shadow.card,
    borderWidth: 1,
    borderColor: 'rgba(124, 92, 252, 0.25)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginBottom: space.lg,
  },
  shieldPip: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 1.2,
  },
  stage: {
    width: 170,
    height: 170,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: space.sm,
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  ringOuter: {
    width: 160,
    height: 160,
  },
  ringMid: {
    width: 125,
    height: 125,
  },
  orbCore: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  content: {
    alignItems: 'center',
    marginTop: space.md,
    marginBottom: space.xl,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 1.5,
    marginBottom: space.hair,
  },
  callerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
    marginBottom: space.xs,
  },
  subtitle: {
    fontSize: 13,
    color: colors.inkSoft,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: space.sm,
  },
  patientBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  patientDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  patientBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: space.md,
    paddingTop: space.xs,
  },
  btnColumn: {
    alignItems: 'center',
    gap: space.xs,
  },
  circleBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  declineBtn: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
  },
  answerBtn: {
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#34D399',
  },
  btnLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  answerLabel: {
    color: '#047857',
    fontWeight: '700',
  },
})
