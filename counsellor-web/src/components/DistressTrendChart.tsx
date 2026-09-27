import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DistressTrendPoint } from '../api/types'

interface DistressTrendChartProps {
  data: DistressTrendPoint[]
  timeRange: string
  onTimeRangeChange?: (range: string) => void
}

export function DistressTrendChart({
  data,
  timeRange,
  onTimeRangeChange,
}: DistressTrendChartProps) {
  const currentDistress = data.length > 0 ? data[data.length - 1].mean_distress : 35.0
  const initialDistress = data.length > 0 ? data[0].mean_distress : 48.0
  const delta = currentDistress - initialDistress
  const deltaPct = initialDistress > 0 ? Math.round((delta / initialDistress) * 100) : 0

  return (
    <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-surface-container flex flex-col justify-between h-full">
      <div>
        {/* Header & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm mb-space-xs">
          <div>
            <div className="flex items-center gap-space-xs">
              <span className="font-headline-sm text-headline-sm text-on-surface font-bold">
                Distress Trends Over Time
              </span>
              <span className="px-space-xs py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-surface-container text-secondary">
                Temporal Trajectory
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-secondary mt-1">
              How is distress changing across the district cohort over time?
            </p>
          </div>

          {/* Time range pills if standalone */}
          {onTimeRangeChange && (
            <div className="inline-flex rounded-lg p-0.5 bg-surface-container self-start sm:self-auto">
              {[
                { id: 'today', label: 'Today' },
                { id: '7d', label: '7 Days' },
                { id: '30d', label: '30 Days' },
              ].map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => onTimeRangeChange(btn.id)}
                  className={`px-space-sm py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    timeRange === btn.id
                      ? 'bg-surface-container-lowest text-primary shadow-xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-space-md py-space-xs text-xs font-label-sm text-secondary">
          <span className="flex items-center gap-1.5 text-on-surface">
            <span className="w-3 h-1 bg-primary rounded-full inline-block"></span> Mean Distress
          </span>
          <span className="flex items-center gap-1.5 text-secondary">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-outline inline-block"></span> Baseline Normal (40.0)
          </span>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-52 my-space-sm">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: -20 }}>
            <defs>
              <linearGradient id="gradientDistressCurve" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3525CD" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3525CD" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="#94A3B8" fontSize={11} tickLine={false} />
            <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} domain={[0, 100]} />
            <ReferenceLine
              y={40}
              stroke="#94A3B8"
              strokeDasharray="4 4"
              label={{ value: 'Norm 40', fill: '#94A3B8', fontSize: 10, position: 'right' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '8px',
                fontSize: 12,
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}
              formatter={(val: number) => [`${val.toFixed(1)} pts`, 'Mean Distress']}
            />
            <Area
              type="monotone"
              dataKey="mean_distress"
              stroke="#3525CD"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#gradientDistressCurve)"
              activeDot={{ r: 5, fill: '#3525CD' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Footer Metrics */}
      <div className="pt-space-xs border-t border-surface-container flex flex-wrap items-center justify-between text-xs text-secondary gap-space-xs">
        <div>
          Current Cohort Mean:{' '}
          <strong className="text-on-surface font-semibold">{currentDistress.toFixed(1)} pts</strong>
        </div>
        <div className="flex items-center gap-1 font-semibold">
          <span>Net Trajectory:</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[11px] ${
              deltaPct > 0
                ? 'bg-error-container text-on-error-container'
                : 'bg-primary-fixed text-on-primary-fixed'
            }`}
          >
            {deltaPct > 0 ? `+${deltaPct}% Surge` : `${deltaPct}% Stabilization`}
          </span>
        </div>
      </div>
    </div>
  )
}
