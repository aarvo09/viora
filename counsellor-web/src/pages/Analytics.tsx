/* Clinical Cohort Analytics & Outcomes Page.
 *
 * Implements Stitch UI/UX for Ward 3B Longitudinal Clinical Analytics.
 */

import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type { CaseListItem } from '../api/types'
import { Spinner } from '../components/primitives'

export function Analytics() {
  const [cases, setCases] = useState<CaseListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .cases()
      .then(setCases)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner label="Aggregating clinical analytics" />

  const riskCounts = {
    LOW: cases.filter((c) => c.risk_level === 'LOW').length,
    MODERATE: cases.filter((c) => c.risk_level === 'MODERATE').length,
    HIGH: cases.filter((c) => c.risk_level === 'HIGH').length,
    CRITICAL: cases.filter((c) => c.risk_level === 'CRITICAL' || c.risk_level === 'URGENT').length,
  }

  const chartData = [
    { name: 'Low Risk', count: riskCounts.LOW, fill: '#10B981' },
    { name: 'Moderate', count: riskCounts.MODERATE, fill: '#3B82F6' },
    { name: 'High Risk', count: riskCounts.HIGH, fill: '#F59E0B' },
    { name: 'Critical', count: riskCounts.CRITICAL, fill: '#EF4444' },
  ]

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
        <div>
          <div className="flex items-center gap-space-xs mb-space-2xs">
            <span className="font-data-mono text-data-mono text-primary font-semibold uppercase tracking-wider">
              Cohort Unit 3B Telemetry
            </span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-outline-variant" />
            <span className="font-label-sm text-label-sm text-secondary">
              N = {cases.length} Longitudinal Records
            </span>
          </div>
          <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight font-bold">
            Clinical Cohort Analytics &amp; Outcomes
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Aggregate longitudinal telemetry · Inpatient &amp; Outpatient Telemetry · Last 30 Days
          </p>
        </div>
      </section>

      {/* KPI Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/30 flex flex-col justify-between">
          <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
            Cohort Distress Index
          </span>
          <div className="my-space-sm flex items-baseline gap-space-xs">
            <span className="font-data-metric text-data-metric text-on-surface font-bold">
              44.2
            </span>
            <span className="font-label-sm text-secondary">/ 100 mean</span>
          </div>
          <span className="text-xs text-secondary">Baseline deviation -2.1 pt</span>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/30 flex flex-col justify-between">
          <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
            Threat Containment
          </span>
          <div className="my-space-sm flex items-baseline gap-space-xs">
            <span className="font-data-metric text-data-metric text-primary font-bold">
              98.5%
            </span>
          </div>
          <span className="text-xs text-secondary">Zero unreviewed Tier 1 alerts</span>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/30 flex flex-col justify-between">
          <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
            SLA Triage Adherence
          </span>
          <div className="my-space-sm flex items-baseline gap-space-xs">
            <span className="font-data-metric text-data-metric text-primary font-bold">
              94.8%
            </span>
          </div>
          <span className="text-xs text-secondary">&lt; 2hr clinical response time</span>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/30 flex flex-col justify-between">
          <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
            Check-in Adherence
          </span>
          <div className="my-space-sm flex items-baseline gap-space-xs">
            <span className="font-data-metric text-data-metric text-primary font-bold">
              89.2%
            </span>
          </div>
          <span className="text-xs text-secondary">Voice engagement rate</span>
        </div>
      </section>

      {/* Cohort Distribution Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/30 flex flex-col gap-space-md">
          <div className="flex items-center justify-between">
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
              Cohort Risk Level Distribution
            </h3>
            <span className="text-xs font-data-mono text-secondary">N = {cases.length} active cases</span>
          </div>
          <div className="w-full h-72 pt-space-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: -20 }}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '8px',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-4 bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/30 flex flex-col gap-space-md">
          <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
            Clinical Quality Indices
          </h3>
          <div className="flex flex-col gap-space-sm">
            <div className="p-space-sm rounded-lg bg-surface-container-low flex flex-col gap-1">
              <span className="font-label-sm text-xs text-secondary uppercase">
                Longitudinal Stability Index
              </span>
              <span className="font-data-mono font-bold text-on-surface text-lg">7.8 / 10</span>
              <span className="text-xs text-secondary">Divergence from baseline is contained</span>
            </div>
            <div className="p-space-sm rounded-lg bg-surface-container-low flex flex-col gap-1">
              <span className="font-label-sm text-xs text-secondary uppercase">
                Cadence Calibration Accuracy
              </span>
              <span className="font-data-mono font-bold text-primary text-lg">91.4%</span>
              <span className="text-xs text-secondary">Predicted vs manual override</span>
            </div>
            <div className="p-space-sm rounded-lg bg-surface-container-low flex flex-col gap-1">
              <span className="font-label-sm text-xs text-secondary uppercase">
                Voice Acoustic Model Confidence
              </span>
              <span className="font-data-mono font-bold text-on-surface text-lg">98.2%</span>
              <span className="text-xs text-secondary">Prosodic signal fidelity</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
