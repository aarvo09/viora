/* Conversational session — text and voice share one turn-taking core.

Voice is OFF by default. This is a safety decision (contract): a spoken
conversation can be overheard by the person the user is afraid of, so text is
the default and voice is an explicit choice. A one-tap Exit is always visible,
and conversation content never reaches a notification.

The mode toggle lets the person switch text <-> voice mid-check-in, which is
the safety behaviour the contract calls for — if someone walks into the room,
they can drop to text in one tap.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { api } from '../api/client'
import type { TurnResponse } from '../api/types'
import { colors, radius, shadow, space, type as typeScale } from '../theme'
import { Helplines } from './Helplines'
import { VoiceOrb, type OrbState } from './VoiceOrb'

type Mode = 'TEXT' | 'VOICE'
type Msg = { role: 'USER' | 'VIORA'; text: string }

export function Session({
  uid,
  name,
  initialChannel,
  onComplete,
  onExit,
  onSwitchToVoice,
}: {
  uid: string
  name: string
  language: string
  initialChannel: Mode
  onComplete: (reportVersion: number) => void
  onExit: () => void
  /** Hand off to the real microphone loop (`VoiceSession`). Absent in mock mode,
   *  where this component's own scripted orb stands in for a spoken check-in so
   *  the flow can be shown with no backend and no phone. */
  onSwitchToVoice?: () => void
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [interactionId, setInteractionId] = useState<number | null>(null)
  const [crisis, setCrisis] = useState(false)
  const [ending, setEnding] = useState(false)
  const [channel, setChannel] = useState<Mode>(initialChannel)
  const [orb, setOrb] = useState<OrbState>('SPEAKING')

  const fade = useRef(new Animated.Value(0)).current
  const messagesRef = useRef<Msg[]>([])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }).start()
  }, [fade])

  /* Open the check-in — VIORA speaks first, in the person's own language. */
  useEffect(() => {
    let alive = true
    api
      .openInteraction(uid, initialChannel)
      .then((r) => {
        if (!alive) return
        setInteractionId(r.interaction_id)
        setMessages([{ role: 'VIORA', text: r.opening_message }])
      })
      .catch(
        () => alive && Alert.alert('Could not start', 'Please check the connection and try again.'),
      )
    return () => {
      alive = false
    }
  }, [uid, initialChannel])

  const push = useCallback((m: Msg) => setMessages((prev) => [...prev, m]), [])

  /* One turn: the person's words in, VIORA's reply out. Shared by both modes. */
  const handleTurn = useCallback(
    async (text: string) => {
      if (!interactionId || busy) return
      const trimmed = text.trim()
      if (!trimmed) return
      setInput('')
      setBusy(true)
      setOrb('THINKING')
      push({ role: 'USER', text: trimmed })
      try {
        const res: TurnResponse = await api.textTurn(interactionId, trimmed)
        push({ role: 'VIORA', text: res.reply_text })
        if (res.crisis_detected) setCrisis(true)
        setOrb('SPEAKING')
      } catch {
        Alert.alert('Something went wrong', 'Could not reach the assistant. Try again.')
        setOrb('LISTENING')
      } finally {
        setBusy(false)
      }
    },
    [interactionId, busy, push],
  )

  /* Voice turn loop: VIORA speaks, then listening opens. On a device the
     listening phase is closed by the VAD (sustained silence); here the phase
     advances on its own so the loop is demonstrable without audio. */
  useEffect(() => {
    if (channel !== 'VOICE') return
    const last = messagesRef.current[messagesRef.current.length - 1]
    if (!last || last.role !== 'VIORA') return
    setOrb('SPEAKING')
    const dur = Math.min(2800, Math.max(1200, last.text.length * 55))
    const t = setTimeout(() => setOrb('LISTENING'), dur)
    return () => clearTimeout(t)
  }, [channel, messages])

  const finish = useCallback(async () => {
    if (!interactionId || ending) return
    setEnding(true)
    try {
      const res = await api.complete(interactionId)
      onComplete(res.report_version)
    } catch {
      setEnding(false)
      Alert.alert('Could not finish', 'Please try again.')
    }
  }, [interactionId, ending, onComplete])

  const orbLabel =
    orb === 'SPEAKING' ? 'Speaking' : orb === 'LISTENING' ? 'Listening' : 'Thinking'
  const orbSub =
    orb === 'SPEAKING' ? 'बोल रही हूँ' : orb === 'LISTENING' ? 'आप बोलिए' : 'समझ रही हूँ'

  return (
    <Animated.View style={[styles.screen, { opacity: fade }]}>
      <View style={styles.header}>
        <Pressable onPress={onExit} hitSlop={16}>
          <Text style={styles.exit}>Exit</Text>
        </Pressable>
        <Text style={styles.name}>{name}</Text>
        <Pressable
          onPress={() => {
            if (channel === 'VOICE') return setChannel('TEXT')
            // Prefer the real loop when one is available; otherwise fall back to
            // this component's scripted orb.
            if (onSwitchToVoice) return onSwitchToVoice()
            setChannel('VOICE')
          }}
          hitSlop={16}
        >
          <Text style={styles.modeToggle}>{channel === 'VOICE' ? 'Text' : 'Voice'}</Text>
        </Pressable>
      </View>

      {channel === 'VOICE' ? (
        <>
          <VoiceOrb state={orb} label={orbLabel} sublabel={orbSub} />
          {crisis && <Helplines />}
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.messages}>
          {messages.map((m, i) => (
            <View
              key={i}
              style={[styles.bubble, m.role === 'VIORA' ? styles.bubbleViora : styles.bubbleUser]}
            >
              <Text style={styles.bubbleText}>{m.text}</Text>
            </View>
          ))}
          {busy && (
            <View style={styles.typing}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
          {crisis && <Helplines />}
        </ScrollView>
      )}

      {channel === 'TEXT' && (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="अपना जवाब लिखिए…"
            placeholderTextColor={colors.muted}
            onSubmitEditing={() => handleTurn(input)}
            multiline
          />
          <Pressable
            style={[styles.send, (busy || !input.trim()) && styles.disabled]}
            onPress={() => handleTurn(input)}
            disabled={busy || !input.trim()}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </Pressable>
        </View>
      )}

      <Pressable style={styles.end} onPress={finish} disabled={ending}>
        <Text style={styles.endText}>{ending ? 'Wrapping up…' : 'End check-in'}</Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: space.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: space.md,
  },
  exit: { color: colors.muted, fontSize: typeScale.xs, textDecorationLine: 'underline' },
  name: { fontSize: typeScale.md, fontWeight: '600', color: colors.ink },
  modeToggle: { color: colors.primary, fontSize: typeScale.xs, fontWeight: '600' },
  messages: { gap: space.sm, paddingBottom: space.md },
  bubble: { maxWidth: '88%', padding: space.sm, borderRadius: radius.card, ...shadow.card },
  bubbleViora: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.line,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primaryTint,
    borderBottomRightRadius: 4,
  },
  bubbleText: { color: colors.ink, fontSize: typeScale.base, lineHeight: 26 },
  typing: { padding: space.sm, paddingLeft: 0 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, marginTop: space.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.md,
    paddingVertical: 14,
    color: colors.ink,
    fontSize: typeScale.base,
    maxHeight: 120,
  },
  send: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.button,
  },
  sendIcon: { color: '#fff', fontSize: 20, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  end: { alignSelf: 'center', padding: space.md },
  endText: { color: colors.muted, fontSize: typeScale.sm, textDecorationLine: 'underline' },
})
