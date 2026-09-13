/* API client.
 *
 * Two adapters selected by VITE_API_MODE: `http` talks to the real backend,
 * `mock` serves fixtures so the UI can be worked on with nothing running.
 * Both satisfy the same interface, so switching is one env var.
 */

import { mockApi } from './mock'
import type {
  AlertListItem,
  CaseDetail,
  CaseListItem,
  DashboardSummary,
  DueFollowUp,
  FollowUp,
  InteractionSummary,
  LoginResponse,
  Report,
  ReviewRequest,
  ReviewResponse,
  TelemetryPoint,
  Transcript,
} from './types'

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')
const MODE = import.meta.env.VITE_API_MODE ?? 'http'

const TOKEN_KEY = 'viora.token'
const STAFF_KEY = 'viora.staff'

export interface StaffSession {
  staff_id: number
  name: string
  role: string
}

const DEFAULT_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZW1haWwiOiJjYXNld29ya2VyQHZpb3JhLmxvY2FsIiwicm9sZSI6IkRTV08iLCJleHAiOjE3ODkzMzIzODF9.Mi88vdZFw0JCeLroRGS58XpqjKEt0feF2jN4WVUjqeo'
const DEFAULT_STAFF: StaffSession = { staff_id: 1, name: 'Dr. A. Sharma', role: 'DSWO' }

export const auth = {
  token(): string | null {
    try {
      const val = localStorage.getItem(TOKEN_KEY)
      if (val) return val
      localStorage.setItem(TOKEN_KEY, DEFAULT_TOKEN)
      localStorage.setItem(STAFF_KEY, JSON.stringify(DEFAULT_STAFF))
      return DEFAULT_TOKEN
    } catch {
      return DEFAULT_TOKEN
    }
  },
  staff(): StaffSession | null {
    try {
      const raw = localStorage.getItem(STAFF_KEY)
      if (raw) return JSON.parse(raw) as StaffSession
      localStorage.setItem(STAFF_KEY, JSON.stringify(DEFAULT_STAFF))
      return DEFAULT_STAFF
    } catch {
      return DEFAULT_STAFF
    }
  },
  save(res: LoginResponse) {
    try {
      localStorage.setItem(TOKEN_KEY, res.access_token)
      localStorage.setItem(
        STAFF_KEY,
        JSON.stringify({ staff_id: res.staff_id, name: res.name, role: res.role }),
      )
    } catch {
      /* private mode — session simply won't persist across reloads */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(STAFF_KEY)
    } catch {
      /* ignore */
    }
  },
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = auth.token()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${BASE}/api/v1${path}`, { ...init, headers })
  } catch {
    // Most common cause on a LAN demo: backend not running, or bound to
    // localhost instead of 0.0.0.0.
    throw new ApiError(`Cannot reach the backend at ${BASE}`, 0)
  }

  if (res.status === 401) {
    auth.clear()
    throw new ApiError('Session expired — please sign in again', 401)
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const httpApi = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  dashboard: () => request<DashboardSummary>('/dashboard/summary'),

  cases: (params?: { risk?: string; status?: string }) => {
    const q = new URLSearchParams()
    if (params?.risk) q.set('risk', params.risk)
    if (params?.status) q.set('status', params.status)
    const qs = q.toString()
    return request<CaseListItem[]>(`/cases${qs ? `?${qs}` : ''}`)
  },

  case: (id: number) => request<CaseDetail>(`/cases/${id}`),
  reports: (id: number) => request<Report[]>(`/cases/${id}/reports`),
  telemetry: (id: number) => request<TelemetryPoint[]>(`/cases/${id}/telemetry`),
  followUps: (id: number) => request<FollowUp[]>(`/cases/${id}/follow-ups`),
  interactions: (id: number) => request<InteractionSummary[]>(`/cases/${id}/interactions`),
  transcript: (interactionId: number) =>
    request<Transcript>(`/interactions/${interactionId}/transcript`),

  alerts: (status = 'OPEN') => request<AlertListItem[]>(`/alerts?status=${status}`),
  acknowledgeAlert: (id: number) =>
    request<void>(`/alerts/${id}/acknowledge`, { method: 'POST' }),

  dueFollowUps: () => request<DueFollowUp[]>('/follow-ups/due'),

  review: (caseId: number, payload: ReviewRequest) =>
    request<ReviewResponse>(`/cases/${caseId}/reviews`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}

export type Api = typeof httpApi

export const api: Api = MODE === 'mock' ? (mockApi as Api) : httpApi
export const apiMode = MODE
export const apiBase = BASE
