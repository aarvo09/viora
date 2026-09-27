/* Profile tab — Stitch "Serene Well-Being" Profile & Preferences.
 *
 * Source of truth: Stitch Project 10820896350954981900 / screen 29bf8a8b1ef24a138c2084c8fcf6eb72
 *
 * Lets the patient manage their spoken language, preferred contact mode,
 * and safe-contact window with half-hour stepper controls.
 */

import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '../api/client'
import type { PatientProfile, PreferencesPatch } from '../api/types'
import { formatClock, humanClock, parseClock } from '../lib/datetime'
import { colors, radius, shadow, space, type as typeScale } from '../theme'
import { Screen } from '../ui/Screen'
import { Enter } from '../ui/kit'
import { Icon } from '../ui/Icon'
import type { Navigator } from '../nav/useNavigator'

const LANGUAGES: { code: string; label: string; native: string }[] = [
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'en', label: 'English', native: 'English' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
]

const STEP_MINUTES = 30

export function ProfileScreen({
  profile,
  nav,
  onSwitchProfile,
  onProfileUpdated,
}: {
  profile: PatientProfile
  nav: Navigator
  onSwitchProfile: () => void
  onProfileUpdated: (p: PatientProfile) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingLang, setEditingLang] = useState(false)
  const [editingHours, setEditingHours] = useState(false)

  const save = useCallback(
    async (patch: PreferencesPatch) => {
      setBusy(true)
      setError(null)
      try {
        const updated = await api.patchPreferences(profile.uid, patch)
        onProfileUpdated(updated)
      } catch {
        setError('Could not save that change. Please try again.')
      } finally {
        setBusy(false)
      }
    },
    [profile.uid, onProfileUpdated],
  )

  const nudge = useCallback(
    (which: 'start' | 'end', direction: 1 | -1) => {
      const current = parseClock(
        which === 'start' ? profile.safe_contact_start : profile.safe_contact_end,
      )
      if (current == null) return
      const next = formatClock(current + direction * STEP_MINUTES)
      save(which === 'start' ? { safe_contact_start: next } : { safe_contact_end: next })
    },
    [profile.safe_contact_start, profile.safe_contact_end, save],
  )

  const language =
    LANGUAGES.find((l) => l.code === profile.preferred_language)?.native ??
    profile.preferred_language

  return (
    <Screen scroll padded bottomRoom={100}>
      {/* Identity Card */}
      <Enter index={0}>
        <View style={styles.profileCard}>
          <View style={styles.cardGlow} />
          <View style={styles.identityRow}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatarCore}>
                <Text style={styles.avatarInitial}>
                  {profile.display_name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.profileName}>{profile.display_name}</Text>
                <View style={styles.uidChip}>
                  <Text style={styles.uidChipText}>UID: {profile.uid}</Text>
                </View>
              </View>
              <View style={styles.statusLine}>
                <Icon name="check" size={14} color={colors.tertiary} />
                <Text style={styles.statusText}>Safe sanctuary member</Text>
              </View>
            </View>
          </View>

          <Pressable
            onPress={onSwitchProfile}
            style={({ pressed }) => [styles.switchBtn, pressed && { opacity: 0.9 }]}
          >
            <Icon name="person" size={16} color={colors.primary} />
            <Text style={styles.switchBtnText}>Switch Profile Account</Text>
            <Icon name="chevron" size={14} color={colors.primary} />
          </Pressable>
        </View>
      </Enter>

      {error && (
        <Enter index={1}>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        </Enter>
      )}

      {/* Section 1: Interaction Preferences */}
      <Enter index={2}>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>INTERACTION PREFERENCES</Text>
            <Text style={styles.comfortBadge}>Comfort First</Text>
          </View>

          <View style={styles.settingsCard}>
            {/* Preferred Contact Mode Toggle */}
            <View style={styles.modeSection}>
              <Text style={styles.settingLabel}>Preferred Contact Method</Text>
              <View style={styles.modeToggleRow}>
                <Pressable
                  onPress={() => save({ preferred_channel: 'VOICE' })}
                  disabled={busy}
                  style={[
                    styles.modeToggleBtn,
                    profile.preferred_channel === 'VOICE' && styles.modeToggleBtnActive,
                  ]}
                >
                  <Icon
                    name="mic"
                    size={18}
                    color={profile.preferred_channel === 'VOICE' ? '#FFFFFF' : colors.muted}
                  />
                  <Text
                    style={[
                      styles.modeToggleLabel,
                      profile.preferred_channel === 'VOICE' && styles.modeToggleLabelActive,
                    ]}
                  >
                    Voice Call
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => save({ preferred_channel: 'TEXT' })}
                  disabled={busy}
                  style={[
                    styles.modeToggleBtn,
                    profile.preferred_channel === 'TEXT' && styles.modeToggleBtnActive,
                  ]}
                >
                  <Icon
                    name="chat"
                    size={18}
                    color={profile.preferred_channel === 'TEXT' ? '#FFFFFF' : colors.muted}
                  />
                  <Text
                    style={[
                      styles.modeToggleLabel,
                      profile.preferred_channel === 'TEXT' && styles.modeToggleLabelActive,
                    ]}
                  >
                    Text Chat
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.settingHint}>
                VIORA speaks with a gentle, reassuring vocal cadence.
              </Text>
            </View>

            {/* Safe Contact Window */}
            <View style={styles.windowBox}>
              <View style={styles.windowIconBox}>
                <Icon name="clock" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.windowTitle}>Safe Contact Window</Text>
                <Text style={styles.windowHours}>
                  {humanClock(profile.safe_contact_start)} – {humanClock(profile.safe_contact_end)}
                </Text>
                <Text style={styles.windowHint}>
                  VIORA will never reach out or prompt outside this time.
                </Text>
              </View>
              <Pressable
                onPress={() => setEditingHours(!editingHours)}
                style={styles.changeBtn}
              >
                <Text style={styles.changeBtnText}>
                  {editingHours ? 'Done' : 'Adjust'}
                </Text>
              </Pressable>
            </View>

            {editingHours && (
              <View style={styles.stepperDrawer}>
                <View style={styles.stepperRow}>
                  <Text style={styles.stepperLabel}>Start: {humanClock(profile.safe_contact_start)}</Text>
                  <View style={styles.stepperButtons}>
                    <Pressable onPress={() => nudge('start', -1)} style={styles.nudgeBtn}>
                      <Text style={styles.nudgeText}>–30m</Text>
                    </Pressable>
                    <Pressable onPress={() => nudge('start', 1)} style={styles.nudgeBtn}>
                      <Text style={styles.nudgeText}>+30m</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.stepperRow}>
                  <Text style={styles.stepperLabel}>End: {humanClock(profile.safe_contact_end)}</Text>
                  <View style={styles.stepperButtons}>
                    <Pressable onPress={() => nudge('end', -1)} style={styles.nudgeBtn}>
                      <Text style={styles.nudgeText}>–30m</Text>
                    </Pressable>
                    <Pressable onPress={() => nudge('end', 1)} style={styles.nudgeBtn}>
                      <Text style={styles.nudgeText}>+30m</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            )}

            {/* Language Setting Row */}
            <Pressable
              onPress={() => setEditingLang(!editingLang)}
              style={styles.langRow}
            >
              <View style={styles.langLeft}>
                <Icon name="chat" size={18} color={colors.primary} />
                <View>
                  <Text style={styles.settingLabel}>Spoken Language</Text>
                  <Text style={styles.langValue}>{language}</Text>
                </View>
              </View>
              <Icon name="chevron" size={16} color={colors.primary} />
            </Pressable>

            {editingLang && (
              <View style={styles.langGrid}>
                {LANGUAGES.map((l) => (
                  <Pressable
                    key={l.code}
                    disabled={busy}
                    onPress={() => {
                      save({ preferred_language: l.code })
                      setEditingLang(false)
                    }}
                    style={[
                      styles.langOption,
                      profile.preferred_language === l.code && styles.langOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.langOptionText,
                        profile.preferred_language === l.code && styles.langOptionTextActive,
                      ]}
                    >
                      {l.native}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>
      </Enter>

      {/* Section 2: Privacy & Helpline Gateway */}
      <Enter index={3}>
        <View style={styles.section}>
          <View style={styles.privacyCard}>
            <View style={styles.privacyTop}>
              <Icon name="shield" size={18} color={colors.primary} />
              <Text style={styles.privacyTitle}>Emergency &amp; Support Directory</Text>
            </View>
            <Text style={styles.privacyBody}>
              Access free, confidential 24/7 helplines whenever you need assistance.
            </Text>
            <Pressable
              onPress={() => nav.push({ name: 'support' })}
              style={styles.supportLinkBtn}
            >
              <Text style={styles.supportLinkText}>Open Helpline Directory →</Text>
            </Pressable>
          </View>
        </View>
      </Enter>
    </Screen>
  )
}

const styles = StyleSheet.create({
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.lg,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
    gap: space.md,
    marginBottom: space.md,
  },
  cardGlow: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primaryTint,
    opacity: 0.5,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCore: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.button,
  },
  avatarInitial: {
    fontSize: typeScale.lg,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  profileName: {
    fontSize: typeScale.lg,
    fontWeight: '800',
    color: colors.ink,
  },
  uidChip: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
  },
  uidChipText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  statusText: {
    fontSize: typeScale.xs,
    color: colors.muted,
  },
  switchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  switchBtnText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  errorBox: {
    backgroundColor: colors.riskCriticalTint,
    padding: space.sm,
    borderRadius: radius.sm,
    marginBottom: space.sm,
  },
  errorText: {
    fontSize: typeScale.xs,
    color: colors.riskCritical,
  },
  section: {
    gap: space.xs,
    marginBottom: space.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: typeScale.xs,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 1,
  },
  comfortBadge: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.tertiary,
  },
  settingsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.subtle,
    gap: space.md,
  },
  modeSection: {
    gap: 8,
  },
  settingLabel: {
    fontSize: typeScale.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  modeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 3,
  },
  modeToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  modeToggleBtnActive: {
    backgroundColor: colors.primary,
    ...shadow.button,
  },
  modeToggleLabel: {
    fontSize: typeScale.sm,
    fontWeight: '600',
    color: colors.muted,
  },
  modeToggleLabelActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  settingHint: {
    fontSize: typeScale.xs,
    color: colors.muted,
    paddingHorizontal: 2,
  },
  windowBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceAlt,
    padding: space.md,
    borderRadius: radius.sm,
  },
  windowIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  windowTitle: {
    fontSize: typeScale.sm,
    fontWeight: '700',
    color: colors.ink,
  },
  windowHours: {
    fontSize: typeScale.sm,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 1,
  },
  windowHint: {
    fontSize: typeScale.xs - 1,
    color: colors.muted,
    marginTop: 2,
  },
  changeBtn: {
    backgroundColor: colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    ...shadow.subtle,
  },
  changeBtnText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  stepperDrawer: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: space.sm,
    gap: space.xs,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperLabel: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.ink,
  },
  stepperButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nudgeBtn: {
    backgroundColor: colors.surface,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  nudgeText: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.primary,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.xs,
  },
  langLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  langValue: {
    fontSize: typeScale.xs,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  langGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: space.xs,
  },
  langOption: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  langOptionActive: {
    backgroundColor: colors.primary,
  },
  langOptionText: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  langOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  privacyCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.xs,
  },
  privacyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  privacyTitle: {
    fontSize: typeScale.base,
    fontWeight: '700',
    color: colors.ink,
  },
  privacyBody: {
    fontSize: typeScale.xs,
    color: colors.muted,
    lineHeight: 18,
  },
  supportLinkBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    marginTop: space.xs,
    ...shadow.subtle,
  },
  supportLinkText: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.primary,
  },
})
