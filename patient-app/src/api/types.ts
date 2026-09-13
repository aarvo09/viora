/* Patient wire types — mirror `backend/app/schemas.py` patient endpoints.

The patient app NEVER receives a risk band, a distress score, or any clinical
framing. That is a deliberate boundary: those exist for the caseworker, not for
the person living it. The wellbeing endpoint returns only the person's own trend
and a gentle series.
*/

export interface PatientProfile {
  uid: string
  display_name: string
  preferred_language: string
  preferred_channel: 'TEXT' | 'VOICE'
  safe_contact_start: string
  safe_contact_end: string
}

export interface WellbeingPoint {
  report_version: number
  created_at: string
  distress_score: number
  threat_score: number
  composite_score: number
}

export interface PatientWellbeing {
  uid: string
  has_history: boolean
  latest_check_in: string | null
  check_in_count: number
  trend: string
  series: WellbeingPoint[]
  next_follow_up: string | null
  next_follow_up_channel: string | null
}

export interface HistoryItem {
  interaction_id: number
  started_at: string
  ended_at: string | null
  channel: string
  language: string
  status: string
  turn_count: number
}

export interface OpenInteractionResponse {
  interaction_id: number
  case_id: number
  language: string
  channel: 'TEXT' | 'VOICE'
  opening_message: string
  opening_audio_b64: string | null
}

export interface AudioSentence {
  index: number
  text: string
  audio_b64: string | null
}

export interface TurnResponse {
  interaction_id: number
  seq: number
  transcript: string | null
  reply_text: string
  sentences: AudioSentence[]
  crisis_detected: boolean
}

export interface CompleteInteractionResponse {
  interaction_id: number
  report_version: number
  next_follow_up: string | null
  next_follow_up_channel: string | null
}

/** Patient-visible transcript of a past interaction. Returned by the new
 *  patient transcript endpoint, not the counsellor one (which is behind staff
 *  auth). Role is 'USER' | 'VIORA', matching the stored value. */
export interface PatientTranscriptMessage {
  seq: number
  role: 'USER' | 'VIORA'
  content: string
  created_at: string
}

export interface PatientTranscript {
  interaction_id: number
  channel: string
  language: string
  started_at: string
  ended_at: string | null
  messages: PatientTranscriptMessage[]
}

/** Minimal response from the patient-initiated reschedule endpoint. The full
 *  FollowUpOut with cadence factors is the counsellor surface; this one carries
 *  only what the person needs to see on their scheduler. */
export interface ScheduleResponse {
  scheduled_for: string
  channel: string
  status: string
}

/** Preferences the patient can change. Excludes display_name and uid. */
export interface PreferencesPatch {
  preferred_language?: string
  preferred_channel?: 'TEXT' | 'VOICE'
  safe_contact_start?: string
  safe_contact_end?: string
}

export interface DueCall {
  due: boolean
  follow_up_id: number | null
  scheduled_for: string | null
  channel: string | null
  seconds_until: number | null
  set_by_counsellor: boolean
}
