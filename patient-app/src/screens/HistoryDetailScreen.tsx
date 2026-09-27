/* One past check-in, read back.
 *
 * Reads GET /patients/{uid}/interactions/{id}/transcript — the patient endpoint,
 * not the counsellor's. That distinction is the point: the counsellor route sits
 * behind staff auth and returns `case_id`, and this router has no auth at all,
 * so the backend checks that the interaction belongs to this person's case
 * before returning a word of it.
 *
 * What is deliberately absent: any score, band, summary or "what VIORA
 * concluded". The person sees the conversation they actually had. The assessment
 * built from it belongs to the caseworker.
 */

import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { api, ApiError } from '../api/client'
import type { PatientTranscript } from '../api/types'
import { formatTime, relativeDay } from '../lib/datetime'
import { colors, radius, space, type as typeScale } from '../theme'
import { Screen } from '../ui/Screen'
import { Card, Chip, EmptyState, Enter, Header, Skeleton } from '../ui/kit'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; transcript: PatientTranscript }
  | { state: 'error'; message: string }

export function HistoryDetailScreen({
  uid,
  interactionId,
  onBack,
}: {
  uid: string
  interactionId: number
  onBack: () => void
}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    let alive = true
    setLoad({ state: 'loading' })
    api
      .transcript(uid, interactionId)
      .then((t) => alive && setLoad({ state: 'ready', transcript: t }))
      .catch((e: unknown) =>
        alive &&
        setLoad({
          state: 'error',
          message:
            e instanceof ApiError && e.status === 404
              ? 'That check-in could not be found.'
              : 'This check-in could not be loaded. Please try again.',
        }),
      )
    return () => {
      alive = false
    }
  }, [uid, interactionId])

  const transcript = load.state === 'ready' ? load.transcript : null
  const started = transcript ? new Date(transcript.started_at) : null
  const now = new Date()

  return (
    <Screen scroll padded>
      <Enter index={0}>
        <Header
          title={
            started ? `${relativeDay(started, now)}, ${formatTime(started)}` : 'Check-in'
          }
          subtitle={
            transcript
              ? transcript.channel === 'VOICE'
                ? 'Voice check-in'
                : 'Text check-in'
              : undefined
          }
          onBack={onBack}
        />
      </Enter>

      {load.state === 'loading' && (
        <Enter index={1}>
          <Skeleton height={64} />
          <Skeleton height={92} />
          <Skeleton height={64} />
        </Enter>
      )}

      {load.state === 'error' && (
        <Enter index={1}>
          <EmptyState icon="chat" title="Not available" body={load.message} />
        </Enter>
      )}

      {transcript && transcript.messages.length === 0 && (
        <Enter index={1}>
          <EmptyState
            icon="chat"
            title="Nothing was said in this check-in"
            body="This one ended before the conversation began."
          />
        </Enter>
      )}

      {transcript?.messages.map((message, i) => {
        const mine = message.role === 'USER'
        return (
          <Enter key={message.seq} index={Math.min(i + 1, 8)}>
            <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {!mine && <Text style={styles.who}>VIORA</Text>}
                <Text style={[styles.text, mine && styles.textMine]}>{message.content}</Text>
              </View>
            </View>
          </Enter>
        )
      })}

      {transcript && transcript.messages.length > 0 && (
        <Enter index={9}>
          <Card style={styles.footer}>
            <Chip
              label={transcript.ended_at ? 'Completed' : 'Not finished'}
              tone={transcript.ended_at ? 'good' : 'neutral'}
            />
            <Text style={styles.footerText}>
              Only you and your caseworker can see this conversation.
            </Text>
          </Card>
        </Enter>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: space.xs },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },

  bubble: { maxWidth: '86%', borderRadius: radius.lg, padding: space.tiny },
  theirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderTopLeftRadius: radius.sm,
  },
  mine: { backgroundColor: colors.primary, borderTopRightRadius: radius.sm },

  who: {
    fontSize: typeScale.xs,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 1,
    marginBottom: 2,
  },
  // 26px leading: Devanagari sits taller than Latin and clips at the tighter
  // line-height the rest of the app uses for body copy.
  text: { fontSize: typeScale.base, color: colors.ink, lineHeight: 26 },
  textMine: { color: '#fff' },

  footer: { marginTop: space.sm, gap: space.xs, alignItems: 'flex-start' },
  footerText: { fontSize: typeScale.xs, color: colors.muted, lineHeight: 18 },
})
