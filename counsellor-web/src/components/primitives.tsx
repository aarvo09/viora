/* Shared presentational primitives.
 *
 * Colour discipline: risk bands are the only saturated colour in the product.
 * Everything else is ink, muted and line. That is what keeps a CRITICAL badge
 * meaningful when a caseworker scans the page.
 */

import type { ReactNode } from 'react'
import type {
  BaselineConfidence,
  Direction,
  RiskLevel,
  Severity,
  Trend,
} from '../api/types'

/* ------------------------------------------------------------- risk badge */

const RISK_STYLE: Record<RiskLevel, { fg: string; bg: string; border: string; label: string }> = {
  LOW: { fg: 'var(--risk-low-text)', bg: 'var(--risk-low-tint)', border: 'var(--risk-low-border)', label: 'LOW RISK' },
  MODERATE: { fg: 'var(--risk-moderate-text)', bg: 'var(--risk-moderate-tint)', border: 'var(--risk-moderate-border)', label: 'MODERATE' },
  HIGH: { fg: 'var(--risk-high-text)', bg: 'var(--risk-high-tint)', border: 'var(--risk-high-border)', label: 'HIGH RISK' },
  CRITICAL: { fg: 'var(--risk-critical-text)', bg: 'var(--risk-critical-tint)', border: 'var(--risk-critical-border)', label: 'CRITICAL' },
  URGENT: { fg: 'var(--risk-critical-text)', bg: 'var(--risk-critical-tint)', border: 'var(--risk-critical-border)', label: 'URGENT' },
}

export function RiskBadge({
  level,
  size = 'md',
}: {
  level: RiskLevel | null
  size?: 'sm' | 'md' | 'lg'
}) {
  if (!level) {
    return <span className="muted small">No assessment yet</span>
  }
  const s = RISK_STYLE[level]
  const isUrgent = level === 'CRITICAL' || level === 'URGENT' || level === 'HIGH'
  const pad = size === 'lg' ? '4px 14px' : size === 'sm' ? '2px 8px' : '3px 10px'
  const fs = size === 'lg' ? 'var(--fs-base)' : size === 'sm' ? '11px' : 'var(--fs-xs)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: pad,
        fontSize: fs,
        fontWeight: 600,
        letterSpacing: '0.04em',
        color: s.fg,
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: isUrgent ? 'var(--risk-critical)' : s.fg,
          display: 'inline-block',
          boxShadow: isUrgent ? '0 0 6px var(--risk-critical)' : 'none',
        }}
      />
      {s.label}
    </span>
  )
}

/* A solid rule in the risk colour — used as a row marker in dense lists,
 * where a full badge on every line would be noise. */
export function RiskStripe({ level }: { level: RiskLevel | null }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 3,
        alignSelf: 'stretch',
        minHeight: 34,
        borderRadius: 2,
        background: level ? RISK_STYLE[level].fg : 'var(--line-strong)',
      }}
    />
  )
}

/* -------------------------------------------------------------- direction */

const DIRECTION_META: Record<Direction, { glyph: string; label: string; color: string }> = {
  ESCALATING: { glyph: '↗', label: 'Escalating', color: 'var(--risk-high)' },
  DE_ESCALATING: { glyph: '↘', label: 'De-escalating', color: 'var(--risk-low)' },
  STABLE: { glyph: '→', label: 'Stable', color: 'var(--muted)' },
  INSUFFICIENT_DATA: { glyph: '·', label: 'Not enough history', color: 'var(--muted)' },
}

export function DirectionTag({
  direction,
  size = 'md',
}: {
  direction: Direction | null
  size?: 'sm' | 'md' | 'lg'
}) {
  if (!direction) return <span className="muted small">—</span>
  const d = DIRECTION_META[direction]
  const fs = size === 'lg' ? 'var(--fs-base)' : size === 'sm' ? 'var(--fs-xs)' : 'var(--fs-sm)'
  return (
    <span className="row row-2" style={{ color: d.color, fontSize: fs, fontWeight: 600 }}>
      <span aria-hidden style={{ fontSize: '1.1em' }}>
        {d.glyph}
      </span>
      {d.label}
    </span>
  )
}

const TREND_META: Record<Trend, { glyph: string; label: string; color: string }> = {
  WORSENING: { glyph: '▲', label: 'Worsening', color: 'var(--risk-high)' },
  IMPROVING: { glyph: '▼', label: 'Improving', color: 'var(--risk-low)' },
  STABLE: { glyph: '—', label: 'Stable', color: 'var(--muted)' },
  INSUFFICIENT_DATA: { glyph: '·', label: 'First check-in', color: 'var(--muted)' },
}

