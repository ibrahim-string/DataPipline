import type { Sensor } from '@/lib/pipeline/types';

/**
 * Chart tokens.
 *
 * The categorical hues are a validated set: on the #0e1218 surface they clear
 * the lightness band, chroma floor, adjacent-pair colour-vision separation
 * (worst ΔE 8.4) and 3:1 contrast. Series identity is never carried by colour
 * alone — every chart with two or more series also ships a legend.
 *
 * Status colours (good / warn / bad) are reserved for state and are never used
 * as a series colour.
 */
export const SERIES_COLORS = {
  blue: '#3987e5',
  orange: '#d95926',
  aqua: '#199e70',
  yellow: '#c98500',
  magenta: '#d55181',
} as const;

export const SENSOR_COLORS: Record<Sensor, string> = {
  camera: SERIES_COLORS.blue,
  lidar: SERIES_COLORS.orange,
  imu: SERIES_COLORS.aqua,
  odometry: SERIES_COLORS.yellow,
  action: SERIES_COLORS.magenta,
  battery: '#8b95a5',
};

export const STATUS_COLORS = {
  good: '#34d399',
  warn: '#fbbf24',
  bad: '#f87171',
} as const;

export const CHART_INK = {
  axis: '#626f7e',
  grid: '#1e2631',
  reference: '#4b5765',
} as const;

export const axisProps = {
  stroke: CHART_INK.axis,
  tick: { fill: CHART_INK.axis, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: CHART_INK.grid },
} as const;

export const gridProps = {
  stroke: CHART_INK.grid,
  strokeDasharray: '2 4',
  vertical: false,
} as const;
