/* Clinical Follow-ups & Cadence Page.
 *
 * Implements Stitch UI/UX for the Clinician Touchpoints and Scheduled Outreach queue.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { DueFollowUp } from '../api/types'
import { Empty, RiskBadge, Spinner } from '../components/primitives'

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function FollowUps() {
  const [followUps, setFollowUps] = useState<DueFollowUp[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'due' | 'scheduled'>('all')

  useEffect(() => {
    api
      .dueFollowUps()
      .then(setFollowUps)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner label="Loading follow-up queue" />

  const filtered = followUps.filter((f) => {
    if (filter === 'due') return f.status === 'DUE' || f.days_overdue > 0
    if (filter === 'scheduled') return f.status === 'SCHEDULED'
    return true
  })

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md pt-space-xs">
        <div>
          <div className="flex items-center gap-space-xs mb-space-2xs">
            <span className="font-data-mono text-data-mono text-primary font-semibold uppercase tracking-wider">
              VIORA Cadence Engine v4.2
            </span>
            <span className="text-outline-variant">•</span>
            <span className="inline-flex items-center gap-1 font-data-mono text-data-mono text-error font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse" />
              {followUps.filter((f) => f.days_overdue > 0).length} Overdue Touchpoints
            </span>
          </div>
          <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight font-bold">
            Clinical Follow-ups &amp; Cadence
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-0.5">
            {followUps.length} pending clinician touchpoints · Automated dynamic cadence
          </p>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
        <div className="p-space-md rounded-xl bg-surface-container-lowest shadow-sm flex items-start justify-between border border-outline-variant/30">
          <div>
            <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
              Total Touchpoints
            </span>
            <div className="flex items-baseline gap-space-xs mt-space-2xs">
              <span className="font-data-metric text-data-metric text-on-surface font-bold">
                {followUps.length}
              </span>
            </div>
            <span className="font-body-sm text-body-sm text-on-surface-variant mt-1 block">
              Active patient cohort queue
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <span className="material-symbols-outlined text-[20px]">calendar_today</span>
          </div>
        </div>

        <div className="p-space-md rounded-xl bg-surface-container-lowest shadow-sm flex items-start justify-between border border-outline-variant/30">
          <div>
            <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
              Due / Urgent
            </span>
            <div className="flex items-baseline gap-space-xs mt-space-2xs">
              <span className="font-data-metric text-data-metric text-error font-bold">
                {followUps.filter((f) => f.days_overdue > 0 || f.status === 'DUE').length}
              </span>
            </div>
            <span className="font-body-sm text-body-sm text-error mt-1 block font-medium">
              Requires immediate outreach
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-error/10 flex items-center justify-center text-error">
            <span className="material-symbols-outlined text-[20px]">priority_high</span>
          </div>
        </div>

        <div className="p-space-md rounded-xl bg-surface-container-lowest shadow-sm flex items-start justify-between border border-outline-variant/30">
          <div>
            <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
              Cadence Adherence
            </span>
            <div className="flex items-baseline gap-space-xs mt-space-2xs">
              <span className="font-data-metric text-data-metric text-primary font-bold">
                96.4%
              </span>
            </div>
            <span className="font-body-sm text-body-sm text-on-surface-variant mt-1 block">
              Within therapeutic window
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <span className="material-symbols-outlined text-[20px]">verified</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-space-xs bg-surface-container-lowest p-space-xs rounded-xl shadow-sm border border-outline-variant/30 w-fit">
        <button
          type="button"
          className={`px-space-md py-1.5 rounded-lg font-label-md text-label-md transition-colors ${
            filter === 'all'
              ? 'bg-primary-container text-on-primary font-semibold shadow-sm'
              : 'text-on-surface-variant hover:bg-surface-container'
          }`}
          onClick={() => setFilter('all')}
        >
          All ({followUps.length})
        </button>
        <button
          type="button"
          className={`px-space-md py-1.5 rounded-lg font-label-md text-label-md transition-colors ${
            filter === 'due'
              ? 'bg-primary-container text-on-primary font-semibold shadow-sm'
              : 'text-on-surface-variant hover:bg-surface-container'
          }`}
          onClick={() => setFilter('due')}
        >
          Due / Overdue
        </button>
        <button
          type="button"
          className={`px-space-md py-1.5 rounded-lg font-label-md text-label-md transition-colors ${
            filter === 'scheduled'
              ? 'bg-primary-container text-on-primary font-semibold shadow-sm'
              : 'text-on-surface-variant hover:bg-surface-container'
          }`}
          onClick={() => setFilter('scheduled')}
        >
          Scheduled Future
        </button>
      </div>

      {/* Queue Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/30 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-space-xl text-center">
            <Empty>No touchpoints in this category.</Empty>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/60 border-b border-outline-variant/30 text-secondary font-label-sm text-label-sm uppercase">
                <th className="py-space-md px-space-lg">Patient</th>
                <th className="py-space-md px-space-md">Scheduled For</th>
                <th className="py-space-md px-space-md">Channel</th>
                <th className="py-space-md px-space-md">Risk</th>
                <th className="py-space-md px-space-md">Reason &amp; Clinical Context</th>
                <th className="py-space-md px-space-lg text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20 font-body-sm text-body-sm">
              {filtered.map((f) => (
                <tr key={f.follow_up_id} className="hover:bg-surface-container-low/40 transition-colors">
                  <td className="py-space-md px-space-lg">
                    <div className="flex flex-col">
                      <Link
                        to={`/cases/${f.case_id}`}
                        className="font-headline-sm text-sm font-bold text-on-surface hover:text-primary transition-colors"
                      >
                        {f.display_name}
                      </Link>
                      <span className="font-data-mono text-xs text-secondary">{f.uid}</span>
                    </div>
                  </td>
                  <td className="py-space-md px-space-md">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-primary">schedule</span>
                      <span className="font-semibold text-on-surface">{fmtDateTime(f.scheduled_for)}</span>
                    </div>
                    {f.days_overdue > 0 && (
                      <span className="text-error text-xs font-semibold block mt-0.5">
                        {f.days_overdue}d overdue
                      </span>
                    )}
                  </td>
                  <td className="py-space-md px-space-md">
                    <span className="px-2 py-0.5 rounded-full bg-surface-container text-secondary font-label-sm text-xs font-semibold">
                      {f.channel}
                    </span>
                  </td>
                  <td className="py-space-md px-space-md">
                    <RiskBadge level={f.current_risk} size="sm" />
                  </td>
                  <td className="py-space-md px-space-md max-w-xs">
                    <span className="text-on-surface-variant truncate block">{f.reason}</span>
                  </td>
                  <td className="py-space-md px-space-lg text-right">
                    <Link
                      to={`/cases/${f.case_id}`}
                      className="px-space-md py-1 rounded-lg bg-primary-container text-on-primary font-label-sm text-label-sm hover:bg-primary transition-colors inline-flex items-center gap-1 font-semibold"
                    >
                      <span>Review</span>
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
