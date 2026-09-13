/* Support screen — the numbers, always two taps from anywhere.
 *
 * Reachable from the profile tab and from the home screen, so a person never
 * has to be mid-conversation to find help. `Helplines.tsx` is the in-conversation
 * version of the same information; this is the destination you can go looking
 * for, so the numbers are tappable and there is room to say what each one is.
 *
 * Two deliberate choices about calling:
 *
 *  * The numbers dial through `Linking`, which hands off to the phone app. A
 *    dialled call appears in the call log. For someone whose phone is checked
 *    that is a real consequence, so the screen says so plainly once, near the
 *    numbers, rather than hiding it or making it dramatic. The person decides.
 *  * Nothing here is logged back to the backend. Opening this screen is not a
 *    signal, not a distress event, and not something a caseworker sees. If it
 *    were, a person would learn to avoid it.
 */

import { useCallback } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radius, space, type as typeScale } from '../theme'
import { Screen } from '../ui/Screen'
import { Card, Enter, Header, SectionTitle } from '../ui/kit'
import { Icon } from '../ui/Icon'

interface Line {
  number: string
  name: string
  detail: string
  urgent?: boolean
}

const LINES: Line[] = [
  {
    number: '112',
    name: 'Emergency',
    detail: 'Police, ambulance and fire. Use this if you are in danger right now.',
    urgent: true,
  },
  {
    number: '181',
    name: 'Women’s helpline',
    detail: 'Round the clock support, shelter and rescue for women in distress.',
  },
  {
    number: '1091',
    name: 'Women’s helpline (police)',
    detail: 'A direct line to the women’s police unit in your area.',
  },
  {
    number: '14416',
    name: 'Tele-MANAS',
    detail: 'Free mental health support in your own language, day or night.',
  },
  {
    number: '1098',
    name: 'Childline',
    detail: 'For a child who needs help, or if you are worried about one.',
  },
]

export function SupportScreen({ onBack }: { onBack: () => void }) {
  const call = useCallback((number: string) => {
    // `openURL` rejects when no dialler can take it (an emulator with no telephony,
    // a tablet). Swallowed on purpose: the number is on screen and can be dialled
    // by hand, so an error box here would add alarm without adding a way through.
    Linking.openURL(`tel:${number}`).catch(() => {})
  }, [])

  return (
    <Screen scroll padded>
      <Enter index={0}>
        <Header title="Get help" onBack={onBack} />
      </Enter>

      <Enter index={1}>
        <Card tone="tint">
          <Text style={styles.leadTitle}>You can call any of these, any time.</Text>
          <Text style={styles.leadBody}>
            They are free, they work day and night, and you can speak in your own
            language. You do not have to explain everything to ask for help.
          </Text>
        </Card>
      </Enter>

      <Enter index={2}>
        <SectionTitle>Helplines</SectionTitle>
      </Enter>

      {LINES.map((line, i) => (
        <Enter key={line.number} index={3 + i}>
          <Pressable
            onPress={() => call(line.number)}
            style={({ pressed }) => [
              styles.line,
              line.urgent && styles.lineUrgent,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Call ${line.name} on ${line.number}`}
          >
            <View style={[styles.numberBox, line.urgent && styles.numberBoxUrgent]}>
              <Text style={[styles.number, line.urgent && styles.numberUrgent]}>
                {line.number}
              </Text>
            </View>
            <View style={styles.lineText}>
              <Text style={styles.lineName}>{line.name}</Text>
              <Text style={styles.lineDetail}>{line.detail}</Text>
            </View>
            <Icon name="phone" size={20} color={line.urgent ? colors.riskCritical : colors.primary} />
          </Pressable>
        </Enter>
      ))}

      <Enter index={3 + LINES.length}>
        <View style={styles.note}>
          <Icon name="shield" size={16} color={colors.muted} />
          <Text style={styles.noteText}>
            A call you make from this phone will show in your call history. If that
            is not safe for you, these numbers can be called from any other phone.
          </Text>
        </View>
      </Enter>

      <Enter index={4 + LINES.length}>
        <Card style={styles.aboutCard}>
          <Text style={styles.aboutTitle}>About your check-ins</Text>
          <Text style={styles.aboutBody}>
            What you say in a check-in is shared with your caseworker so they can
            support you. VIORA never shares it with anyone else, and nothing about
            a check-in ever appears in a notification on this phone.
          </Text>
        </Card>
      </Enter>
    </Screen>
  )
}

const styles = StyleSheet.create({
  leadTitle: { fontSize: typeScale.md, fontWeight: '700', color: colors.primaryDeep },
  leadBody: {
    fontSize: typeScale.sm,
    color: colors.inkSoft,
    lineHeight: 22,
    marginTop: space.hair,
  },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tiny,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: space.tiny,
    marginBottom: space.xs,
    minHeight: 72,
  },
  lineUrgent: { borderLeftWidth: 4, borderLeftColor: colors.riskCritical },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },

  numberBox: {
    minWidth: 66,
    paddingHorizontal: space.xs,
    paddingVertical: space.hair,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberBoxUrgent: { backgroundColor: '#F7E7E5' },
  number: { fontSize: typeScale.md, fontWeight: '700', color: colors.primaryDeep },
  numberUrgent: { color: colors.riskCritical },

  lineText: { flex: 1 },
  lineName: { fontSize: typeScale.base, fontWeight: '600', color: colors.ink },
  lineDetail: { fontSize: typeScale.xs, color: colors.muted, marginTop: 2, lineHeight: 18 },

  note: {
    flexDirection: 'row',
    gap: space.xs,
    alignItems: 'flex-start',
    paddingHorizontal: space.hair,
    marginTop: space.xs,
  },
  noteText: { flex: 1, fontSize: typeScale.xs, color: colors.muted, lineHeight: 18 },

  aboutCard: { marginTop: space.md },
  aboutTitle: { fontSize: typeScale.base, fontWeight: '700', color: colors.ink },
  aboutBody: {
    fontSize: typeScale.sm,
    color: colors.inkSoft,
    lineHeight: 22,
    marginTop: space.hair,
  },
})
