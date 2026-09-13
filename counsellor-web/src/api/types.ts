/* Wire types — mirror `backend/app/schemas.py` exactly.
 *
 * The backend is the single source of truth. If a field changes there, it
 * changes here. Nothing in the UI may invent a field the API does not return —
 * particularly not an explanation factor (contract rule 4).
 */

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'URGENT'
export type Trend = 'IMPROVING' | 'STABLE' | 'WORSENING' | 'INSUFFICIENT_DATA'
export type Direction =
  | 'DE_ESCALATING'
  | 'STABLE'
  | 'ESCALATING'
  | 'INSUFFICIENT_DATA'
export type BaselineConfidence = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'
export type Severity = 'SERIOUS' | 'CONCERN' | 'INFO'
export type ReviewOutcome =
  | 'CONTINUE_MONITORING'
  | 'INTERVENTION_REQUIRED'
  | 'ESCALATE'
  | 'CLOSED'
export type InterventionType =
  | 'PSYCH_SUPPORT'
  | 'POLICE_PROTECTION'
  | 'RELOCATION'
  | 'LEGAL_AID'
  | 'MEDICAL'
  | 'COMPENSATION_FOLLOWUP'

export interface LoginResponse {
  access_token: string
  token_type: string
  staff_id: number
  name: string
  role: string
}

export interface Factor {
  code: string
  label: string
  severity: Severity
  evidence: string
  value: number | null
}

export interface Report {
  id: number
  report_version: number
  created_at: string
  interaction_id: number | null
  distress_score: number
  threat_score: number
  composite_score: number
  risk_level: RiskLevel
  baseline_score: number
  baseline_confidence: BaselineConfidence
  previous_score: number | null
  score_change: number
  baseline_deviation: number
  trend: Trend
  factors: Factor[]
  conversation_summary: string | null
  scoring_version: string
}

export interface Prediction {
  direction: Direction
  escalation_risk: number
  horizon: string
  created_at: string
}

/** One rule that moved the predicted interval. `multiplier` < 1 tightened it. */
export interface CadenceFactor {
  code: string
  label: string
  multiplier: number
}

export interface FollowUp {
  id: number
  scheduled_for: string
  channel: string
  status: 'SCHEDULED' | 'DUE' | 'COMPLETED' | 'MISSED' | 'CANCELLED'
  reason: string
  /** PREDICTED | COUNSELLOR. A human-set time is a decision, not a
   *  recommendation, so the two must not render identically. */
  source: 'PREDICTED' | 'COUNSELLOR' | 'AI' | 'PATIENT'
  /** Null on a counsellor-set follow-up: there is no prediction behind it. */
  cadence_hours: number | null
  cadence_base_hours: number | null
  /** Why this date and not next week. Empty for a counsellor-set time. */
  cadence_factors: CadenceFactor[]
  staff_note: string | null
}

export interface ScheduleCallRequest {
  scheduled_for: string
  channel: 'VOICE' | 'TEXT'
  follow_up_type?: 'COUNSELLOR' | 'AI'
  reason?: string
  note?: string
}

/** GET /follow-ups/due — the cross-case "who is waiting on me" queue.
 *  Denormalised on purpose: this list is scanned, not drilled into. */
export interface DueFollowUp {
  follow_up_id: number
  case_id: number
  case_ref: string
  display_name: string
  uid: string
  preferred_language: string
  scheduled_for: string
  days_overdue: number
  channel: string
  status: 'SCHEDULED' | 'DUE' | 'COMPLETED' | 'CANCELLED'
  reason: string
  source?: 'PREDICTED' | 'COUNSELLOR' | 'AI' | 'PATIENT'
  current_risk: RiskLevel | null
}

export interface Alert {
  id: number
  case_id: number
  severity: RiskLevel
  status: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED'
  factors: Factor[]
  created_at: string
  acknowledged_at: string | null
}

export interface AlertListItem extends Alert {
  case_ref: string
  display_name: string
  uid: string
  current_risk: RiskLevel | null
  direction: Direction | null
}

export interface CaseListItem {
  case_id: number
  case_ref: string
  uid: string
  display_name: string
  preferred_language: string
  status: string
  legal_stage: string | null
  risk_level: RiskLevel | null
  distress_score: number | null
  threat_score: number | null
  trend: Trend | null
  direction: Direction | null
  last_check_in: string | null
  next_follow_up: string | null
  open_alerts: number
}

export interface CaseDetail {
  case_id: number
  case_ref: string
  uid: string
  display_name: string
  preferred_language: string
  preferred_channel: string
  safe_contact_start: string
  safe_contact_end: string
  status: string
  legal_stage: string | null
  opened_at: string
  latest_report: Report | null
  latest_prediction: Prediction | null
  next_follow_up: FollowUp | null
  open_alerts: Alert[]
  report_count: number
  interaction_count: number
}

export interface TelemetryPoint {
  report_version: number
  created_at: string
  distress_score: number
  threat_score: number
  composite_score: number
  baseline_score: number
  risk_level: RiskLevel
  direction: Direction | null
}

export interface InteractionSummary {
  interaction_id: number
  started_at: string
  ended_at: string | null
  channel: string
  language: string
  status: string
  turn_count: number
}

export interface TranscriptMessage {
  seq: number
  role: 'USER' | 'VIORA'
  content: string
  created_at: string
}

export interface Transcript {
  interaction_id: number
  case_id: number
  channel: string
  language: string
  started_at: string
  ended_at: string | null
  messages: TranscriptMessage[]
}

export interface RiskDistribution {
  LOW: number
  MODERATE: number
  HIGH: number
  CRITICAL: number
  URGENT: number
}

export interface ActivityItem {
  case_id: number
  case_ref: string
  display_name: string
  kind: string
  detail: string
  at: string
}

export interface DashboardSummary {
  active_cases: number
  open_alerts: number
  pending_reviews: number
  follow_ups_due: number
  risk_distribution: RiskDistribution
  priority_cases: CaseListItem[]
  recent_activity: ActivityItem[]
}

export interface ReviewRequest {
  outcome: ReviewOutcome
  notes?: string
  alert_id?: number
  intervention_type?: InterventionType
}

export interface ReviewResponse {
  review_id: number
  outcome: string
  decided_at: string
  intervention_id: number | null
}
