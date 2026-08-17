'use client';

import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';

import { cx } from '@/components/ui/primitives';
import type { LiveAlert } from './liveStore';

const LEVEL_STYLES = {
  CRITICAL: { wrap: 'border-bad/35 bg-bad/10', text: 'text-bad', Icon: ShieldAlert },
  HIGH: { wrap: 'border-bad/25 bg-bad/5', text: 'text-bad', Icon: AlertTriangle },
  MEDIUM: { wrap: 'border-warn/25 bg-warn/5', text: 'text-warn', Icon: AlertTriangle },
  RESOLVED: { wrap: 'border-good/25 bg-good/5', text: 'text-good', Icon: CheckCircle2 },
} as const;

function elapsed(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

/**
 * Live data-quality alerts.
 *
 * Alerts are stateful, not a scrolling list of one-off notices: a dropout raises
 * one alert and clears it when the stream comes back, so "recovered" is a real
 * transition rather than a cosmetic message.
 */
export function AlertPanel({ alerts }: { alerts: LiveAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <CheckCircle2 size={20} className="mx-auto text-good" aria-hidden />
        <p className="mt-2 text-sm text-ink-muted">No active alerts</p>
        <p className="mt-1 text-xs text-ink-dim">
          Every stream is within its completeness, synchronization and validity thresholds.
        </p>
      </div>
    );
  }

  return (
    <ul className="max-h-[420px] space-y-2 overflow-y-auto p-3">
      {alerts.map((alert) => {
        const style = LEVEL_STYLES[alert.level];
        const Icon = style.Icon;
        return (
          <li key={alert.id} className={cx('rounded-md border px-3 py-2.5', style.wrap)}>
            <div className="flex items-start gap-2">
              <Icon size={14} className={cx('mt-0.5 shrink-0', style.text)} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cx('text-xs font-medium', style.text)}>{alert.title}</span>
                  <span className="shrink-0 text-[10px] text-ink-dim">{elapsed(alert.at)}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{alert.detail}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-dim">{alert.episode_id}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
