/* Crisis helplines — surfaced calmly in the middle of a conversation.

Contract §7: on a disclosure of imminent danger or suicidal intent, VIORA stays
with the person, shares these numbers, and offers to notify the caseworker.
This panel appears when `crisis_detected` comes back true on a turn. It never
takes over the conversation — the person can keep talking.
*/

import { StyleSheet, Text, View } from 'react-native'
import { colors, space, type as typeScale } from '../theme'

const LINES = [
  { number: '112', name: 'Emergency', color: colors.riskCritical },
  { number: '1091', name: "Women's helpline", color: colors.primary },
  { number: '14416', name: 'Tele-MANAS', color: colors.primary },
]

export function Helplines() {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>You're not alone. Someone is here for you.</Text>
      <Text style={styles.sub}>Call these any time, in your language:</Text>
      <View style={styles.rows}>
        {LINES.map((l) => (
          <View key={l.number} style={styles.row}>
            <Text style={[styles.num, { color: l.color }]}>{l.number}</Text>
            <Text style={styles.name}>{l.name}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.note}>Would you like to let your caseworker know now?</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    marginTop: space.sm,
    padding: space.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderLeftColor: colors.riskCritical,
  },
  title: { fontWeight: '600', fontSize: typeScale.base, color: colors.ink },
  sub: { color: colors.muted, fontSize: typeScale.sm, marginTop: 4 },
  rows: { marginTop: space.sm, gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  num: { fontSize: typeScale.lg, fontWeight: '700' },
  name: { color: colors.inkSoft, fontSize: typeScale.sm },
  note: { marginTop: space.sm, color: colors.primary, fontSize: typeScale.xs, fontWeight: '600' },
})
