'use client';

import { cx } from '@/components/ui/primitives';
import { fmtClock } from '@/lib/format';
import type { LogLine } from './liveStore';

const LEVEL_STYLES = {
  OK: { text: 'text-good', label: 'OK' },
  WARNING: { text: 'text-warn', label: 'WARN' },
  ERROR: { text: 'text-bad', label: 'ERROR' },
} as const;

/**
 * Rolling ingest log.
 *
 * Healthy traffic is sampled 1-in-12 (the streams together push ~190 events/s,
 * which no one can read) while every warning and every error is always shown.
 * The log is for spotting problems, not for auditing throughput.
 */
export function EventLog({ lines }: { lines: LogLine[] }) {
  if (lines.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-dim">
        Waiting for telemetry…
      </p>
    );
  }

  return (
    <ul className="max-h-[360px] divide-y divide-line/50 overflow-y-auto font-mono text-[11px]">
      {lines.map((line) => {
        const style = LEVEL_STYLES[line.level];
        return (
          <li key={line.key} className="flex items-baseline gap-2 px-4 py-1.5">
            <span className="shrink-0 tnum text-ink-dim">{fmtClock(line.timestamp)}</span>
            <span className="w-16 shrink-0 text-ink-muted">{line.sensor}</span>
            <span className={cx('w-11 shrink-0 font-medium', style.text)}>{style.label}</span>
            <span
              className={cx('min-w-0 flex-1 truncate', line.level === 'OK' ? 'text-ink-dim' : 'text-ink-muted')}
              title={line.message}
            >
              {line.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
