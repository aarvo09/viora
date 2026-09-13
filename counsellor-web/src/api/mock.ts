/* Mock adapter — fixtures shaped exactly like the real API.
 *
 * For design work with no backend running. Values here mirror what the real
 * pipeline produces for the seeded cases, so the UI looks the same in both
 * modes. Switch with VITE_API_MODE=mock.
 */

import type {
  AlertListItem,
  CadenceFactor,
  CaseDetail,
  CaseListItem,
  DashboardSummary,
  DueFollowUp,
  FollowUp,
  Factor,
  InteractionSummary,
  LoginResponse,
  Report,
  ReviewRequest,
  ReviewResponse,
  TelemetryPoint,
  Transcript,
} from './types'

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString()
const daysAhead = (n: number) => new Date(Date.now() + n * 864e5).toISOString()

const f = (
  code: string,
  label: string,
  severity: Factor['severity'],
  evidence = '',
  value: number | null = null,
): Factor => ({ code, label, severity, evidence, value })

const KAVITA_FACTORS: Factor[] = [
  f('NEW_INCIDENT', 'New incident reported', 'SERIOUS', 'कल रात कुछ लोग घर के बाहर आए थे।', 0.6),
  f('DIRECT_THREAT', 'Direct threat received', 'SERIOUS', 'धमकी वाले मैसेज आए हैं।', 0.8),
  f('UNSAFE_AT_HOME', 'Reports not feeling safe at home', 'SERIOUS', 'अब घर पर भी डर लगता है।', 0.7),
  f('WITHDRAWAL_PRESSURE', 'Pressure to withdraw complaint', 'SERIOUS', '', 0.8),
  f('DISTRESS_ABOVE_BASELINE', 'Distress above personal baseline', 'CONCERN', '+13.0 vs baseline 51.2', 13),
  f('THREAT_ELEVATED', 'Elevated external threat', 'CONCERN', 'threat 78.4', 78.4),
  f('SLEEP_CONCERN', 'Sleep disturbance', 'CONCERN', '', 0.8),
  f('TREND_ESCALATING', 'Pattern suggests escalation', 'CONCERN'),
]

// Cadence factors as `backend/app/services/cadence.py` emits them: codes,
// labels and multipliers copied from the rule table, so the "why this date"
// panel is designed against real values rather than invented ones.
const CADENCE_FACTORS_CRITICAL: CadenceFactor[] = [
  { code: 'CADENCE_ESCALATING', label: 'Escalating trajectory — check in sooner', multiplier: 0.5 },
  { code: 'CADENCE_ABOVE_BASELINE', label: 'Above personal baseline', multiplier: 0.7 },
  { code: 'CADENCE_NEW_THREAT', label: 'New incident or direct threat disclosed', multiplier: 0.6 },
  { code: 'CADENCE_UNSAFE_AT_HOME', label: 'Does not feel safe at home', multiplier: 0.7 },
]

const CADENCE_FACTORS_ESCALATING: CadenceFactor[] = [
  { code: 'CADENCE_ESCALATING', label: 'Escalating trajectory — check in sooner', multiplier: 0.5 },
  { code: 'CADENCE_DISTRESS_ROSE', label: 'Distress rose since last check-in', multiplier: 0.8 },
]

const kavitaReport: Report = {
  id: 9,
  report_version: 3,
  created_at: daysAgo(2),
  interaction_id: 9,
  distress_score: 64.3,
  threat_score: 78.4,
  composite_score: 74.2,
  risk_level: 'CRITICAL',
  baseline_score: 51.2,
  baseline_confidence: 'MEDIUM',
  previous_score: 51.4,
  score_change: 12.9,
  baseline_deviation: 13.1,
  trend: 'WORSENING',
  factors: KAVITA_FACTORS,
  conversation_summary:
    'Reports a new incident outside her home and escalating threats to withdraw the case. States she no longer feels safe at home. Sleep severely disturbed.',
  scoring_version: '1.0.0',
}

