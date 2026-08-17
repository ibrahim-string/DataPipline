import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';

import { SensorAvailabilityChart } from '@/components/charts/SensorAvailabilityChart';
import { SyncDriftChart } from '@/components/charts/SyncDriftChart';
import { BatteryChart, VelocityCharts } from '@/components/charts/MotionCharts';
import { ActionTimeline } from '@/components/episode/ActionTimeline';
import {
  Badge,
  Field,
  MetricBar,
  Mono,
  Note,
  Panel,
  ScoreValue,
  StatTile,
  StatusBadge,
  severityTone,
} from '@/components/ui/primitives';
import { QUALITY_GATES, QUALITY_WEIGHTS } from '@/lib/pipeline/config';
import { validateEvent } from '@/lib/pipeline/validate';
import { fmtClock, fmtDateTime, fmtDuration, fmtMs, fmtNumber, fmtPct } from '@/lib/format';
import { getEpisode } from '@/lib/server/catalog';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: id };
}

const SUBSCORE_ROWS = [
  { key: 'completeness', label: 'Completeness', weight: QUALITY_WEIGHTS.completeness },
  { key: 'synchronization', label: 'Synchronization', weight: QUALITY_WEIGHTS.synchronization },
  { key: 'validity', label: 'Validity', weight: QUALITY_WEIGHTS.validity },
  { key: 'sensor_health', label: 'Sensor health', weight: QUALITY_WEIGHTS.sensor_health },
  { key: 'ordering', label: 'Ordering', weight: QUALITY_WEIGHTS.ordering },
  { key: 'duplication', label: 'Duplication', weight: QUALITY_WEIGHTS.duplication },
] as const;

