
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CaseListItem, Direction, RiskLevel } from '../api/types'
import { DirectionTag, Empty, ErrorNote, RiskBadge, Spinner } from '../components/primitives'

const RISK_FILTERS: ('ALL' | RiskLevel)[] = ['ALL', 'CRITICAL', 'URGENT', 'HIGH', 'MODERATE', 'LOW']
const RISK_RANK: Record<RiskLevel, number> = {
  URGENT: 4,
  CRITICAL: 3,
  HIGH: 2,
  MODERATE: 1,
  LOW: 0,
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function Cases() {
  const [cases, setCases] = useState<CaseListItem[]>([])
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'ALL'>('ALL')
  const [trajectoryFilter, setTrajectoryFilter] = useState<Direction | 'ALL'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .cases()
      .then((c) => alive && setCases(c))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Could not load'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  if (error) return <ErrorNote message={error} />
  if (loading)
    return (
      <div className="flex justify-center p-space-2xl">
        <Spinner />
      </div>
    )

  // Quick stats
  const criticalCount = cases.filter(
    (c) => c.risk_level === 'CRITICAL' || c.risk_level === 'URGENT',
  ).length
  const escalatingCount = cases.filter((c) => c.direction === 'ESCALATING').length
  const highRiskCount = cases.filter((c) => c.risk_level === 'HIGH').length
  const stableCount = cases.filter(
    (c) =>
      c.direction === 'STABLE' ||
      c.direction === 'DE_ESCALATING' ||
      c.risk_level === 'LOW',
  ).length

  // Filter
  const q = searchQuery.toLowerCase()
  const filtered = cases.filter((c) => {
    if (riskFilter !== 'ALL' && c.risk_level !== riskFilter) return false
    if (trajectoryFilter !== 'ALL' && c.direction !== trajectoryFilter) return false
    if (q) {
      const matchesName = c.display_name.toLowerCase().includes(q)
      const matchesUid = c.uid.toLowerCase().includes(q)
      const matchesRef = (c.case_ref || '').toLowerCase().includes(q)
      const matchesStage = false
      if (!matchesName && !matchesUid && !matchesRef && !matchesStage) return false
    }
    return true
  }).sort((a, b) => RISK_RANK[b.risk_level ?? 'LOW'] - RISK_RANK[a.risk_level ?? 'LOW'])

  return (
    <div className="flex flex-col gap-space-lg">
      {/* Directory Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-space-md pb-space-sm border-b border-surface-container">
        <div>
          <div className="flex items-center gap-space-sm">
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">All Patient Cases</h1>
            <span className="px-3 py-0.5 rounded-full bg-surface-container-low text-primary font-data-mono text-body-sm font-semibold border border-surface-container">
              {cases.length} Monitored
            </span>
          </div>
          <p className="font-body-md text-body-md text-secondary mt-1">
            Active real-time longitudinal telemetry · Unit Ward 3B · Triage Protocol v4.2
          </p>
        </div>

        <div className="flex items-center gap-space-sm">
          <button className="flex items-center gap-space-xs px-space-md py-space-xs bg-surface-container-lowest text-secondary font-label-md text-label-md rounded-lg shadow-sm border border-surface-container hover:bg-surface-container transition-colors cursor-pointer" type="button" onClick={() => window.print()}>
            <span className="material-symbols-outlined text-[18px]">tune</span>
            <span>Configure View</span>
          </button>
          <button className="flex items-center gap-space-xs px-space-md py-space-xs bg-primary text-on-primary font-label-md text-label-md rounded-lg shadow-sm hover:bg-primary-hover transition-colors cursor-pointer" type="button">
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            <span>New Case Referral</span>
          </button>
        </div>
      </div>

      {/* Triage Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        
        {/* 1. Critical & Severe */}
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container flex flex-col justify-between group">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Critical & Severe</span>
              <div className="flex items-baseline gap-space-xs mt-space-2xs">
                <span className="font-data-metric text-data-metric text-error">{criticalCount}</span>
                <span className="font-label-sm text-label-sm text-secondary font-medium">/ {cases.length} active</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-error-container/40 flex items-center justify-center text-error">
              <span className="material-symbols-outlined text-[22px]">warning</span>
            </div>
          </div>
        </div>

        {/* 2. Deteriorating / Escalating */}
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container flex flex-col justify-between group">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Deteriorating Trajectory</span>
              <div className="flex items-baseline gap-space-xs mt-space-2xs">
                <span className="font-data-metric text-data-metric text-primary">{escalatingCount}</span>
                <span className="font-label-sm text-label-sm text-error font-semibold">↑ active shift</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-[22px]">trending_up</span>
            </div>
          </div>
        </div>

        {/* 3. High Risk Tier */}
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container flex flex-col justify-between group">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">High Risk Tier</span>
              <div className="flex items-baseline gap-space-xs mt-space-2xs">
                <span className="font-data-metric text-data-metric text-on-surface">{highRiskCount}</span>
                <span className="font-label-sm text-label-sm text-secondary font-medium">requires check-in</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center text-on-surface-variant">
              <span className="material-symbols-outlined text-[22px]">emergency_home</span>
            </div>
          </div>
        </div>

        {/* 4. Settled / Improving */}
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container flex flex-col justify-between group">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Settled / Improving</span>
              <div className="flex items-baseline gap-space-xs mt-space-2xs">
                <span className="font-data-metric text-data-metric text-risk-low">{stableCount}</span>
                <span className="font-label-sm text-label-sm text-secondary font-medium">ready for cadence</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-risk-low-tint flex items-center justify-center text-risk-low">
              <span className="material-symbols-outlined text-[22px]">check_circle</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Search & Filter Bar */}
      <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container flex flex-wrap items-center justify-between gap-space-md">
        <div className="relative w-full max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">search</span>
          <input
            type="text"
            placeholder="Filter by patient name, UID, condition..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-surface-container bg-surface-container-low text-on-surface text-sm focus:outline-none focus:border-primary focus:bg-surface transition-colors"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-space-md flex-wrap">
          <div className="flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider mr-2">Risk:</span>
            {RISK_FILTERS.map((f) => {
              const active = riskFilter === f
              return (
                <button
                  key={f}
                  onClick={() => setRiskFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${active ? 'bg-primary text-on-primary' : 'bg-surface-container text-secondary hover:bg-surface-container-low'}`}
                >
                  {f === 'ALL' ? 'All' : f}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider mx-2">Vector:</span>
            {(['ALL', 'ESCALATING', 'STABLE', 'DE_ESCALATING'] as const).map((t) => {
              const active = trajectoryFilter === t
              return (
                <button
                  key={t}
                  onClick={() => setTrajectoryFilter(t)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${active ? 'bg-primary text-on-primary' : 'bg-surface-container text-secondary hover:bg-surface-container-low'}`}
                >
                  {t === 'ALL' ? 'All' : t.replace('_', '-')}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Directory Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-space-2xl text-center">
            <Empty>No patient cases match your active filters.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-body-sm text-body-sm">
              <thead>
                <tr className="bg-surface-container-lowest text-secondary font-label-sm text-label-sm uppercase tracking-wider border-b border-surface-container">
                  <th className="py-space-sm px-space-lg">Patient & UID</th>
                  <th className="py-space-sm px-space-md">Clinical Status</th>
                  <th className="py-space-sm px-space-md">Trajectory</th>
                  <th className="py-space-sm px-space-md">Threat</th>
                  <th className="py-space-sm px-space-md">Distress</th>
                  <th className="py-space-sm px-space-md">Last Telemetry</th>
                  <th className="py-space-sm px-space-md">Next Follow-up</th>
                  <th className="py-space-sm px-space-lg text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {filtered.map((c) => {
                  const initials = c.display_name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
                  const distressVal = c.distress_score ?? 0
                  const threatVal = c.threat_score ?? 0
                  return (
                    <tr key={c.case_id} className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="py-space-md px-space-lg">
                        <div className="flex items-center gap-space-sm">
                          <div className="w-9 h-9 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-headline-sm text-body-sm font-semibold shrink-0">
                            {initials}
                          </div>
                          <div>
                            <Link to={`/cases/${c.case_id}`} className="font-label-md text-label-md text-on-surface font-semibold hover:text-primary hover:underline flex items-center gap-1.5">
                              {c.display_name}
                            </Link>
                            <span className="font-data-mono text-body-sm text-secondary block mt-0.5">
                              {c.uid} · {c.case_ref ?? 'Ward 3B'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-space-md px-space-md whitespace-nowrap">
                        <RiskBadge level={c.risk_level} size="sm" />
                      </td>
                      <td className="py-space-md px-space-md whitespace-nowrap">
                        <DirectionTag direction={c.direction} size="sm" />
                      </td>
                      <td className="py-space-md px-space-md">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-surface-container overflow-hidden">
                            <div className="h-full bg-error" style={{ width: `${Math.min(100, Math.max(0, threatVal))}%` }}></div>
                          </div>
                          <span className="font-data-mono text-body-sm font-semibold text-on-surface">{c.threat_score !== null ? c.threat_score.toFixed(0) : '—'}</span>
                        </div>
                      </td>
                      <td className="py-space-md px-space-md">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-surface-container overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, distressVal))}%` }}></div>
                          </div>
                          <span className="font-data-mono text-body-sm font-semibold text-on-surface">{c.distress_score !== null ? c.distress_score.toFixed(0) : '—'}</span>
                        </div>
                      </td>
                      <td className="py-space-md px-space-md whitespace-nowrap text-secondary">
                        {fmt(c.last_check_in)}
                      </td>
                      <td className="py-space-md px-space-md whitespace-nowrap text-secondary">
                        {fmt(c.next_follow_up)}
                      </td>
                      <td className="py-space-md px-space-lg text-right whitespace-nowrap">
                        <Link
                          to={`/cases/${c.case_id}`}
                          className="inline-flex items-center gap-1 px-space-sm py-1 rounded-lg border border-line text-primary font-label-md text-label-md hover:bg-surface-container-low transition-colors shadow-sm"
                        >
                          <span>Dossier</span>
                          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
