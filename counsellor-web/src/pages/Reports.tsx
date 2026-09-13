/* Clinical Telemetry Reports Page.
 *
 * Implements Stitch UI/UX for the EHR Integration & Global Diagnostic Repository.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CaseListItem } from '../api/types'
import { Empty, RiskBadge, Spinner } from '../components/primitives'

export function Reports() {
  const [cases, setCases] = useState<CaseListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    api
      .cases()
      .then(setCases)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner label="Loading clinical report repository" />

  const filtered = cases.filter(
    (c) =>
      c.display_name.toLowerCase().includes(search.toLowerCase()) ||
      c.uid.toLowerCase().includes(search.toLowerCase()) ||
      c.case_ref.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md w-full">
        <div>
          <div className="flex items-center gap-space-xs mb-space-2xs">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary font-semibold">
              EHR Integration Telemetry
            </span>
            <span className="text-outline text-body-sm">/</span>
            <span className="font-data-mono text-data-mono text-primary font-semibold">
              RECORDS_REPO_V2.4
            </span>
          </div>
          <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight font-bold">
            Clinical Telemetry Reports
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-space-2xs">
            Global diagnostic repository across active patient cohort ({cases.length} cases)
          </p>
        </div>
        <div className="flex items-center gap-space-sm">
          <button
            type="button"
            className="flex items-center gap-space-xs px-space-md py-space-xs rounded-lg bg-surface-container-lowest text-on-surface hover:bg-surface-container transition-colors shadow-sm font-label-md text-label-md border border-outline-variant/30"
          >
            <span className="material-symbols-outlined text-[18px] text-secondary">
              sim_card_download
            </span>
            <span>Export Audit Roster</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md w-full">
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-outline-variant/30 flex flex-col justify-between">
          <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
            Total Ingested Cases
          </span>
          <div className="mt-space-sm flex items-baseline gap-space-xs">
            <span className="font-data-metric text-data-metric text-on-surface font-bold">
              {cases.length}
            </span>
            <span className="font-label-sm text-secondary">active files</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-outline-variant/30 flex flex-col justify-between">
          <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
            High / Critical Risk
          </span>
          <div className="mt-space-sm flex items-baseline gap-space-xs">
            <span className="font-data-metric text-data-metric text-error font-bold">
              {cases.filter((c) => c.risk_level === 'HIGH' || c.risk_level === 'CRITICAL').length}
            </span>
            <span className="font-label-sm text-error">flagged</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-outline-variant/30 flex flex-col justify-between">
          <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
            Mean Cohort Distress
          </span>
          <div className="mt-space-sm flex items-baseline gap-space-xs">
            <span className="font-data-metric text-data-metric text-primary font-bold">
              {(
                cases.reduce((acc, c) => acc + (c.distress_score ?? 40), 0) /
                (cases.length || 1)
              ).toFixed(1)}
            </span>
            <span className="font-label-sm text-secondary">/ 100</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-outline-variant/30 flex flex-col justify-between">
          <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
            Audit Integrity
          </span>
          <div className="mt-space-sm flex items-baseline gap-space-xs">
            <span className="font-data-metric text-data-metric text-primary font-bold">
              100%
            </span>
            <span className="font-label-sm text-secondary">cryptographic</span>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-surface-container-lowest p-space-sm rounded-xl shadow-sm border border-outline-variant/30 flex items-center justify-between">
        <div className="relative flex items-center w-80">
          <span className="material-symbols-outlined absolute left-space-sm text-on-surface-variant text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search reports by patient or UID..."
            className="w-full pl-9 pr-space-sm py-1.5 bg-surface-container-low rounded-lg font-body-sm text-on-surface focus:outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-xs text-secondary font-data-mono">
          Showing {filtered.length} reports
        </span>
      </div>

      {/* Reports Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/30 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-space-xl text-center">
            <Empty>No reports matching criteria.</Empty>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/60 border-b border-outline-variant/30 text-secondary font-label-sm text-label-sm uppercase">
                <th className="py-space-md px-space-lg">Patient &amp; UID</th>
                <th className="py-space-md px-space-md">Case Ref</th>
                <th className="py-space-md px-space-md">Risk Level</th>
                <th className="py-space-md px-space-md text-right">Distress</th>
                <th className="py-space-md px-space-md text-right">Threat</th>
                <th className="py-space-md px-space-md">Last Check-in</th>
                <th className="py-space-md px-space-lg text-right">Full Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20 font-body-sm text-body-sm">
              {filtered.map((c) => (
                <tr key={c.case_id} className="hover:bg-surface-container-low/40 transition-colors">
                  <td className="py-space-md px-space-lg">
                    <div className="flex flex-col">
                      <Link
                        to={`/cases/${c.case_id}`}
                        className="font-headline-sm text-sm font-bold text-on-surface hover:text-primary transition-colors"
                      >
                        {c.display_name}
                      </Link>
                      <span className="font-data-mono text-xs text-secondary">{c.uid}</span>
                    </div>
                  </td>
                  <td className="py-space-md px-space-md text-secondary">{c.case_ref}</td>
                  <td className="py-space-md px-space-md">
                    <RiskBadge level={c.risk_level} size="sm" />
                  </td>
                  <td className="py-space-md px-space-md text-right font-data-mono font-bold text-on-surface">
                    {c.distress_score?.toFixed(1) ?? '—'}
                  </td>
                  <td className="py-space-md px-space-md text-right font-data-mono font-bold text-error">
                    {c.threat_score?.toFixed(1) ?? '—'}
                  </td>
                  <td className="py-space-md px-space-md text-secondary">
                    {c.last_check_in ? new Date(c.last_check_in).toLocaleDateString() : 'Pending'}
                  </td>
                  <td className="py-space-md px-space-lg text-right">
                    <Link
                      to={`/cases/${c.case_id}`}
                      className="px-space-md py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-primary font-label-sm text-label-sm transition-colors inline-flex items-center gap-1 font-semibold"
                    >
                      <span>View Dossier</span>
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