export default async function EpisodeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const episode = getEpisode(id);
  if (!episode) notFound();

  const { metrics, quality } = episode;
  const rejected = quality.status === 'REJECTED';
  const flagged = quality.status === 'FLAGGED';
  const VerdictIcon = rejected ? XCircle : flagged ? AlertTriangle : CheckCircle2;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/episodes"
          className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={13} />
          All episodes
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="font-mono text-xl font-semibold text-ink">{episode.episode_id}</h1>
              <StatusBadge status={quality.status} />
            </div>
            <p className="mt-1.5 text-sm text-ink-muted">{episode.task_label}</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-ink-dim">Quality score</div>
            <div className="tnum text-3xl font-semibold">
              <ScoreValue score={quality.score} />
            </div>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Robot">
          <Link href={`/fleet/${episode.robot_id}`} className="font-mono text-accent hover:underline">
            {episode.robot_id}
          </Link>
        </Field>
        <Field label="Site">{episode.site}</Field>
        <Field label="Environment">{episode.environment}</Field>
        <Field label="Started">{fmtDateTime(episode.started_at)}</Field>
        <Field label="Duration">{fmtDuration(episode.duration_s)}</Field>
        <Field label="Task ID">
          <Mono>{episode.task}</Mono>
        </Field>
      </dl>

      {/* Verdict */}
      <Panel
        title={
          <span className="flex items-center gap-2">
            <VerdictIcon
              size={15}
              className={rejected ? 'text-bad' : flagged ? 'text-warn' : 'text-good'}
              aria-hidden
            />
            Pipeline verdict — {quality.status.replace('_', ' ')}
          </span>
        }
        subtitle="Hard gates run first and cannot be overridden by the weighted score."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-dim">Reasons</h3>
            <ul className="mt-2 space-y-1.5">
              {quality.reasons.map((reason) => (
                <li key={reason} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-dim" aria-hidden />
                  {reason}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-dim">
              Gate results
            </h3>
            {quality.gate_failures.length === 0 ? (
              <p className="mt-2 text-sm text-good">All quality gates passed.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {quality.gate_failures.map((failure) => (
                  <li
                    key={failure.gate}
                    className="rounded-md border border-bad/25 bg-bad/5 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-bad">{failure.gate}</span>
                      <span className="tnum text-ink-muted">
                        {failure.observed} <span className="text-ink-dim">vs {failure.threshold}</span>
                      </span>
                    </div>
                    <p className="mt-1 leading-relaxed text-ink-muted">{failure.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      {/* Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatTile
          label="Completeness"
          value={fmtPct(metrics.completeness_pct)}
          tone={metrics.completeness_pct >= QUALITY_GATES.min_completeness_pct ? 'good' : 'bad'}
          hint={`gate ≥ ${QUALITY_GATES.min_completeness_pct}%`}
        />
        <StatTile
          label="Validity"
          value={fmtPct(metrics.validity_pct)}
          tone={metrics.validity_pct >= QUALITY_GATES.min_validity_pct ? 'good' : 'bad'}
          hint={`gate ≥ ${QUALITY_GATES.min_validity_pct}%`}
        />
        <StatTile
          label="Sync p95"
          value={fmtMs(metrics.sync_p95_ms)}
          tone={metrics.sync_p95_ms <= QUALITY_GATES.max_sync_p95_ms ? 'good' : 'bad'}
          hint={`p99 ${fmtMs(metrics.sync_p99_ms)} · gate ≤ ${QUALITY_GATES.max_sync_p95_ms} ms`}
        />
        <StatTile
          label="Duplicates"
          value={fmtPct(metrics.duplication_pct)}
          tone={metrics.duplication_pct <= QUALITY_GATES.max_duplication_pct ? 'good' : 'bad'}
          hint={`${fmtNumber(metrics.events_duplicate)} events`}
        />
        <StatTile
          label="Out of order"
          value={fmtPct(metrics.out_of_order_pct)}
          tone={metrics.out_of_order_pct <= QUALITY_GATES.max_out_of_order_pct ? 'good' : 'bad'}
          hint={`${fmtNumber(metrics.events_out_of_order)} events`}
        />
        <StatTile
          label="Ingest latency"
          value={fmtMs(metrics.ingest_latency_ms, 0)}
          hint={`${fmtNumber(metrics.events_total)} events received`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Quality subscores"
          subtitle="Weighted contributions to the final score. Weights are shown as configured."
        >
          <div className="space-y-3">
            {SUBSCORE_ROWS.map((row) => {
              const value = quality.subscores[row.key];
              return (
                <MetricBar
                  key={row.key}
                  label={`${row.label} · weight ${(row.weight * 100).toFixed(0)}%`}
                  value={value}
                  detail={value.toFixed(1)}
                />
              );
            })}
          </div>
          <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3 text-sm">
            <span className="text-ink-muted">Weighted score</span>
            <ScoreValue score={quality.score} className="text-lg" />
          </div>
        </Panel>

        <Panel
          title={`Anomalies (${episode.anomalies.length})`}
          subtitle="Detected by the stream analyser during episode assembly."
          bodyClassName="p-0"
        >
          {episode.anomalies.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-dim">
              No anomalies detected in this episode.
            </p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {episode.anomalies.map((anomaly) => (
                <li key={anomaly.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm text-ink">{anomaly.message}</span>
                    <Badge tone={severityTone(anomaly.severity)}>{anomaly.severity}</Badge>
                  </div>
                  {anomaly.detail && (
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">{anomaly.detail}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-dim">
                    <Mono>{anomaly.kind}</Mono>
                    <span>·</span>
                    <span>{anomaly.sensor}</span>
                    <span>·</span>
                    <span className="tnum">
                      t+{anomaly.start_offset_s.toFixed(1)}s → t+{anomaly.end_offset_s.toFixed(1)}s
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Sensor availability"
        subtitle="Events received per second against each stream's expected rate (dashed). A gap in a row is a dropout."
      >
        <SensorAvailabilityChart timeline={episode.timeline} sensors={episode.sensors} />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="Timestamp synchronization"
          subtitle="Signed clock skew of each sensor against the camera reference, measured through the shared ingest clock."
        >
          {episode.sync_series.length > 0 ? (
            <SyncDriftChart data={episode.sync_series} />
          ) : (
            <p className="text-sm text-ink-dim">No synchronization samples for this episode.</p>
          )}
        </Panel>

        <Panel title="Synchronization pairs" subtitle="Deviation distribution per sensor pair." bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                  <th className="px-4 py-2.5 font-medium">Pair</th>
                  <th className="px-4 py-2.5 text-right font-medium">Mean</th>
                  <th className="px-4 py-2.5 text-right font-medium">p95</th>
                  <th className="px-4 py-2.5 text-right font-medium">p99</th>
                  <th className="px-4 py-2.5 text-right font-medium">Offset</th>
                  <th className="px-4 py-2.5 text-right font-medium">Samples</th>
                </tr>
              </thead>
              <tbody>
                {metrics.sync.map((pair) => (
                  <tr key={pair.pair} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ink">{pair.pair}</td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-muted">{pair.mean_ms.toFixed(1)}</td>
                    <td
                      className={`px-4 py-2.5 text-right tnum ${pair.p95_ms > QUALITY_GATES.max_sync_p95_ms ? 'text-bad' : 'text-ink-muted'}`}
                    >
                      {pair.p95_ms.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-muted">{pair.p99_ms.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-muted">{pair.offset_ms.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-dim">{fmtNumber(pair.samples)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-4 py-3">
            <Note>
              All values in milliseconds. A large <strong>offset</strong> with a small spread is a
              constant clock skew — a time-sync problem. An offset near zero with a large p99 is
              transport jitter.
            </Note>
          </div>
        </Panel>
      </div>

      <Panel title="Robot action track" subtitle="Segmented from the action stream; hover a segment for its mean velocity.">
        <ActionTimeline segments={episode.actions} duration={episode.duration_s} />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Motion" subtitle="Commanded velocity over the episode.">
          <VelocityCharts data={episode.motion_series} />
        </Panel>
        <Panel title="Battery" subtitle="State of charge.">
          <BatteryChart data={episode.motion_series} height={140} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Per-sensor health" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                  <th className="px-4 py-2.5 font-medium">Sensor</th>
                  <th className="px-4 py-2.5 text-right font-medium">Events</th>
                  <th className="px-4 py-2.5 text-right font-medium">Complete</th>
                  <th className="px-4 py-2.5 text-right font-medium">Valid</th>
                  <th className="px-4 py-2.5 text-right font-medium">Longest gap</th>
                  <th className="px-4 py-2.5 text-right font-medium">Health</th>
                </tr>
              </thead>
              <tbody>
                {metrics.sensor_health.map((health) => {
                  const completeness = metrics.completeness.find((c) => c.sensor === health.sensor);
                  return (
                    <tr key={health.sensor} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2.5 text-ink">{health.sensor}</td>
                      <td className="px-4 py-2.5 text-right tnum text-ink-muted">
                        {fmtNumber(health.events)}
                        {completeness && (
                          <span className="text-ink-dim"> / {fmtNumber(completeness.expected)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tnum text-ink-muted">
                        {health.completeness_pct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-right tnum text-ink-muted">
                        {health.validity_pct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-right tnum text-ink-muted">
                        {health.longest_gap_ms > 0 ? `${health.longest_gap_ms.toFixed(0)} ms` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ScoreValue score={health.score} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Raw event samples"
          subtitle="An anomaly-biased sample of the raw stream, re-validated on render."
          bodyClassName="p-0"
        >
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">Sensor</th>
                  <th className="px-4 py-2.5 font-medium">Seq</th>
                  <th className="px-4 py-2.5 font-medium">Payload</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {episode.event_samples.map((event, index) => {
                  const result = validateEvent(event);
                  return (
                    <tr
                      key={`${event.sequence_id}-${index}`}
                      className={`border-b border-line/60 last:border-0 ${result.ok ? '' : 'bg-bad/5'}`}
                    >
                      <td className="whitespace-nowrap px-4 py-2 tnum text-ink-dim">
                        {fmtClock(event.timestamp)}
                      </td>
                      <td className="px-4 py-2 text-ink-muted">{event.sensor}</td>
                      <td className="px-4 py-2 tnum text-ink-dim">{event.sequence_id}</td>
                      <td className="px-4 py-2 text-ink-muted">
                        <div className="max-w-[320px] truncate" title={JSON.stringify(event.payload)}>
                          {JSON.stringify(event.payload)}
                        </div>
                        {!result.ok && (
                          <div className="mt-0.5 font-sans text-[11px] text-bad">
                            {result.issues
                              .filter((issue) => issue.level === 'error')
                              .map((issue) => issue.detail)
                              .join(' · ')}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
