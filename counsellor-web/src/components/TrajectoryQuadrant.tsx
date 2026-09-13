/* Trajectory quadrant — distress on X, threat on Y.
 *
 * The one chart in this product that says something a number cannot. It makes
 * the case a single blended score would hide impossible to miss: someone in
 * the upper-left is composed but in danger, and lands in ENDANGERED rather
 * than reading as "fine" on a distress-only view.
 *
 * The trail is the case's own history; the filled dot is where they are now.
 *
 * Hand-drawn SVG rather than a chart library: quadrant bands, a directional
 * trail and an arrowhead are all fighting a scatter-plot abstraction, and this
 * is less code than bending Recharts into shape.
 */

import type { TelemetryPoint } from '../api/types'

const W = 320
const H = 260
const PAD = { top: 18, right: 18, bottom: 34, left: 40 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

const QUADRANTS = [
  { x: 0, y: 50, label: 'ENDANGERED', tint: 'var(--risk-high-tint)' },
  { x: 50, y: 50, label: 'CRISIS', tint: 'var(--risk-critical-tint)' },
  { x: 0, y: 0, label: 'SETTLED', tint: 'var(--risk-low-tint)' },
  { x: 50, y: 0, label: 'STRUGGLING', tint: 'var(--risk-moderate-tint)' },
]

export function TrajectoryQuadrant({ points }: { points: TelemetryPoint[] }) {
  const sx = (distress: number) => PAD.left + (Math.max(0, Math.min(100, distress)) / 100) * PLOT_W
  const sy = (threat: number) => PAD.top + PLOT_H - (Math.max(0, Math.min(100, threat)) / 100) * PLOT_H

  const trail = points.slice(-4)
  const current = trail[trail.length - 1]

  if (!current) {
    return (
      <p className="muted small" style={{ padding: 'var(--s4) 0' }}>
        No check-ins recorded yet.
      </p>
    )
  }

  const path = trail.map((p) => `${sx(p.distress_score)},${sy(p.threat_score)}`).join(' ')

  return (
    <div className="stack stack-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: W, display: 'block' }}
        role="img"
        aria-label={`Trajectory: distress ${current.distress_score.toFixed(0)}, threat ${current.threat_score.toFixed(0)} out of 100, over the last ${trail.length} check-ins`}
      >
        {QUADRANTS.map((q) => (
          <rect
            key={q.label}
            x={PAD.left + (q.x / 100) * PLOT_W}
            y={PAD.top + PLOT_H - ((q.y + 50) / 100) * PLOT_H}
            width={PLOT_W / 2}
            height={PLOT_H / 2}
            fill={q.tint}
          />
        ))}

        {QUADRANTS.map((q) => (
          <text
            key={`${q.label}-label`}
            x={PAD.left + (q.x / 100) * PLOT_W + 6}
            y={PAD.top + PLOT_H - ((q.y + 50) / 100) * PLOT_H + 13}
            fontSize={8}
            fontWeight={600}
            letterSpacing={0.6}
            fill="var(--muted)"
          >
            {q.label}
          </text>
        ))}

        {/* mid-lines at 50 on each axis */}
        <line
          x1={PAD.left + PLOT_W / 2}
          y1={PAD.top}
          x2={PAD.left + PLOT_W / 2}
          y2={PAD.top + PLOT_H}
          stroke="var(--line-strong)"
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H / 2}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + PLOT_H / 2}
          stroke="var(--line-strong)"
          strokeWidth={1}
        />

        <rect
          x={PAD.left}
          y={PAD.top}
          width={PLOT_W}
          height={PLOT_H}
          fill="none"
          stroke="var(--line-strong)"
        />

        {/* axes */}
        {[0, 50, 100].map((v) => (
          <text
            key={`y${v}`}
            x={PAD.left - 8}
            y={sy(v) + 3}
            fontSize={9}
            textAnchor="end"
            fill="var(--muted)"
          >
            {v}
          </text>
        ))}
        {[0, 50, 100].map((v) => (
          <text
            key={`x${v}`}
            x={sx(v)}
            y={PAD.top + PLOT_H + 14}
            fontSize={9}
            textAnchor="middle"
            fill="var(--muted)"
          >
            {v}
          </text>
        ))}
        <text
          x={PAD.left + PLOT_W / 2}
          y={H - 4}
          fontSize={9}
          fontWeight={600}
          textAnchor="middle"
          fill="var(--axis-distress)"
          letterSpacing={0.5}
        >
          DISTRESS →
        </text>
        <text
          x={-(PAD.top + PLOT_H / 2)}
          y={11}
          fontSize={9}
          fontWeight={600}
          textAnchor="middle"
          fill="var(--axis-threat)"
          transform="rotate(-90)"
          letterSpacing={0.5}
        >
          THREAT →
        </text>

        {/* history trail */}
        {trail.length > 1 && (
          <polyline
            points={path}
            fill="none"
            stroke="var(--ink)"
            strokeOpacity={0.28}
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}

        {trail.slice(0, -1).map((p) => (
          <circle
            key={p.report_version}
            cx={sx(p.distress_score)}
            cy={sy(p.threat_score)}
            r={3.5}
            fill="var(--surface)"
            stroke="var(--ink)"
            strokeOpacity={0.4}
            strokeWidth={1.5}
          />
        ))}

        {/* current position */}
        <circle
          cx={sx(current.distress_score)}
          cy={sy(current.threat_score)}
          r={9}
          fill="var(--risk-critical)"
          opacity={0.14}
        />
        <circle
          cx={sx(current.distress_score)}
          cy={sy(current.threat_score)}
          r={5}
          fill="var(--risk-critical)"
          stroke="var(--surface)"
          strokeWidth={1.5}
        />
      </svg>

      <p className="muted xs" style={{ maxWidth: 320 }}>
        Position is the latest check-in; the dashed trail is the previous{' '}
        {Math.max(0, trail.length - 1)}. High threat with low distress still
        warrants attention.
      </p>
    </div>
  )
}