const CASES: CaseListItem[] = [
  {
    case_id: 3,
    case_ref: 'CASE-2024-0288',
    uid: 'VRA-2915',
    display_name: 'Kavita Kumari',
    preferred_language: 'hi',
    status: 'ACTIVE',
    legal_stage: 'FIR registered',
    risk_level: 'CRITICAL',
    distress_score: 64.3,
    threat_score: 78.4,
    trend: 'WORSENING',
    direction: 'ESCALATING',
    last_check_in: daysAgo(2),
    next_follow_up: daysAhead(1),
    open_alerts: 1,
  },
  {
    case_id: 2,
    case_ref: 'CASE-2024-0203',
    uid: 'VRA-7364',
    display_name: 'Sunita Bai',
    preferred_language: 'hi',
    status: 'ACTIVE',
    legal_stage: 'Under investigation',
    risk_level: 'HIGH',
    distress_score: 57.8,
    threat_score: 61.3,
    trend: 'WORSENING',
    direction: 'ESCALATING',
    last_check_in: daysAgo(6),
    next_follow_up: daysAhead(0),
    open_alerts: 1,
  },
  {
    case_id: 1,
    case_ref: 'CASE-2024-0117',
    uid: 'VRA-4821',
    display_name: 'Meera Devi',
    preferred_language: 'hi',
    status: 'ACTIVE',
    legal_stage: 'Chargesheet filed',
    risk_level: 'LOW',
    distress_score: 18.6,
    threat_score: 0,
    trend: 'IMPROVING',
    direction: 'DE_ESCALATING',
    last_check_in: daysAgo(3),
    next_follow_up: daysAhead(11),
    open_alerts: 0,
  },
]

const TELEMETRY: Record<number, TelemetryPoint[]> = {
  3: [
    { report_version: 1, created_at: daysAgo(24), distress_score: 38.5, threat_score: 34.7, composite_score: 37.4, baseline_score: 38.5, risk_level: 'MODERATE', direction: 'INSUFFICIENT_DATA' },
    { report_version: 2, created_at: daysAgo(12), distress_score: 51.4, threat_score: 59.7, composite_score: 57.2, baseline_score: 38.5, risk_level: 'HIGH', direction: 'INSUFFICIENT_DATA' },
    { report_version: 3, created_at: daysAgo(2), distress_score: 64.3, threat_score: 78.4, composite_score: 74.2, baseline_score: 51.2, risk_level: 'CRITICAL', direction: 'ESCALATING' },
  ],
  2: [
    { report_version: 1, created_at: daysAgo(30), distress_score: 31.2, threat_score: 27.4, composite_score: 30.1, baseline_score: 31.2, risk_level: 'MODERATE', direction: 'INSUFFICIENT_DATA' },
    { report_version: 2, created_at: daysAgo(18), distress_score: 44.6, threat_score: 41.9, composite_score: 43.8, baseline_score: 31.2, risk_level: 'MODERATE', direction: 'INSUFFICIENT_DATA' },
    { report_version: 3, created_at: daysAgo(6), distress_score: 57.8, threat_score: 61.3, composite_score: 60.3, baseline_score: 37.9, risk_level: 'HIGH', direction: 'ESCALATING' },
  ],
  1: [
    { report_version: 1, created_at: daysAgo(28), distress_score: 26.9, threat_score: 0, composite_score: 18.8, baseline_score: 26.9, risk_level: 'LOW', direction: 'INSUFFICIENT_DATA' },
    { report_version: 2, created_at: daysAgo(14), distress_score: 21.4, threat_score: 0, composite_score: 15.0, baseline_score: 26.9, risk_level: 'LOW', direction: 'INSUFFICIENT_DATA' },
    { report_version: 3, created_at: daysAgo(3), distress_score: 18.6, threat_score: 0, composite_score: 13.0, baseline_score: 24.2, risk_level: 'LOW', direction: 'DE_ESCALATING' },
  ],
}

const ALERTS: AlertListItem[] = [
  {
    id: 2,
    case_id: 3,
    severity: 'CRITICAL',
    status: 'OPEN',
    factors: KAVITA_FACTORS.slice(0, 4),
    created_at: daysAgo(2),
    acknowledged_at: null,
    case_ref: 'CASE-2024-0288',
    display_name: 'Kavita Kumari',
    uid: 'VRA-2915',
    current_risk: 'CRITICAL',
    direction: 'ESCALATING',
  },
  {
    id: 1,
    case_id: 2,
    severity: 'HIGH',
    status: 'OPEN',
    factors: [
      f('WITHDRAWAL_PRESSURE', 'Pressure to withdraw complaint', 'SERIOUS', 'केस वापस ले लो, वरना ठीक नहीं होगा।', 0.5),
      f('THREAT_ELEVATED', 'Elevated external threat', 'CONCERN', 'threat 61.3', 61.3),
      f('SOCIAL_ISOLATION', 'Social isolation', 'CONCERN', 'बाहर निकलने का मन भी नहीं करता।', 0.6),
    ],
    created_at: daysAgo(6),
    acknowledged_at: null,
    case_ref: 'CASE-2024-0203',
    display_name: 'Sunita Bai',
    uid: 'VRA-7364',
    current_risk: 'HIGH',
    direction: 'ESCALATING',
  },
]

const wait = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 120))

