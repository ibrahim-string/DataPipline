'use client';

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { ExperimentRun } from '@/lib/data/types';
import { SERIES_COLORS, axisProps, gridProps } from './theme';
import { TooltipRow, TooltipShell, type ChartTooltipProps } from './ChartTooltip';

interface Row {
  label: string;
  success_rate: number;
  dataset: string;
  quality: number;
  episodes: number;
}

function RunTooltip({ active, payload }: ChartTooltipProps & { payload?: Array<{ payload?: Row }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <TooltipShell label={row.label}>
      <TooltipRow color={SERIES_COLORS.blue} name="Success rate" value={`${row.success_rate.toFixed(1)}%`} />
      <TooltipRow color={SERIES_COLORS.aqua} name="Dataset quality" value={row.quality.toFixed(1)} />
      <TooltipRow color={SERIES_COLORS.yellow} name="Episodes" value={row.episodes} />
      <div className="pt-1 text-[11px] text-ink-dim">{row.dataset}</div>
    </TooltipShell>
  );
}

/**
 * Simulated evaluation success rate per run.
 *
 * One measure, one axis. Dataset quality and episode count live in the tooltip
 * rather than on a second y-scale — the point of the chart is the trend in
 * success rate as the data behind each run improved.
 */
export function ExperimentChart({ runs, height = 200 }: { runs: ExperimentRun[]; height?: number }) {
  const data: Row[] = runs.map((run) => ({
    label: run.run_id.replace(/^exp-\d+-/, ''),
    success_rate: run.success_rate,
    dataset: run.dataset_version,
    quality: run.dataset_avg_quality,
    episodes: run.episodes,
  }));

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis domain={[0, 100]} width={40} tickFormatter={(v: number) => `${v}%`} {...axisProps} />
          <Tooltip content={<RunTooltip />} cursor={{ fill: '#ffffff08' }} />
          <Bar dataKey="success_rate" fill={SERIES_COLORS.blue} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            <LabelList
              dataKey="success_rate"
              position="top"
              formatter={(value) => `${Number(value).toFixed(0)}%`}
              fill="#96a3b4"
              fontSize={11}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
