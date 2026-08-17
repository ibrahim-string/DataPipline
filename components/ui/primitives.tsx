import type { ReactNode } from 'react';

import { clamp } from '@/lib/format';
import type { EpisodeStatus, QualityGrade, Severity } from '@/lib/pipeline/types';

/** Shared building blocks. Server components — no client JS is shipped for these. */

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-medium text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-dim">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tile                                                           */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
  icon?: ReactNode;
}) {
  const toneClass = {
    neutral: 'text-ink',
    good: 'text-good',
    warn: 'text-warn',
    bad: 'text-bad',
    accent: 'text-accent',
  }[tone];

  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-dim">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cx('mt-1.5 flex items-baseline gap-1 tnum text-2xl font-semibold', toneClass)}>
        <span className="truncate">{value}</span>
        {unit && <span className="text-sm font-normal text-ink-dim">{unit}</span>}
      </div>
      {hint && <div className="mt-1 truncate text-xs text-ink-dim">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const BADGE_TONES = {
  neutral: 'border-line-strong bg-elevated text-ink-muted',
  good: 'border-good/30 bg-good/10 text-good',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  bad: 'border-bad/30 bg-bad/10 text-bad',
  accent: 'border-accent/30 bg-accent/10 text-accent',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: EpisodeStatus): BadgeTone {
  return status === 'TRAINING_READY' ? 'good' : status === 'FLAGGED' ? 'warn' : 'bad';
}

export function gradeTone(grade: QualityGrade): BadgeTone {
  return grade === 'GOOD' ? 'good' : grade === 'WARNING' ? 'warn' : 'bad';
}

export function severityTone(severity: Severity): BadgeTone {
  return severity === 'CRITICAL' || severity === 'HIGH'
    ? 'bad'
    : severity === 'MEDIUM'
      ? 'warn'
      : 'neutral';
}

export function StatusBadge({ status }: { status: EpisodeStatus }) {
  const label = status === 'TRAINING_READY' ? 'TRAINING READY' : status;
  return <Badge tone={statusTone(status)}>{label}</Badge>;
}

/** Score coloured by the same bands the engine uses. */
export function ScoreValue({ score, className }: { score: number; className?: string }) {
  const tone = score >= 90 ? 'text-good' : score >= 70 ? 'text-warn' : 'text-bad';
  return <span className={cx('tnum font-medium', tone, className)}>{score.toFixed(1)}</span>;
}

/* ------------------------------------------------------------------ */
/* Meters                                                              */
/* ------------------------------------------------------------------ */

export function MetricBar({
  label,
  value,
  detail,
  max = 100,
  tone,
}: {
  label: string;
  value: number;
  detail?: string;
  max?: number;
  tone?: 'good' | 'warn' | 'bad' | 'accent';
}) {
  const pct = clamp((value / max) * 100, 0, 100);
  const resolved = tone ?? (value >= 90 ? 'good' : value >= 70 ? 'warn' : 'bad');
  const barClass = {
    good: 'bg-good',
    warn: 'bg-warn',
    bad: 'bg-bad',
    accent: 'bg-accent',
  }[resolved];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="tnum text-ink">{detail ?? value.toFixed(1)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
        <div className={cx('h-full rounded-full', barClass)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout helpers                                                      */
/* ------------------------------------------------------------------ */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-ink-dim">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-ink">{children}</dd>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[11px] font-medium uppercase tracking-wider text-accent">{eyebrow}</div>
        )}
        <h1 className="mt-1 text-xl font-semibold text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface/50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {description && <p className="mt-1 text-xs text-ink-dim">{description}</p>}
    </div>
  );
}

/** Editorial callout used to keep POC-vs-production claims honest and visible. */
export function Note({
  title,
  children,
  tone = 'neutral',
  className,
}: {
  title?: string;
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warn';
  className?: string;
}) {
  const toneClass = {
    neutral: 'border-line bg-elevated/60',
    accent: 'border-accent/25 bg-accent/5',
    warn: 'border-warn/25 bg-warn/5',
  }[tone];

  return (
    <div
      className={cx('rounded-lg border px-4 py-3 text-xs leading-relaxed text-ink-muted', toneClass, className)}
    >
      {title && <div className="mb-1 font-medium text-ink">{title}</div>}
      {children}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono text-[12px] tnum', className)}>{children}</span>;
}