export const mockApi = {
  login: (email: string): Promise<LoginResponse> =>
    wait({
      access_token: 'mock-token',
      token_type: 'bearer',
      staff_id: 1,
      name: 'A. Sharma',
      role: 'DSWO',
      email,
    } as LoginResponse),

  dashboard: (): Promise<DashboardSummary> =>
    wait({
      active_cases: CASES.length,
      open_alerts: ALERTS.length,
      pending_reviews: 2,
      follow_ups_due: 1,
      risk_distribution: { LOW: 1, MODERATE: 0, HIGH: 1, CRITICAL: 1, URGENT: 0 },
      priority_cases: CASES.filter((c) => c.risk_level && ['HIGH', 'CRITICAL', 'URGENT'].includes(c.risk_level)),
      recent_activity: CASES.map((c) => ({
        case_id: c.case_id,
        case_ref: c.case_ref,
        display_name: c.display_name,
        kind: 'CHECK_IN',
        detail: `Check-in assessed — ${c.risk_level}, ${(c.trend ?? '').toLowerCase()}`,
        at: c.last_check_in ?? daysAgo(1),
      })),
    }),

  cases: (): Promise<CaseListItem[]> => wait(CASES),

  case: (id: number): Promise<CaseDetail> => {
    const row = CASES.find((c) => c.case_id === id) ?? CASES[0]
    const points = TELEMETRY[row.case_id] ?? []
    const latest = points[points.length - 1]
    return wait({
      case_id: row.case_id,
      case_ref: row.case_ref,
      uid: row.uid,
      display_name: row.display_name,
      preferred_language: row.preferred_language,
      preferred_channel: row.case_id === 1 ? 'TEXT' : 'VOICE',
      safe_contact_start: '09:00',
      safe_contact_end: '13:00',
      status: row.status,
      legal_stage: row.legal_stage,
      opened_at: daysAgo(60),
      latest_report:
        row.case_id === 3
          ? kavitaReport
          : {
              ...kavitaReport,
              id: row.case_id,
              report_version: 3,
              created_at: row.last_check_in ?? daysAgo(3),
              distress_score: latest?.distress_score ?? 0,
              threat_score: latest?.threat_score ?? 0,
              composite_score: latest?.composite_score ?? 0,
              risk_level: row.risk_level ?? 'LOW',
              baseline_score: latest?.baseline_score ?? 0,
              trend: row.trend ?? 'STABLE',
              factors: row.case_id === 2 ? ALERTS[1].factors : [f('PROTECTIVE_SUPPORT', 'Support factors present', 'INFO', '', 0.7)],
              conversation_summary:
                row.case_id === 2
                  ? 'Reports being pressured to withdraw her complaint. Describes worsening isolation and disturbed sleep.'
                  : 'Describes sleeping better and feeling more settled. Mentions support from neighbours as well as family.',
            },
      latest_prediction: {
        direction: row.direction ?? 'STABLE',
        escalation_risk: row.case_id === 3 ? 71.4 : row.case_id === 2 ? 58.2 : 9.1,
        horizon: 'NEXT_2_CHECKINS',
        created_at: row.last_check_in ?? daysAgo(3),
      },
      next_follow_up: {
        id: 1,
        scheduled_for: row.next_follow_up ?? daysAhead(7),
        channel: row.case_id === 1 ? 'TEXT' : 'VOICE',
        status: 'SCHEDULED',
        reason:
          row.case_id === 3
            ? 'Critical risk — next-day follow-up (escalating trajectory)'
            : row.case_id === 2
              ? 'High risk — early follow-up (escalating trajectory)'
              : 'Routine monitoring',
        source: 'PREDICTED',
        cadence_hours: row.case_id === 3 ? 24 : row.case_id === 2 ? 72 : 168,
        cadence_base_hours: row.case_id === 3 ? 24 : row.case_id === 2 ? 72 : 336,
        cadence_factors:
          row.case_id === 3
            ? CADENCE_FACTORS_CRITICAL
            : row.case_id === 2
              ? CADENCE_FACTORS_ESCALATING
              : [],
        staff_note: null,
      },
      open_alerts: ALERTS.filter((a) => a.case_id === row.case_id),
      report_count: points.length,
      interaction_count: points.length,
    })
  },

  reports: (id: number): Promise<Report[]> => {
    const points = TELEMETRY[id] ?? []
    return wait(
      [...points].reverse().map((p) => ({
        ...kavitaReport,
        id: p.report_version,
        report_version: p.report_version,
        created_at: p.created_at,
        distress_score: p.distress_score,
        threat_score: p.threat_score,
        composite_score: p.composite_score,
        risk_level: p.risk_level,
        baseline_score: p.baseline_score,
        baseline_confidence: p.report_version === 1 ? 'NONE' : p.report_version === 2 ? 'LOW' : 'MEDIUM',
        factors: p.report_version === 3 ? KAVITA_FACTORS : KAVITA_FACTORS.slice(4),
      })),
    )
  },

  telemetry: (id: number): Promise<TelemetryPoint[]> => wait(TELEMETRY[id] ?? []),

  followUps: (id: number): Promise<FollowUp[]> =>
    wait([
      {
        id: 1,
        scheduled_for: CASES.find((c) => c.case_id === id)?.next_follow_up ?? daysAhead(7),
        channel: 'VOICE',
        status: 'SCHEDULED',
        reason: 'Critical risk — next-day follow-up',
        source: 'PREDICTED',
        cadence_hours: 24,
        cadence_base_hours: 24,
        cadence_factors: CADENCE_FACTORS_CRITICAL,
        staff_note: null,
      },
      {
        id: 2,
        scheduled_for: daysAgo(2),
        channel: 'VOICE',
        status: 'COMPLETED',
        reason: 'High risk — early follow-up',
        source: 'PREDICTED',
        cadence_hours: 72,
        cadence_base_hours: 72,
        cadence_factors: CADENCE_FACTORS_ESCALATING,
        staff_note: null,
      },
      // A human-set time, so the UI has something to render differently from a
      // prediction: no cadence factors, a staff note, source COUNSELLOR.
      {
        id: 3,
        scheduled_for: daysAgo(9),
        channel: 'VOICE',
        status: 'COMPLETED',
        reason: 'Scheduled by counsellor',
        source: 'COUNSELLOR',
        cadence_hours: null,
        cadence_base_hours: null,
        cadence_factors: [],
        staff_note: 'Court date Thursday — call before',
      },
    ]),

  interactions: (id: number): Promise<InteractionSummary[]> => {
    const points = TELEMETRY[id] ?? []
    return wait(
      [...points].reverse().map((p, i) => ({
        interaction_id: id * 10 + (points.length - i),
        started_at: p.created_at,
        ended_at: p.created_at,
        channel: id === 1 ? 'TEXT' : 'VOICE',
        language: 'hi',
        status: 'COMPLETED',
        turn_count: 6,
      })),
    )
  },

  transcript: (interactionId: number): Promise<Transcript> =>
    wait({
      interaction_id: interactionId,
      case_id: 3,
      channel: 'VOICE',
      language: 'hi',
      started_at: daysAgo(2),
      ended_at: daysAgo(2),
      messages: [
        { seq: 1, role: 'VIORA', content: 'नमस्ते कविता। मुझे बताइए, इस हफ्ते कैसा रहा?', created_at: daysAgo(2) },
        { seq: 2, role: 'USER', content: 'कल रात कुछ लोग घर के बाहर आए थे। चिल्ला रहे थे।', created_at: daysAgo(2) },
        { seq: 3, role: 'VIORA', content: 'यह बहुत डरावना रहा होगा। उस वक्त आपके साथ कोई था?', created_at: daysAgo(2) },
        { seq: 4, role: 'USER', content: 'माँ थीं। पर हम कुछ कर नहीं सके।', created_at: daysAgo(2) },
        { seq: 5, role: 'VIORA', content: 'आप अभी घर पर खुद को सुरक्षित महसूस कर रही हैं?', created_at: daysAgo(2) },
        { seq: 6, role: 'USER', content: 'नहीं। अब घर पर भी डर लगता है।', created_at: daysAgo(2) },
      ],
    }),

  alerts: (): Promise<AlertListItem[]> => wait(ALERTS),
  acknowledgeAlert: (): Promise<void> => wait(undefined),

  dueFollowUps: (): Promise<DueFollowUp[]> =>
    wait([
      {
        follow_up_id: 1,
        case_id: 1,
        case_ref: 'VIORA-2026-0041',
        display_name: 'कविता देवी',
        uid: 'a7f3c1',
        preferred_language: 'hi',
        scheduled_for: daysAgo(1),
        days_overdue: 1,
        channel: 'VOICE',
        status: 'DUE',
        reason: 'Critical risk — next-day follow-up',
        current_risk: 'CRITICAL',
      },
      {
        follow_up_id: 2,
        case_id: 2,
        case_ref: 'VIORA-2026-0038',
        display_name: 'सुनीता कुमारी',
        uid: 'b2e9d4',
        preferred_language: 'hi',
        scheduled_for: new Date().toISOString(),
        days_overdue: 0,
        channel: 'TEXT',
        status: 'DUE',
        reason: 'High risk — early follow-up (escalating trajectory)',
        current_risk: 'HIGH',
      },
    ]),

  review: (_caseId: number, payload: ReviewRequest): Promise<ReviewResponse> =>
    wait({
      review_id: 1,
      outcome: payload.outcome,
      decided_at: new Date().toISOString(),
      intervention_id: payload.intervention_type ? 1 : null,
    }),
}
