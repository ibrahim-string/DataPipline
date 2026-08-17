'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { VALUE_LIMITS } from '@/lib/pipeline/config';
import type { MotionSample } from '@/lib/pipeline/types';
import { SERIES_COLORS, STATUS_COLORS, axisProps, gridProps } from './theme';
import { TooltipRow, TooltipShell, type ChartTooltipProps } from './ChartTooltip';

function makeTooltip(unit: string, digits: number) {
  return function MotionTooltip({ active, label, payload }: ChartTooltipProps) {
    if (!active || !payload?.length) return null;
    return (
      <TooltipShell label={`t + ${label}s`}>
        {payload.map((entry) => (
          <TooltipRow
            key={String(entry.dataKey)}
            color={entry.color ?? '#fff'}
            name={String(entry.name)}
            value={`${Number(entry.value).toFixed(digits)} ${unit}`}
          />
        ))}
      </TooltipShell>
    );
  };
}

const LinearTooltip = makeTooltip('m/s', 2);
const AngularTooltip = makeTooltip('rad/s', 2);
const BatteryTooltip = makeTooltip('%', 1);

/**
 * Velocity as two small multiples rather than one chart.
 *
 * Linear velocity is in m/s and angular in rad/s — different units. Putting them
 * on a shared axis invites a second y-scale, which is the fastest way to make a
 * chart lie. Two panels, one scale each.
 */
export function VelocityCharts({ data, height = 140 }: { data: MotionSample[]; height?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-ink-muted">Linear velocity</span>
          <span className="text-ink-dim">m/s</span>
        </div>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="offset_s" tickFormatter={(v: number) => `${v}s`} {...axisProps} />
              <YAxis width={40} {...axisProps} />
              <ReferenceLine
                y={VALUE_LIMITS.max_linear_velocity}
                stroke={STATUS_COLORS.bad}
                strokeOpacity={0.5}
                strokeDasharray="3 3"
              />
              <Tooltip content={<LinearTooltip />} cursor={{ stroke: '#4b5765', strokeWidth: 1 }} />
              <Line
                type="monotone"
                dataKey="linear"
                name="Linear"
                stroke={SERIES_COLORS.blue}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-ink-muted">Angular velocity</span>
          <span className="text-ink-dim">rad/s</span>
        </div>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="offset_s" tickFormatter={(v: number) => `${v}s`} {...axisProps} />
              <YAxis width={40} {...axisProps} />
              <ReferenceLine y={0} stroke="#4b5765" strokeOpacity={0.6} />
              <Tooltip content={<AngularTooltip />} cursor={{ stroke: '#4b5765', strokeWidth: 1 }} />
              <Line
                type="monotone"
                dataKey="angular"
                name="Angular"
                stroke={SERIES_COLORS.orange}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export function BatteryChart({ data, height = 120 }: { data: MotionSample[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="battery-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES_COLORS.aqua} stopOpacity={0.4} />
              <stop offset="100%" stopColor={SERIES_COLORS.aqua} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="offset_s" tickFormatter={(v: number) => `${v}s`} {...axisProps} />
          <YAxis domain={[0, 100]} width={40} {...axisProps} />
          <Tooltip content={<BatteryTooltip />} cursor={{ stroke: '#4b5765', strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="battery"
            name="State of charge"
            stroke={SERIES_COLORS.aqua}
            strokeWidth={2}
            fill="url(#battery-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