export function TrendTag({ trend }: { trend: Trend | null }) {
  if (!trend) return <span className="muted small">—</span>
  const t = TREND_META[trend]
  return (
    <span className="row row-2 small" style={{ color: t.color, fontWeight: 600 }}>
      <span aria-hidden>{t.glyph}</span>
      {t.label}
    </span>
  )
}

/* ---------------------------------------------------------------- factors */

const SEVERITY_META: Record<Severity, { color: string; bg: string; label: string }> = {
  SERIOUS: { color: 'var(--risk-critical)', bg: 'var(--risk-critical-tint)', label: 'Serious' },
  CONCERN: { color: 'var(--risk-moderate)', bg: 'var(--risk-moderate-tint)', label: 'Concern' },
  INFO: { color: 'var(--muted)', bg: 'var(--surface-sunken)', label: 'Context' },
}

export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        flexShrink: 0,
        marginTop: 6,
        background: SEVERITY_META[severity].color,
      }}
    />
  )
}

export function severityLabel(severity: Severity) {
  return SEVERITY_META[severity].label
}

export function severityColor(severity: Severity) {
  return SEVERITY_META[severity].color
}

/* ------------------------------------------------------------ score bars */

export function ScoreBar({
  label,
  value,
  color,
  baseline,
}: {
  label: string
  value: number
  color: string
  baseline?: number
}) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="stack stack-2">
      <div className="spread">
        <span className="label" style={{ letterSpacing: '0.06em' }}>
          {label}
        </span>
        <span className="tnum" style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>
          {value.toFixed(1)}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${label} ${value.toFixed(1)} out of 100`}
        style={{
          position: 'relative',
          height: 10,
          borderRadius: 5,
          background: 'var(--surface-sunken)',
          border: '1px solid var(--line)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: 5,
            transition: `width var(--motion-slow)`,
          }}
        />
        {baseline !== undefined && baseline > 0 && (
          /* Baseline marker — makes "unusual for this person" visible rather
             than something the reader has to compute. */
          <div
            title={`Personal baseline ${baseline.toFixed(1)}`}
            style={{
              position: 'absolute',
              left: `${Math.max(0, Math.min(100, baseline))}%`,
              top: -2,
              bottom: -2,
              width: 2,
              background: 'var(--ink)',
              opacity: 0.45,
            }}
          />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------- baseline caveat */

const CONFIDENCE_NOTE: Record<BaselineConfidence, string> = {
  NONE: 'No history yet — baseline not established',
  LOW: 'Based on 1 previous check-in',
  MEDIUM: 'Based on 2–4 previous check-ins',
  HIGH: 'Based on 5 previous check-ins',
}

/* Never let a NONE/LOW baseline read as trustworthy. */
export function BaselineConfidenceTag({ confidence }: { confidence: BaselineConfidence }) {
  const weak = confidence === 'NONE' || confidence === 'LOW'
  return (
    <span
      title={CONFIDENCE_NOTE[confidence]}
      style={{
        fontSize: 'var(--fs-xs)',
        fontWeight: 600,
        letterSpacing: '0.06em',
        padding: '1px 6px',
        borderRadius: 'var(--radius-sm)',
        color: weak ? 'var(--risk-moderate)' : 'var(--muted)',
        background: weak ? 'var(--risk-moderate-tint)' : 'var(--surface-sunken)',
        border: `1px solid ${weak ? 'var(--risk-moderate)33' : 'var(--line)'}`,
      }}
    >
      {confidence}
    </span>
  )
}

/* ------------------------------------------------------------------ misc */

export function Delta({ value }: { value: number }) {
  if (Math.abs(value) < 0.05) return <span className="muted tnum">no change</span>
  const up = value > 0
  return (
    <span
      className="tnum"
      style={{ color: up ? 'var(--risk-high)' : 'var(--risk-low)', fontWeight: 600 }}
    >
      {up ? '▲' : '▼'} {up ? '+' : ''}
      {value.toFixed(1)}
    </span>
  )
}

export function Card({
  title,
  meta,
  children,
  action,
}: {
  title?: string
  meta?: ReactNode
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="card">
      {(title || meta || action) && (
        <header className="card-head">
          <span className="card-title">{title}</span>
          <span className="row row-3">
            {meta && <span className="card-meta">{meta}</span>}
            {action}
          </span>
        </header>
      )}
      <div className="card-pad">{children}</div>
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="muted small" style={{ padding: 'var(--s4) 0' }}>
      {children}
    </p>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="muted small" style={{ padding: 'var(--s8)', textAlign: 'center' }}>
      {label}…
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="card card-pad"
      style={{
        borderColor: 'var(--risk-critical)',
        background: 'var(--risk-critical-tint)',
        color: 'var(--risk-critical)',
      }}
    >
      {message}
    </div>
  )
}
