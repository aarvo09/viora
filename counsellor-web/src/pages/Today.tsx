
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CaseListItem, DashboardSummary, DueFollowUp, RiskLevel, TelemetryPoint } from '../api/types'
import {
  DirectionTag,
  Empty,
  ErrorNote,
  RiskBadge,
  Spinner,
} from '../components/primitives'
import { TrajectoryQuadrant } from '../components/TrajectoryQuadrant'

const RISK_RANK: Record<RiskLevel, number> = {
  URGENT: 4,
  CRITICAL: 3,
  HIGH: 2,
  MODERATE: 1,
  LOW: 0,
}

function relative(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 864e5)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 0) return `in ${Math.abs(days)}d`
  return `${days}d ago`
}

function due(iso: string | null): { text: string; urgent: boolean } {
  if (!iso) return { text: '—', urgent: false }
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 864e5)
  if (days < 0) return { text: `overdue ${Math.abs(days)}d`, urgent: true }
  if (days === 0) return { text: 'Today', urgent: true }
  if (days === 1) return { text: 'Tomorrow', urgent: false }
  return { text: `in ${days}d`, urgent: false }
}

export function Today() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [cases, setCases] = useState<CaseListItem[]>([])
  const [dueFollowUps, setDueFollowUps] = useState<DueFollowUp[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'HIGH' | 'ESCALATING' | 'FOLLOWUP'>('ALL')

  useEffect(() => {
    let alive = true
    Promise.all([api.dashboard(), api.cases()])
      .then(([d, c]) => {
        if (!alive) return
        setSummary(d)
        setCases(c)
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Could not load'))

    api
      .dueFollowUps()
      .then((rows) => alive && setDueFollowUps(rows))
      .catch(() => {})

    return () => {
      alive = false
    }
  }, [])

  if (error) return <ErrorNote message={error} />
  if (!summary) return <div className="p-space-2xl flex justify-center"><Spinner /></div>

  const ranked = [...cases].sort(
    (a, b) => RISK_RANK[b.risk_level ?? 'LOW'] - RISK_RANK[a.risk_level ?? 'LOW'],
  )

  const highRiskCases = ranked.filter((c) => RISK_RANK[c.risk_level ?? 'LOW'] >= 2)
  const escalatingCases = ranked.filter((c) => c.direction === 'ESCALATING')
  const followupCases = ranked.filter((c) => due(c.next_follow_up).urgent)

  let filteredCases = ranked
  if (activeFilter === 'HIGH') filteredCases = highRiskCases
  else if (activeFilter === 'ESCALATING') filteredCases = escalatingCases
  else if (activeFilter === 'FOLLOWUP') filteredCases = followupCases

  const todayDateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })

  const samplePoints: TelemetryPoint[] = ranked
    .filter((c) => c.distress_score !== null && c.threat_score !== null)
    .slice(0, 5)
    .map((c, i) => ({
      report_version: i + 1,
      created_at: c.last_check_in ?? new Date().toISOString(),
      distress_score: c.distress_score ?? 0,
      threat_score: c.threat_score ?? 0,
      composite_score: ((c.distress_score ?? 0) + (c.threat_score ?? 0)) / 2,
      baseline_score: 40,
      risk_level: c.risk_level ?? ('LOW' as RiskLevel),
      direction: c.direction ?? null,
    }))

  return (
    <div className="flex flex-col w-full">
      {/* Page Header Zone */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-space-md py-space-lg mb-space-xs">
        <div className="flex flex-col">
          <div className="flex items-center gap-space-sm mb-space-2xs">
            <span className="inline-flex items-center px-space-sm py-0.5 rounded-full bg-surface-container font-label-sm text-label-sm text-secondary tracking-wide uppercase">
              Triage Unit · Ward 3B
            </span>
            <span className="w-1 h-1 rounded-full bg-outline-variant"></span>
            <span className="font-label-sm text-label-sm text-secondary flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              Live Ingestion Continuous
            </span>
          </div>
          <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">
            Good morning, Dr. Sharma
          </h1>
          <p className="font-body-md text-body-md text-secondary mt-1">
            Here's what needs your clinical attention today across <span className="font-semibold text-on-surface">{cases.length} monitored patients</span>.
          </p>
        </div>
        
        {/* Header Controls */}
        <div className="flex flex-wrap items-center gap-space-sm">
          <div className="flex items-center gap-space-xs px-space-md py-space-xs bg-surface-container-low rounded-lg font-label-md text-label-md text-secondary border border-surface-container">
            <span className="material-symbols-outlined text-[18px]">calendar_today</span>
            <span>{todayDateStr}</span>
          </div>
          <button onClick={() => window.print()} className="flex items-center gap-space-xs px-space-md py-space-xs bg-surface-container-lowest text-primary font-label-md text-label-md rounded-lg shadow-sm border border-surface-container hover:bg-surface-container-low transition-colors cursor-pointer" type="button">
            <span className="material-symbols-outlined text-[18px]">ios_share</span>
            <span>Export Shift Summary</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: Top-Level Overview Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md mb-space-lg">
        
        {/* 1. High Risk Cases */}
        <div className="relative bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container flex flex-col justify-between overflow-hidden group hover:shadow transition-shadow">
          <div className="flex items-start justify-between mb-space-sm">
            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">High Risk Cases</span>
              <div className="flex items-baseline gap-space-xs mt-space-2xs">
                <span className="font-data-metric text-data-metric text-on-surface">{highRiskCases.length}</span>
                <span className="font-label-sm text-label-sm text-error font-medium">Critical Tier</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-error-container/40 flex items-center justify-center text-error transition-transform group-hover:scale-110">
              <span className="material-symbols-outlined text-[22px]">warning</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-space-xs mt-space-xs border-t border-surface-container">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-error-container/30 text-on-error-container">
              <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping"></span>
              <span className="font-label-sm text-label-sm font-semibold">Needs review</span>
            </div>
            <span className="font-body-sm text-body-sm text-secondary truncate">Priority triage</span>
          </div>
        </div>

        {/* 2. Pending Follow-ups */}
        <div className="relative bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container flex flex-col justify-between overflow-hidden group hover:shadow transition-shadow">
          <div className="flex items-start justify-between mb-space-sm">
            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Pending Follow-ups</span>
              <div className="flex items-baseline gap-space-xs mt-space-2xs">
                <span className="font-data-metric text-data-metric text-on-surface">{summary.follow_ups_due}</span>
                <span className="font-label-sm text-label-sm text-secondary font-normal">Due Today</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-secondary transition-transform group-hover:scale-110">
              <span className="material-symbols-outlined text-[22px]">pending_actions</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-space-xs mt-space-xs border-t border-surface-container">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-container text-on-secondary-container">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
              <span className="font-label-sm text-label-sm font-semibold">Scheduled</span>
            </div>
            <span className="font-body-sm text-body-sm text-secondary truncate">{dueFollowUps.length} queued</span>
          </div>
        </div>

        {/* 3. Active Users */}
        <div className="relative bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container flex flex-col justify-between overflow-hidden group hover:shadow transition-shadow">
          <div className="flex items-start justify-between mb-space-sm">
            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Active Users</span>
              <div className="flex items-baseline gap-space-xs mt-space-2xs">
                <span className="font-data-metric text-data-metric text-on-surface">{summary.active_cases}</span>
                <span className="font-label-sm text-label-sm text-primary font-medium">Ward total</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-primary-fixed flex items-center justify-center text-primary transition-transform group-hover:scale-110">
              <span className="material-symbols-outlined text-[22px]">group</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-space-xs mt-space-xs border-t border-surface-container">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-fixed">
              <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
              <span className="font-label-sm text-label-sm font-semibold">Supported</span>
            </div>
            <span className="font-body-sm text-body-sm text-secondary truncate">Active telemetry</span>
          </div>
        </div>

        {/* 4. Open Alerts */}
        <div className="relative bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container flex flex-col justify-between overflow-hidden group hover:shadow transition-shadow">
          <div className="flex items-start justify-between mb-space-sm">
            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Open Alerts</span>
              <div className="flex items-baseline gap-space-xs mt-space-2xs">
                <span className="font-data-metric text-data-metric text-on-surface">{summary.open_alerts}</span>
                <span className={`font-label-sm text-label-sm ${summary.open_alerts > 0 ? 'text-error' : 'text-primary'} font-medium`}>
                  {summary.open_alerts > 0 ? 'Unresolved' : 'All clear'}
                </span>
              </div>
            </div>
            <div className={`w-10 h-10 rounded-lg ${summary.open_alerts > 0 ? 'bg-error-container/40 text-error' : 'bg-surface-container text-secondary'} flex items-center justify-center transition-transform group-hover:scale-110`}>
              <span className="material-symbols-outlined text-[22px]">shield</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-space-xs mt-space-xs border-t border-surface-container">
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${summary.open_alerts > 0 ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-secondary'}`}>
              {summary.open_alerts > 0 && <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping"></span>}
              <span className="font-label-sm text-label-sm font-semibold">{summary.open_alerts > 0 ? 'Action required' : 'No active crises'}</span>
            </div>
            <Link to="/alerts" className="font-body-sm text-body-sm text-primary hover:text-tertiary transition-colors truncate">View all →</Link>
          </div>
        </div>

      </section>

      {/* SECTION 2: Two-column Main Working Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        
        {/* LEFT COLUMN: Cols 1-8 */}
        <div className="lg:col-span-8 flex flex-col gap-space-lg">
          
          {/* Priority Cases Workstation */}
          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container overflow-hidden">
            <div className="p-space-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-space-sm border-b border-surface-container">
              <div>
                <div className="flex items-center gap-space-xs">
                  <h2 className="font-headline-lg text-headline-lg text-on-surface">Priority Cases</h2>
                  <span className="px-2 py-0.5 rounded-full bg-surface-container font-data-mono text-body-sm text-secondary font-medium">{filteredCases.length} Active</span>
                </div>
                <p className="font-body-sm text-body-sm text-secondary mt-1">Ranked by urgency, telemetry trend, and clinical need</p>
              </div>
              <Link to="/cases" className="inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:text-tertiary transition-colors">
                <span>View All Cases ({cases.length})</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </Link>
            </div>

            <div className="px-space-lg py-space-md flex flex-wrap items-center gap-space-xs border-b border-surface-container bg-surface-container-low/30">
              {[
                { id: 'ALL', label: `All (${cases.length})` },
                { id: 'HIGH', label: `High Risk (${highRiskCases.length})`, dot: 'bg-error' },
                { id: 'ESCALATING', label: `Escalating (${escalatingCases.length})`, dot: 'bg-primary' },
                { id: 'FOLLOWUP', label: `Requires Follow-up (${followupCases.length})` },
              ].map(tab => {
                const active = activeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveFilter(tab.id as typeof activeFilter)}
                    className={`px-space-md py-1 rounded-full font-label-sm text-label-sm shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer ${active ? 'bg-primary text-on-primary' : 'bg-surface-container text-secondary hover:bg-surface-container-low'}`}
                  >
                    {tab.dot && <span className={`w-1.5 h-1.5 rounded-full ${tab.dot}`}></span>}
                    {tab.label}
                  </button>
                )
              })}
            </div>

            <div className="overflow-x-auto">
              {filteredCases.length === 0 ? (
                <div className="p-space-2xl text-center"><Empty>No cases matching this filter.</Empty></div>
              ) : (
                <table className="w-full text-left font-body-sm text-body-sm">
                  <thead>
                    <tr className="bg-surface-container-lowest text-secondary font-label-sm text-label-sm uppercase tracking-wider border-b border-surface-container">
                      <th className="py-space-sm px-space-lg" scope="col">Patient & UID</th>
                      <th className="py-space-sm px-space-md" scope="col">Risk Level</th>
                      <th className="py-space-sm px-space-md" scope="col">Trend</th>
                      <th className="py-space-sm px-space-md" scope="col">Last Check-in</th>
                      <th className="py-space-sm px-space-md" scope="col">Follow-up</th>
                      <th className="py-space-sm px-space-lg text-right" scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container">
                    {filteredCases.map(c => {
                      const followUp = due(c.next_follow_up)
                      const initials = c.display_name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
                      return (
                        <tr key={c.case_id} className="bg-surface-container-lowest hover:bg-surface-container-low/50 transition-colors">
                          <td className="py-space-md px-space-lg">
                            <div className="flex items-center gap-space-sm">
                              <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-headline-sm text-body-sm font-semibold">
                                {initials}
                              </div>
                              <div>
                                <div className="font-label-md text-label-md text-on-surface font-semibold flex items-center gap-1.5">
                                  <span>{c.display_name}</span>
                                  <span className="font-data-mono text-body-sm font-normal text-secondary">#{c.uid}</span>
                                </div>
                                <span className="font-body-sm text-body-sm text-secondary">{c.case_ref || 'General Triage'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-space-md px-space-md whitespace-nowrap">
                            <RiskBadge level={c.risk_level} size="sm" />
                          </td>
                          <td className="py-space-md px-space-md whitespace-nowrap">
                            <DirectionTag direction={c.direction} size="sm" />
                          </td>
                          <td className="py-space-md px-space-md whitespace-nowrap text-secondary">
                            <div className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[16px] text-secondary">history</span>
                              <span>{relative(c.last_check_in)}</span>
                            </div>
                          </td>
                          <td className="py-space-md px-space-md whitespace-nowrap">
                            <span className={`font-label-md text-label-md ${followUp.urgent ? 'text-error font-semibold' : 'text-secondary'}`}>
                              {followUp.text}
                            </span>
                          </td>
                          <td className="py-space-md px-space-lg text-right whitespace-nowrap">
                            <Link to={`/cases/${c.case_id}`} className="inline-flex items-center gap-1 px-space-sm py-1 rounded-lg border border-line text-primary font-label-md text-label-md hover:bg-surface-container-low transition-colors shadow-sm">
                              <span>Review</span>
                              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Recent System Activity */}
          {summary.recent_activity.length > 0 && (
            <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-surface-container">
              <div className="flex items-center justify-between mb-space-md border-b border-surface-container pb-space-sm">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-primary text-[20px]">history</span>
                  <h3 className="font-headline-sm text-headline-sm text-on-surface">Live Unit Audit & Intake Log</h3>
                </div>
              </div>
              <div className="relative pl-6 space-y-space-md before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-surface-container">
                {summary.recent_activity.slice(0, 5).map((a, i) => (
                  <div key={i} className="relative flex items-start justify-between gap-space-md">
                    <span className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-primary ring-4 ring-surface-container-lowest"></span>
                    <div>
                      <p className="font-label-md text-label-md text-on-surface">
                        Activity logged for <Link to={`/cases/${a.case_id}`} className="font-semibold text-primary hover:underline">{a.display_name}</Link>
                      </p>
                      <p className="font-body-sm text-body-sm text-secondary">{a.detail}</p>
                    </div>
                    <span className="font-data-mono text-body-sm text-secondary whitespace-nowrap">{relative(a.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Cols 9-12 */}
        <div className="lg:col-span-4 flex flex-col gap-space-lg">
          
          {/* Cohort Trajectory Quadrant */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-surface-container">
            <div className="flex items-center justify-between mb-space-sm">
              <div className="flex items-center gap-space-xs">
                <div className="w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-[18px]">explore</span>
                </div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">Trajectory Quadrant</h3>
              </div>
            </div>
            <p className="font-body-sm text-body-sm text-secondary mb-space-md">
              Dual-Axis Distress vs Threat Model across priority cohort.
            </p>
            <div className="flex justify-center bg-surface-container-lowest p-space-sm rounded-lg border border-surface-container">
              <TrajectoryQuadrant points={samplePoints} />
            </div>
          </div>

          {/* Today's Tasks & Clinical Work Queue */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-surface-container">
            <div className="flex items-center justify-between mb-space-sm">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">Today's Tasks</h3>
                <span className="font-body-sm text-body-sm text-secondary">{dueFollowUps.length} Pending Outreach</span>
              </div>
              <span className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-secondary">
                <span className="material-symbols-outlined text-[20px]">checklist</span>
              </span>
            </div>
            
            {dueFollowUps.length === 0 ? (
              <div className="p-space-lg text-center"><Empty>All caught up!</Empty></div>
            ) : (
              <div className="space-y-space-sm mt-space-md">
                {dueFollowUps.map(f => (
                  <Link to={`/cases/${f.case_id}`} key={f.follow_up_id} className="flex items-start gap-space-sm p-space-sm rounded-lg hover:bg-surface-container-low transition-colors group cursor-pointer text-on-surface" style={{textDecoration: 'none'}}>
                    <div className="mt-1 w-4 h-4 rounded border border-outline group-hover:border-primary transition-colors flex-shrink-0"></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${f.days_overdue > 0 ? 'bg-error' : 'bg-primary'} shrink-0`}></span>
                        <span className="font-label-md text-label-md group-hover:text-primary transition-colors">
                          {f.reason}
                        </span>
                      </div>
                      <p className="font-body-sm text-body-sm text-secondary truncate">
                        Patient: {f.display_name}
                      </p>
                      <div className={`flex items-center gap-1 mt-1 font-label-sm text-label-sm ${f.days_overdue > 0 ? 'text-error' : 'text-secondary'}`}>
                        <span className="material-symbols-outlined text-[14px]">schedule</span>
                        <span>{f.days_overdue > 0 ? `+${f.days_overdue}d overdue` : 'Due Today'}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
