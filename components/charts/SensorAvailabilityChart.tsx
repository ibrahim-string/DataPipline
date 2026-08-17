'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { SIM_RATES_HZ } from '@/lib/pipeline/config';
import type { Sensor, TimelineBucket } from '@/lib/pipeline/types';
import { SENSOR_COLORS, gridProps } from './theme';
import { TooltipRow, TooltipShell, type ChartTooltipProps } from './ChartTooltip';

const ROWS: Array<{ key: keyof Pick<TimelineBucket, 'camera' | 'lidar' | 'imu' | 'odometry'>; sensor: Sensor; label: string }> = [
  { key: 'camera', sensor: 'camera', label: 'Camera' },
  { key: 'lidar', sensor: 'lidar', label: 'LiDAR' },
  { key: 'imu', sensor: 'imu', label: 'IMU' },
  { key: 'odometry', sensor: 'odometry', label: 'Odometry' },
];

function RowTooltip({ active, label, payload, expected }: ChartTooltipProps & { expected: number }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (!entry) return null;
  return (
    <TooltipShell label={`t + ${label}s`}>
      <TooltipRow
        color={entry.color ?? '#fff'}
        name={String(entry.name)}
        value={`${entry.value} / ${expected} events`}
      />
    </TooltipShell>
  );
}

/**
 * Small multiples, one row per modality.
 *
 * Deliberately not a single stacked chart: the IMU publishes at 100 Hz and the
 * LiDAR at 5 Hz, so stacking them would render the LiDAR — the stream most
 * likely to fail — as an invisible sliver. Each row keeps its own scale against
 * its own expected rate (the dashed line), which makes a gap obvious at a glance.
 */
export function SensorAvailabilityChart({
  timeline,
  sensors,
}: {
  timeline: TimelineBucket[];
  sensors: Sensor[];
}) {
  const rows = ROWS.filter((row) => sensors.includes(row.sensor));
  const lastOffset = timeline.length > 0 ? (timeline[timeline.length - 1]?.offset_s ?? 0) : 0;

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const expected = Math.round(SIM_RATES_HZ[row.sensor]);
        const color = SENSOR_COLORS[row.sensor];
        return (
          <div key={row.key} className="flex items-center gap-3">
            <div className="w-20 shrink-0 text-right text-xs text-ink-muted">{row.label}</div>
            <div className="h-12 min-w-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`fill-${row.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="offset_s" hide />
                  <YAxis domain={[0, Math.max(expected * 1.3, 2)]} hide />
                  <ReferenceLine
                    y={expected}
                    stroke={color}
                    strokeOpacity={0.45}
                    strokeDasharray="3 3"
                  />
                  <Tooltip
                    content={<RowTooltip expected={expected} />}
                    cursor={{ stroke: '#4b5765', strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey={row.key}
                    name={row.label}
                    stroke={color}
                    strokeWidth={1.5}
                    fill={`url(#fill-${row.key})`}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="w-16 shrink-0 text-xs tnum text-ink-dim">{expected} Hz</div>
          </div>
        );
      })}
      {/* Shared x-axis for all rows. A text strip rather than a fifth chart: the
          rows are aligned by flex, so one label pair is enough to read them. */}
      <div className="flex items-center gap-3 pt-0.5">
        <div className="w-20 shrink-0" />
        <div className="flex min-w-0 flex-1 justify-between border-t border-line pt-1 text-[11px] tnum text-ink-dim">
          <span>t + 0s</span>
          <span>t + {Math.round(lastOffset / 2)}s</span>
          <span>t + {lastOffset}s</span>
        </div>
        <div className="w-16 shrink-0" />
      </div>
    </div>
  );
}
