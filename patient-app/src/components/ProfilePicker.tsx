/* For VIORA's patient app — a warm entry that lets the person identify
   themselves. The three profiles are ordinary people with ordinary names. */

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radius, space, type as typeScale } from '../theme'
import type { PatientProfile } from '../api/types'

export function ProfilePicker({ profiles, onSelect }: {
  profiles: PatientProfile[]
  onSelect: (p: PatientProfile) => void
}) {
  return (
    <View style={styles.screen}>
      <Text style={styles.brand}>VIORA</Text>
      <Text style={styles.welcome}>Hi. Who is checking in with you?</Text>
      <Text style={styles.hint}>Choosing a name keeps your check-in and your history together.</Text>

      <View style={styles.list}>
        {profiles.map((p) => (
          <Pressable
            key={p.uid}
            onPress={() => onSelect(p)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{p.display_name.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{p.display_name}</Text>
              <Text style={styles.meta}>
                {p.preferred_language === 'hi' ? 'हिन्दी' : p.preferred_language}
              </Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: space.md },
  brand: { fontSize: typeScale.xl, fontWeight: '700', letterSpacing: 4, color: colors.primary, marginTop: space.xl, textAlign: 'center' },
  welcome: { fontSize: typeScale.lg, color: colors.ink, textAlign: 'center', marginTop: space.lg, fontWeight: '600' },
  hint: { fontSize: typeScale.sm, color: colors.muted, textAlign: 'center', marginTop: space.xs, marginBottom: space.lg },
  list: { gap: space.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md },
  cardPressed: { opacity: 0.7 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: typeScale.xl, color: colors.primary, fontWeight: '700' },
  name: { fontSize: typeScale.base, color: colors.ink, fontWeight: '600' },
  meta: { fontSize: typeScale.xs, color: colors.muted, marginTop: 2 },
  chev: { fontSize: typeScale.xl, color: colors.muted },
})
