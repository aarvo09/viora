/* API client with `http` and `mock` adapters, selected by EXPO_PUBLIC_API_MODE.

The phone never holds a secret. It talks to the VIORA backend; only the backend
talks to Sarvam. Everything here is either this client or the backend.
*/

import type {
  CompleteInteractionResponse,
  DueCall,
  HistoryItem,
  OpenInteractionResponse,
  PatientProfile,
  PatientTranscript,
  PatientWellbeing,
  PreferencesPatch,
  ScheduleResponse,
  TurnResponse,
} from './types'

import { Platform } from 'react-native'

const DEFAULT_HOST = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000'
const BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || (Platform.OS === 'android' ? 'http://127.0.0.1:8000' : 'http://localhost:8000')).replace(/\/$/, '')
const MODE = process.env.EXPO_PUBLIC_API_MODE ?? 'http'

export const MODE_IS_MOCK = MODE === 'mock'

/** Exported so a caller can branch on the status rather than parse a message.
 *
 *  The voice loop needs this: a 422 from `voice-turn` means "no speech in that
 *  audio", which is a normal empty turn to listen through again, not a failure
 *  worth stopping the conversation for. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    })
  } catch {
    // If 127.0.0.1 failed on Android emulator, try 10.0.2.2 fallback
    if (Platform.OS === 'android' && BASE !== DEFAULT_HOST) {
      try {
        res = await fetch(`${DEFAULT_HOST}/api/v1${path}`, {
          ...init,
          headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
        })
      } catch {
        throw new ApiError(`Cannot reach the backend at ${BASE}`, 0)
      }
    } else {
      throw new ApiError(`Cannot reach the backend at ${BASE}`, 0)
    }
  }
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Multipart upload for a recorded audio turn.
 *
 * Content-Type is deliberately NOT set: React Native's fetch must add its own
 * multipart boundary, and setting the header manually breaks the body. */
