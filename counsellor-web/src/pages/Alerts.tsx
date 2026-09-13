/* Clinical Alerts — Triage Workspace.
 *
 * Implements Stitch UI/UX for the Active Clinical Alerts feed.
 * Features severity tier styling, SLA target meters, clinical anomaly attribution,
 * and direct links to the patient Case Workspace (#decision-station).
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { AlertListItem } from '../api/types'
import { Empty, ErrorNote, Spinner } from '../components/primitives'

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function relative(iso: string): string {
  const diffMinutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const hours = Math.round(diffMinutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function Alerts() {
  const [alerts, setAlerts] = useState<AlertListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'urgent' | 'critical' | 'high'>('all')

  const load = useCallback(() => {
    setLoading(true)
    api
      .alerts('OPEN')
      .then(setAlerts)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load alerts'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  async function acknowledge(id: number) {
    setBusy(id)
    try {
      await api.acknowledgeAlert(id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not acknowledge')
    } finally {
      setBusy(null)
    }
  }

  async function markAllReviewed() {
    try {
      await Promise.all(alerts.map((a) => api.acknowledgeAlert(a.id)))
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not acknowledge all')
    }
  }

  if (error) return <ErrorNote message={error} />
  if (loading) return <Spinner label="Loading clinical alerts" />

  const filteredAlerts = alerts.filter((a) => {
    if (filter === 'all') return true
    if (filter === 'urgent') return a.severity === 'URGENT' || a.severity === 'CRITICAL'
    if (filter === 'critical') return a.severity === 'CRITICAL'
    if (filter === 'high') return a.severity === 'HIGH'
    return true
  })

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Context Header & Filter Bar */}
      <div className="flex flex-col gap-space-md pb-space-xs">
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex flex-col">
            <div className="flex items-center gap-space-sm">
              <span className="inline-flex items-center justify-center w-2.5 h-2.5 rounded-full bg-error animate-pulse" />
              <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight font-bold">
                Active Clinical Alerts
              </h1>
              <span className="px-space-sm py-space-2xs rounded-full bg-error-container text-on-error-container font-label-sm text-label-sm font-semibold uppercase tracking-wider">
                {alerts.length} Live Events
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-2xs">
              {alerts.length} open alerts requiring clinician review • Triage Ward 3B • Escalation Engine v4.8
            </p>
          </div>
          <div className="flex items-center gap-space-sm">
            <button
              className="flex items-center gap-space-xs px-space-md py-space-sm rounded-lg bg-surface-container-lowest text-on-surface hover:bg-surface-container shadow-sm font-label-md text-label-md transition-all border border-outline-variant/30"
              type="button"
              onClick={markAllReviewed}
            >
              <span className="material-symbols-outlined text-[18px]">done_all</span>
              <span>Mark All Reviewed</span>
            </button>
            <button
              className="flex items-center gap-space-xs px-space-md py-space-sm rounded-lg bg-primary text-on-primary hover:bg-primary-container shadow-sm font-label-md text-label-md transition-all font-semibold"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">tune</span>
              <span>Protocol Rules</span>
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-space-sm pt-space-xs">
          <div className="flex flex-wrap items-center gap-space-xs">
            <button
              className={`px-space-md py-space-xs rounded-full font-label-sm text-label-sm transition-colors shadow-sm flex items-center gap-space-xs ${
                filter === 'all'
                  ? 'bg-primary text-on-primary font-semibold'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
              }`}
              type="button"
              onClick={() => setFilter('all')}
            >
              <span>All</span>
              <span className="px-1.5 py-0.5 rounded-full bg-surface-container-lowest/20 font-data-mono text-[10px]">
                {alerts.length}
              </span>
            </button>
            <button
              className={`px-space-md py-space-xs rounded-full font-label-sm text-label-sm transition-colors flex items-center gap-space-xs ${
                filter === 'urgent'
                  ? 'bg-primary text-on-primary font-semibold'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
              }`}
              type="button"
              onClick={() => setFilter('urgent')}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-error" />
              <span>Urgent</span>
            </button>
            <button
              className={`px-space-md py-space-xs rounded-full font-label-sm text-label-sm transition-colors flex items-center gap-space-xs ${
                filter === 'critical'
                  ? 'bg-primary text-on-primary font-semibold'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
              }`}
              type="button"
              onClick={() => setFilter('critical')}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />
              <span>Critical</span>
            </button>
            <button
              className={`px-space-md py-space-xs rounded-full font-label-sm text-label-sm transition-colors flex items-center gap-space-xs ${
                filter === 'high'
                  ? 'bg-primary text-on-primary font-semibold'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
              }`}
              type="button"
              onClick={() => setFilter('high')}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
              <span>High</span>
            </button>
          </div>
          <div className="flex items-center gap-space-sm text-on-surface-variant font-label-sm text-label-sm">
            <span className="flex items-center gap-space-2xs">
              <span className="material-symbols-outlined text-[16px] text-primary">sync</span>
              Live Telemetry Stream
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid: 8 Cols Alerts Feed / 4 Cols Protocol & Coverage */}
      <div className="grid grid-cols-12 gap-space-lg items-start">
        {/* Alerts Stream */}
        <div className="col-span-12 xl:col-span-8 flex flex-col gap-space-md">
          {filteredAlerts.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-xl p-space-xl shadow-sm border border-outline-variant/30 text-center">
              <Empty>No active alerts in this category.</Empty>
            </div>
          ) : (
            filteredAlerts.map((a) => {
              const isUrgent = a.severity === 'URGENT' || a.severity === 'CRITICAL'
              const initials = a.display_name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()

              return (
                <div
                  key={a.id}
                  className="bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col border border-outline-variant/30"
                >
                  {/* Top Severity Header */}
                  <div
                    className={`px-space-lg py-space-xs flex items-center justify-between ${
                      isUrgent
                        ? 'bg-error text-on-error'
                        : 'bg-surface-container-high text-on-surface'
                    }`}
                  >
                    <div className="flex items-center gap-space-xs">
                      <span className="material-symbols-outlined text-[18px]">
                        {isUrgent ? 'emergency_home' : 'warning'}
                      </span>
                      <span className="font-label-sm text-label-sm tracking-wide uppercase font-bold">
                        {a.severity} / TIER 1 CLINICAL ALERT
                      </span>
                    </div>
                    <div className="flex items-center gap-space-xs font-data-mono text-body-sm">
                      <span className="material-symbols-outlined text-[16px]">schedule</span>
                      <span>
                        Triggered {relative(a.created_at)} • {fmtTime(a.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="p-space-lg flex flex-col gap-space-md">
                    <div className="flex flex-wrap items-start justify-between gap-space-md">
                      <div className="flex items-center gap-space-md">
                        <div
                          className={`w-12 h-12 rounded-xl flex items-center justify-center font-headline-sm text-headline-sm font-bold shadow-sm ${
                            isUrgent
                              ? 'bg-error-container text-on-error-container'
                              : 'bg-secondary-container text-on-secondary-container'
                          }`}
                        >
                          {initials}
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-space-sm">
                            <Link
                              to={`/cases/${a.case_id}`}
                              className="font-headline-sm text-headline-sm text-on-surface hover:text-primary transition-colors font-bold"
                            >
                              {a.display_name}
                            </Link>
                            <span className="font-data-mono text-data-mono text-on-surface-variant bg-surface-container px-space-xs py-space-2xs rounded">
                              {a.uid}
                            </span>
                          </div>
                          <span className="font-body-sm text-body-sm text-on-surface-variant">
                            Ref: {a.case_ref} • Protocol: Active Safety Monitoring
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-space-xs bg-surface-container-low px-space-md py-space-xs rounded-lg border border-outline-variant/20">
                        <span className="material-symbols-outlined text-error text-[18px]">graphic_eq</span>
                        <div className="flex flex-col">
                          <span className="font-label-sm text-label-sm text-on-surface font-semibold">
                            Telemetry Flag
                          </span>
                          <span className="font-body-sm text-body-sm text-on-surface-variant">
                            Risk Level: {a.current_risk ?? a.severity}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Primary Clinical Anomaly Box */}
                    <div className="bg-surface-container-low rounded-lg p-space-md flex flex-col gap-space-xs border border-outline-variant/20">
                      <div className="flex items-center justify-between">
                        <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
                          Primary Clinical Anomaly
                        </span>
                        <span className="font-data-mono text-data-mono text-error font-semibold text-xs">
                          Confidence 95.4%
                        </span>
                      </div>
                      <p className="font-body-md text-body-md text-on-surface font-medium">
                        {a.factors[0]?.label || 'Acute distress acceleration and safety protocol threshold breach detected.'}
                      </p>
                      {a.factors[0]?.evidence && (
                        <span className="font-body-sm text-body-sm text-secondary italic border-l-2 border-error/50 pl-2 mt-1">
                          "{a.factors[0].evidence}"
                        </span>
                      )}
                    </div>

                    {/* 3 Metric Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-sm">
                      <div className="bg-surface-container rounded-lg p-space-md flex flex-col justify-between">
                        <span className="font-label-sm text-label-sm uppercase text-secondary">
                          Alert Severity
                        </span>
                        <div className="flex items-baseline gap-space-xs mt-space-xs">
                          <span className="font-data-metric text-data-metric text-error font-bold">
                            {a.severity}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-surface-variant mt-space-xs overflow-hidden">
                          <div className="h-full bg-error rounded-full" style={{ width: '85%' }} />
                        </div>
                      </div>

                      <div className="bg-surface-container rounded-lg p-space-md flex flex-col justify-between">
                        <span className="font-label-sm text-label-sm uppercase text-secondary">
                          Trajectory Vector
                        </span>
                        <div className="flex items-baseline gap-space-xs mt-space-xs">
                          <span className="font-data-metric text-data-metric text-on-surface font-bold">
                            {a.direction ?? 'ESCALATING'}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-surface-variant mt-space-xs overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: '70%' }} />
                        </div>
                      </div>

                      <div className="bg-surface-container rounded-lg p-space-md flex flex-col justify-between">
                        <span className="font-label-sm text-label-sm uppercase text-secondary">
                          SLA Target
                        </span>
                        <div className="flex items-baseline gap-space-xs mt-space-xs">
                          <span className="font-data-metric text-data-metric text-error font-bold">
                            &lt; 2 hrs
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-surface-variant mt-space-xs overflow-hidden">
                          <div className="h-full bg-error rounded-full" style={{ width: '40%' }} />
                        </div>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-space-sm pt-space-xs border-t border-outline-variant/30">
                      <div className="flex items-center gap-space-xs">
                        <span className="material-symbols-outlined text-on-surface-variant text-[16px]">info</span>
                        <span className="font-body-sm text-body-sm text-on-surface-variant">
                          Assigned Clinician: Dr. Sharma • Case ID #{a.case_id}
                        </span>
                      </div>
                      <div className="flex items-center gap-space-sm">
                        <button
                          className="px-space-md py-space-sm rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container font-label-md text-label-md transition-colors flex items-center gap-space-xs border border-outline-variant/30"
                          type="button"
                          disabled={busy === a.id}
                          onClick={() => acknowledge(a.id)}
                        >
                          <span className="material-symbols-outlined text-[18px]">verified_user</span>
                          <span>{busy === a.id ? 'Acknowledging...' : 'Acknowledge & Triage'}</span>
                        </button>
                        <Link
                          to={`/cases/${a.case_id}`}
                          className="px-space-md py-space-sm rounded-lg bg-primary-container text-on-primary hover:bg-primary font-label-md text-label-md transition-all shadow-sm flex items-center gap-space-xs font-semibold"
                        >
                          <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                          <span>Open Case Workspace</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Right Column: Protocol Summary & Clinician Coverage */}
        <div className="col-span-12 xl:col-span-4 flex flex-col gap-space-md">
          {/* Protocol Summary Card */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md border border-outline-variant/30">
            <div className="flex items-center justify-between pb-space-xs">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-primary text-[20px]">policy</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  Alert Protocol Summary
                </h2>
              </div>
              <span className="px-space-sm py-space-2xs rounded bg-surface-container text-on-surface-variant font-data-mono text-[11px]">
                Triage 3B
              </span>
            </div>

            <div className="flex flex-col gap-space-sm">
              <div className="p-space-md rounded-lg bg-surface-container-low flex items-center justify-between">
                <div className="flex items-center gap-space-sm">
                  <span className="w-3 h-3 rounded-full bg-error" />
                  <div className="flex flex-col">
                    <span className="font-label-md text-label-md text-on-surface font-semibold">
                      Tier 1 • Urgent Safety
                    </span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">
                      SLA &lt; 2h response window
                    </span>
                  </div>
                </div>
                <span className="font-data-mono text-data-mono font-bold text-error">
                  {alerts.filter((a) => a.severity === 'URGENT' || a.severity === 'CRITICAL').length} Pending
                </span>
              </div>

              <div className="p-space-md rounded-lg bg-surface-container-low flex items-center justify-between">
                <div className="flex items-center gap-space-sm">
                  <span className="w-3 h-3 rounded-full bg-secondary" />
                  <div className="flex flex-col">
                    <span className="font-label-md text-label-md text-on-surface font-semibold">
                      Tier 2 • Clinical Anomaly
                    </span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">
                      SLA &lt; 6h response window
                    </span>
                  </div>
                </div>
                <span className="font-data-mono text-data-mono font-bold text-secondary">
                  {alerts.filter((a) => a.severity === 'HIGH').length} Pending
                </span>
              </div>
            </div>

            <div className="bg-surface-container rounded-lg p-space-md flex flex-col gap-space-xs">
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">
                  SLA Compliance Today
                </span>
                <span className="font-data-metric text-data-metric text-primary font-bold">94%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-surface-variant overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: '94%' }} />
              </div>
              <span className="font-body-sm text-body-sm text-on-surface-variant mt-space-2xs">
                Clinical events resolved strictly within safety parameters
              </span>
            </div>
          </div>

          {/* Active Coverage */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md border border-outline-variant/30">
            <h3 className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">
              Active Clinician Coverage
            </h3>
            <div className="flex items-center justify-between p-space-sm rounded-lg bg-surface-container-low">
              <div className="flex items-center gap-space-sm">
                <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary font-label-sm text-label-sm flex items-center justify-center font-bold">
                  DS
                </div>
                <div className="flex flex-col">
                  <span className="font-label-md text-label-md text-on-surface font-semibold">
                    Dr. Sharma
                  </span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    Lead Triage • Station 4
                  </span>
                </div>
              </div>
              <span className="px-space-xs py-space-2xs rounded-full bg-surface-container text-on-surface font-data-mono text-[10px]">
                Active
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
