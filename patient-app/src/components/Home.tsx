/* Home and completion screens for the patient app.

Home is deliberately sparse: one clear action ("Start a check-in"), the person's
name, and when the next check-in is due. No clinical framing ever reaches this
screen — the patient sees their own trend and their own rhythm, never a risk
band or a score.
*/

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radius, space, type as typeScale } from '../theme'

export function Home({ name, nextIn, onStart, onSwitch }: {
  name: string
  nextIn: string | null
  onStart: () => void
  onSwitch: () => void
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Text style={styles.brand}>VIORA</Text>
        <Pressable onPress={onSwitch} hitSlop={16}>
          <Text style={styles.switch}>Change person</Text>
        </Pressable>
      </View>

      <View style={styles.centre}>
        <Text style={styles.greeting}>Hello, {name}.</Text>
        <Text style={styles.sub}>A quiet moment, just for you.</Text>

        <Pressable style={styles.start} onPress={onStart}>
          <Text style={styles.startText}>Start a check-in</Text>
        </Pressable>

        {nextIn && <Text style={styles.next}>Next check-in {nextIn}</Text>}
      </View>
    </View>
  )
}

export function Complete({ name, nextIn, onDone }: {
  name: string
  nextIn: string | null
  onDone: () => void
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.centre}>
        <Text style={styles.thank}>Thank you, {name}.</Text>
        <Text style={styles.sub}>That was a lot, and you did it.</Text>
        <Text style={styles.sub}>Your words are safe here.</Text>
        {nextIn && <Text style={styles.next}>We'll check in again {nextIn}.</Text>}
        <Pressable style={styles.done} onPress={onDone}>
          <Text style={styles.startText}>Done</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: space.md },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontSize: typeScale.md, fontWeight: '700', letterSpacing: 3, color: colors.primary },
  switch: { color: colors.muted, fontSize: typeScale.xs, textDecorationLine: 'underline' },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.sm },
  greeting: { fontSize: typeScale.xl, fontWeight: '600', color: colors.ink },
  sub: { fontSize: typeScale.base, color: colors.muted, textAlign: 'center' },
  start: { marginTop: space.lg, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: space.md, paddingHorizontal: space.xl },
  startText: { color: '#fff', fontSize: typeScale.md, fontWeight: '600' },
  next: { color: colors.primary, fontSize: typeScale.sm, fontWeight: '600', marginTop: space.md },
  thank: { fontSize: typeScale.xl, fontWeight: '600', color: colors.ink },
  done: { marginTop: space.lg, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: space.md, paddingHorizontal: space.xl },
})