async function upload<T>(path: string, form: FormData): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}/api/v1${path}`, { method: 'POST', body: form })
  } catch {
    if (Platform.OS === 'android' && BASE !== DEFAULT_HOST) {
      try {
        res = await fetch(`${DEFAULT_HOST}/api/v1${path}`, { method: 'POST', body: form })
      } catch {
        throw new ApiError(`Cannot reach the backend at ${BASE}`, 0)
      }
    } else {
      throw new ApiError(`Cannot reach the backend at ${BASE}`, 0)
    }
  }
  if (!res.ok) throw new ApiError(`Voice turn failed (${res.status})`, res.status)
  return (await res.json()) as T
}

// --------------------------------------------------------------- fixtures ---

const PROFILES: PatientProfile[] = [
  { uid: 'VRA-4821', display_name: 'Meera', preferred_language: 'hi', preferred_channel: 'TEXT', safe_contact_start: '10:00', safe_contact_end: '17:00' },
  { uid: 'VRA-7364', display_name: 'Sunita', preferred_language: 'hi', preferred_channel: 'TEXT', safe_contact_start: '11:00', safe_contact_end: '16:00' },
  { uid: 'VRA-2915', display_name: 'Kavita', preferred_language: 'hi', preferred_channel: 'TEXT', safe_contact_start: '09:00', safe_contact_end: '13:00' },
  { uid: 'VRA-5192', display_name: 'Rahul', preferred_language: 'hi', preferred_channel: 'VOICE', safe_contact_start: '10:00', safe_contact_end: '18:00' },
]

function wellbeing(uid: string): PatientWellbeing {
  const series = [
    { report_version: 1, created_at: new Date(Date.now() - 24 * 864e5).toISOString(), distress_score: 38.5, threat_score: 34.7, composite_score: 37.4 },
    { report_version: 2, created_at: new Date(Date.now() - 12 * 864e5).toISOString(), distress_score: 51.4, threat_score: 59.7, composite_score: 57.2 },
    { report_version: 3, created_at: new Date(Date.now() - 2 * 864e5).toISOString(), distress_score: 64.3, threat_score: 78.4, composite_score: 74.2 },
  ]
  return {
    uid,
    has_history: true,
    latest_check_in: series[series.length - 1].created_at,
    check_in_count: series.length,
    trend: 'WORSENING',
    series,
    next_follow_up: new Date(Date.now() + 1 * 864e5).toISOString(),
    next_follow_up_channel: 'VOICE',
  }
}

const OPEN_HI = {
  interaction_id: 1,
  case_id: 3,
  language: 'hi',
  channel: 'TEXT' as const,
  opening_message: 'नमस्ते कविता। मुझे बताइए, इस हफ्ते कैसा रहा?',
  opening_audio_b64: null,
}

// --------------------------------------------------------------- adapters ---

const httpApi = {
  listPatients: () => request<PatientProfile[]>('/patients'),
  getPatient: (uid: string) => request<PatientProfile>(`/patients/${uid}`),
  wellbeing: (uid: string) => request<PatientWellbeing>(`/patients/${uid}/wellbeing`),
  history: (uid: string) => request<HistoryItem[]>(`/patients/${uid}/history`),

  openInteraction: (uid: string, channel: 'TEXT' | 'VOICE') =>
    request<OpenInteractionResponse>('/interactions', {
      method: 'POST',
      body: JSON.stringify({ uid, channel }),
    }),

  textTurn: (interactionId: number, text: string) =>
    request<TurnResponse>(`/interactions/${interactionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  /** One spoken turn. `uri` is the local file the recorder produced; the backend
   *  transcribes it and drops the audio in the same request. */
  voiceTurn: (interactionId: number, uri: string, language?: string) => {
    const form = new FormData()
    // RN's FormData takes this {uri,name,type} shape rather than a Blob.
    form.append('audio', {
      uri,
      name: 'turn.m4a',
      type: 'audio/m4a',
    } as unknown as Blob)
    if (language) form.append('language', language)
    return upload<TurnResponse>(`/interactions/${interactionId}/voice-turn`, form)
  },

  complete: (interactionId: number) =>
    request<CompleteInteractionResponse>(`/interactions/${interactionId}/complete`, {
      method: 'POST',
    }),

  transcript: (uid: string, interactionId: number) =>
    request<PatientTranscript>(`/patients/${uid}/interactions/${interactionId}/transcript`),

  dueCall: (uid: string) =>
    request<DueCall>(`/patients/${uid}/due-call`),

  scheduleCall: (uid: string, scheduledFor: string, channel: 'TEXT' | 'VOICE') =>
    request<ScheduleResponse>(`/patients/${uid}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduled_for: scheduledFor, channel }),
    }),

  cancelSchedule: (uid: string) =>
    request<void>(`/patients/${uid}/schedule`, { method: 'DELETE' }),

  patchPreferences: (uid: string, prefs: PreferencesPatch) =>
    request<PatientProfile>(`/patients/${uid}/preferences`, {
      method: 'PATCH',
      body: JSON.stringify(prefs),
    }),
}

const mockApi = {
  listPatients: async () => PROFILES,
  getPatient: async (uid: string) => PROFILES.find((p) => p.uid === uid) ?? PROFILES[0],
  wellbeing: async (uid: string) => wellbeing(uid),
  // Underscore-prefixed params are deliberate: these mocks return fixed data but
  // must keep the real signatures, or swapping realApi for mockApi stops
  // type-checking the call sites.
  history: async (_uid: string): Promise<HistoryItem[]> => [
    { interaction_id: 1, started_at: new Date(Date.now() - 2 * 864e5).toISOString(), ended_at: new Date(Date.now() - 2 * 864e5).toISOString(), channel: 'VOICE', language: 'hi', status: 'COMPLETED', turn_count: 6 },
  ],

  openInteraction: async (_uid: string, _channel: 'TEXT' | 'VOICE'): Promise<OpenInteractionResponse> =>
    ({ ...OPEN_HI } as OpenInteractionResponse),

  textTurn: async (interactionId: number, text: string): Promise<TurnResponse> => ({
    interaction_id: interactionId,
    seq: 0,
    transcript: text,
    reply_text: 'मैं सुन रही हूँ। थोड़ा और बताइए?',
    sentences: [{ index: 0, text: 'मैं सुन रही हूँ। थोड़ा और बताइए?', audio_b64: null }],
    crisis_detected: false,
  }),

  voiceTurn: async (interactionId: number): Promise<TurnResponse> => ({
    interaction_id: interactionId,
    seq: 0,
    transcript: 'नींद ठीक से नहीं आ रही।',
    reply_text: 'यह सुनकर मुझे अफ़सोस है। कब से ऐसा हो रहा है?',
    sentences: [{ index: 0, text: 'यह सुनकर मुझे अफ़सोस है। कब से ऐसा हो रहा है?', audio_b64: null }],
    crisis_detected: false,
  }),

  complete: async (interactionId: number): Promise<CompleteInteractionResponse> => ({
    interaction_id: interactionId,
    report_version: 1,
    next_follow_up: new Date(Date.now() + 1 * 864e5).toISOString(),
    next_follow_up_channel: 'VOICE',
  }),

  transcript: async (_uid: string, interactionId: number): Promise<PatientTranscript> => ({
    interaction_id: interactionId,
    channel: 'TEXT',
    language: 'hi',
    started_at: new Date(Date.now() - 2 * 864e5).toISOString(),
    ended_at: new Date(Date.now() - 2 * 864e5).toISOString(),
    messages: [
      { seq: 1, role: 'VIORA', content: 'नमस्ते कविता। आप कैसी हैं आजकल?', created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
      { seq: 2, role: 'USER', content: 'ठीक हूँ, थोड़ा थकान है।', created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
      { seq: 3, role: 'VIORA', content: 'यह सुनकर समझ में आता है। थकान की वजह क्या है?', created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
    ],
  }),

  dueCall: async (_uid: string): Promise<DueCall> => ({
    due: false,
    follow_up_id: null,
    scheduled_for: new Date(Date.now() + 1 * 864e5).toISOString(),
    channel: 'TEXT',
    seconds_until: 86400,
    set_by_counsellor: false,
  }),

  scheduleCall: async (_uid: string, _scheduledFor: string, _channel: 'TEXT' | 'VOICE'): Promise<ScheduleResponse> => ({
    scheduled_for: new Date(Date.now() + 1 * 864e5).toISOString(),
    channel: _channel,
    status: 'SCHEDULED',
  }),

  cancelSchedule: async (_uid: string): Promise<void> => {},

  patchPreferences: async (_uid: string, _prefs: PreferencesPatch): Promise<PatientProfile> =>
    PROFILES.find((p) => p.uid === _uid) ?? PROFILES[0],
}

export const api = MODE === 'mock' ? mockApi : httpApi
export const apiBase = BASE
