/* Welcome screen — extracted from the old App.tsx. */

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { colors, space, type as typeScale } from '../theme'

export function Welcome({ loading, onDone }: { loading: boolean; onDone: () => void }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.brand}>VIORA</Text>
      <Text style={styles.tag}>a calm space, whenever you need one</Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: space.lg }} />
      ) : (
        <Text style={styles.tap} onPress={onDone}>
          Tap to begin
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.bg },
  brand: { fontSize: 42, fontWeight: '700', letterSpacing: 8, color: colors.primary },
  tag: { fontSize: typeScale.sm, color: colors.muted },
  tap: { marginTop: space.lg, color: colors.primary, fontSize: typeScale.base, fontWeight: '600' },
})
