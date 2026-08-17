'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { QUALITY_GATES } from '@/lib/pipeline/config';
import type { SyncSample } from '@/lib/pipeline/types';
import { SENSOR_COLORS, axisProps, gridProps } from './theme';
import { TooltipRow, TooltipShell, type ChartTooltipProps } from './ChartTooltip';

const SERIES = [
  { key: 'imu_ms', label: 'IMU', color: SENSOR_COLORS.imu },
  { key: 'lidar_ms', label: 'LiDAR', color: SENSOR_COLORS.lidar },
  { key: 'odometry_ms', label: 'Odometry', color: SENSOR_COLORS.odometry },
] as const;

function DriftTooltip({ active, label, payload }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <TooltipShell label={`t + ${Number(label).toFixed(1)}s`}>
      {payload.map((entry) => (
        <TooltipRow
          key={String(entry.dataKey)}
          color={entry.color ?? '#fff'}
          name={String(entry.name)}
          value={`${Number(entry.value).toFixed(1)} ms`}
        />
      ))}
    </TooltipShell>
  );
}

/**
 * Signed clock skew of each sensor against the camera reference, over the
 * episode. A flat line near zero is a healthy sensor; a ramp is drift; a step is
 * a clock jump. The shaded band is the region the quality gate accepts.
 */
export function SyncDriftChart({ data, height = 220 }: { data: SyncSample[]; height?: number }) {
  const gate = QUALITY_GATES.max_sync_p95_ms;
  const peak = data.reduce<number>(
    (max, sample) =>
      Math.max(max, Math.abs(sample.imu_ms), Math.abs(sample.lidar_ms), Math.abs(sample.odometry_ms)),
    gate,
  );
  const bound = Math.ceil((peak * 1.15) / 10) * 10;

  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
            <CartesianGrid {...gridProps} />
            <ReferenceArea
              y1={-gate}
              y2={gate}
              fill="#34d399"
              fillOpacity={0.05}
              stroke="#34d399"
              strokeOpacity={0.18}
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="offset_s"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value: number) => `${value.toFixed(0)}s`}
              {...axisProps}
            />
            <YAxis
              domain={[-bound, bound]}
              tickFormatter={(value: number) => `${value}`}
              width={46}
              {...axisProps}
            />
            <Tooltip content={<DriftTooltip />} cursor={{ stroke: '#4b5765', strokeWidth: 1 }} />
            {SERIES.map((series) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: series.color }} />
            {series.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-ink-dim">
          <span className="h-2.5 w-4 rounded-[2px] border border-good/30 bg-good/10" />
          within ±{gate} ms gate
        </span>
      </div>
    </div>
  );
}
