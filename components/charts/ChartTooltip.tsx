'use client';

import type { ReactNode } from 'react';

/** Shared tooltip shell so every chart hovers the same way. */
export function TooltipShell({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line-strong bg-elevated px-2.5 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink">{label}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function TooltipRow({
  color,
  name,
  value,
}: {
  color: string;
  name: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-ink-muted">
        <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
        {name}
      </span>
      <span className="tnum text-ink">{value}</span>
    </div>
  );
}

export interface TooltipPayloadEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadEntry[];
}
