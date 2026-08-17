'use client';

import { useEffect, useState } from 'react';
import { Activity, CircleStop, Play, Radio, Rocket } from 'lucide-react';

import { SensorAvailabilityChart } from '@/components/charts/SensorAvailabilityChart';
import { SyncDriftChart } from '@/components/charts/SyncDriftChart';
import {
  Badge,
  MetricBar,
  Note,
  Panel,
  ScoreValue,
  StatTile,
  StatusBadge,
  cx,
  severityTone,
} from '@/components/ui/primitives';
import { fmtDuration, fmtMs, fmtNumber, fmtPct } from '@/lib/format';
import { QUALITY_GATES } from '@/lib/pipeline/config';
import { DEMO_TIMELINE } from '@/lib/sim/demo';
import { AlertPanel } from './AlertPanel';
import { EventLog } from './EventLog';
import { EMPTY_SNAPSHOT, LiveStore, type ConnectionState, type LiveSnapshot } from './liveStore';

type Mode = 'idle' | 'live' | 'demo';

const SNAPSHOT_INTERVAL_MS = 500;

function useLiveStream() {
  const [mode, setMode] = useState<Mode>('idle');
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    if (mode === 'idle') return;

    const store = new LiveStore();
    store.setConnection('connecting');

    const source = new EventSource(mode === 'demo' ? '/api/stream?demo=1' : '/api/stream');

    source.addEventListener('episode_start', (event) => {
      store.onEpisodeStart(JSON.parse((event as MessageEvent<string>).data));
      store.setConnection('live');
    });
    source.addEventListener('telemetry', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        events: Parameters<LiveStore['onTelemetry']>[0];
      };
      store.onTelemetry(payload.events);
    });
    source.addEventListener('episode_end', () => {
      store.onEpisodeEnd();
    });
    source.onerror = () => {
      // EventSource reconnects on its own; surface the gap rather than hiding it.
      store.setConnection('error');
    };

    // Telemetry lands ~190 times a second. React only ever sees a snapshot,
    // pulled on this interval, which is also when the pipeline re-runs.
    const interval = setInterval(() => {
      store.tick();
      setSnapshot(store.snapshot());
    }, SNAPSHOT_INTERVAL_MS);

    return () => {
      source.close();
      clearInterval(interval);
    };
  }, [mode]);

  /** Clearing on the click, not in the effect, avoids a stale frame on restart. */
  const changeMode = (next: Mode) => {
    setSnapshot(EMPTY_SNAPSHOT);
    setMode(next);
  };

  return { mode, setMode: changeMode, connection: snapshot.connection, snapshot };
}

const CONNECTION_LABEL: Record<ConnectionState, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  idle: { label: 'STOPPED', tone: 'neutral' },
  connecting: { label: 'CONNECTING', tone: 'warn' },
  live: { label: 'ONLINE', tone: 'good' },
  reconnecting: { label: 'RECONNECTING', tone: 'warn' },
  error: { label: 'DISCONNECTED', tone: 'bad' },
};

export function LiveDashboard() {
  const { mode, setMode, connection, snapshot } = useLiveStream();
  const { ctx, metrics, quality } = snapshot;
  const running = mode !== 'idle';
  const status = CONNECTION_LABEL[connection];

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <button
          type="button"
          onClick={() => setMode(mode === 'demo' ? 'idle' : 'demo')}
          className={cx(
            'inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors',
            mode === 'demo'
              ? 'bg-bad/15 text-bad hover:bg-bad/20'
              : 'bg-accent text-base hover:bg-accent/90',
          )}
        >
          {mode === 'demo' ? <CircleStop size={15} /> : <Rocket size={15} />}
          {mode === 'demo' ? 'Stop demo' : 'Run 45-second demo'}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === 'live' ? 'idle' : 'live')}
          className={cx(
            'inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors',
            mode === 'live'
              ? 'border-bad/30 bg-bad/10 text-bad'
              : 'border-line-strong bg-elevated text-ink hover:border-accent/40',
          )}
        >
          {mode === 'live' ? <CircleStop size={15} /> : <Play size={15} />}
          {mode === 'live' ? 'Stop stream' : 'Start continuous stream'}
        </button>

        <div className="ml-auto flex items-center gap-3">
          <Badge tone={status.tone}>
            <Radio size={11} className={connection === 'live' ? 'animate-pulse' : ''} aria-hidden />
            {status.label}
          </Badge>
          {ctx && (
            <span className="hidden text-xs text-ink-dim sm:inline">
              {snapshot.elapsed.toFixed(0)}s / {snapshot.plannedDuration.toFixed(0)}s
            </span>
          )}
        </div>
      </div>

      {!running && (
        <Note tone="accent" title="What happens when you press play">
          The server generates synthetic multimodal telemetry for one robot and streams it over
          Server-Sent Events in real time. Your browser then runs the pipeline — validation,
          synchronization, quality scoring, episode assembly — using the exact same modules as the
          offline batch job. The <strong>45-second demo</strong> follows a scripted fault sequence so
          you can watch a healthy episode degrade and get rejected, with reasons.
        </Note>
      )}

      {/* Top-level metrics */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatTile
          label="Robot status"
          value={connection === 'live' ? 'ONLINE' : status.label}
          tone={connection === 'live' ? 'good' : 'neutral'}
          hint={ctx ? `${ctx.robot_id} · ${ctx.environment}` : 'No active robot'}
          icon={<Activity size={11} />}
        />
        <StatTile
          label="Data rate"
          value={fmtNumber(snapshot.eventsPerSecond)}
          unit="ev/s"
          hint={`${fmtNumber(snapshot.eventsReceived)} in this episode`}
        />
        <StatTile
          label="Active episode"
          value={ctx ? ctx.episode_id.replace('episode-', '') : '—'}
          hint={ctx?.task_label ?? 'Between episodes'}
        />
        <StatTile
          label="Live quality"
          value={quality ? quality.score.toFixed(1) : '—'}
          tone={quality ? (quality.score >= 90 ? 'good' : quality.score >= 70 ? 'warn' : 'bad') : 'neutral'}
          hint={quality ? quality.status.replace('_', ' ') : 'Awaiting data'}
        />
        <StatTile
          label="Sensor health"
          value={snapshot.sensorsExpected > 0 ? `${snapshot.sensorsUp} / ${snapshot.sensorsExpected}` : '—'}
          tone={
            snapshot.sensorsExpected === 0
              ? 'neutral'
              : snapshot.sensorsUp < snapshot.sensorsExpected
                ? 'bad'
                : 'good'
          }
          hint={snapshot.sensorStatus.map((entry) => entry.sensor).join(' · ') || 'No streams'}
        />
        <StatTile
          label="Pipeline latency"
          value={snapshot.metrics ? fmtMs(snapshot.latencyMs, 0) : '—'}
          hint="Capture → ingest, median on the reference clock"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Panel
            title="Sensor throughput"
            subtitle="Events per second per stream against the expected rate. A gap is a dropout in progress."
          >
            {snapshot.timeline.length > 0 && ctx ? (
              <SensorAvailabilityChart timeline={snapshot.timeline} sensors={ctx.sensors} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-dim">
                {running ? 'Buffering the first second of telemetry…' : 'Start the stream to see live throughput.'}
              </p>
            )}
          </Panel>

          <Panel
            title="Timestamp synchronization"
            subtitle={`Signed clock skew against the camera reference. Gate rejects above ${QUALITY_GATES.max_sync_p95_ms} ms p95.`}
          >
            {snapshot.syncSeries.length > 1 ? (
              <SyncDriftChart data={snapshot.syncSeries} height={200} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-dim">
                Needs a few seconds of data from at least two sensors.
              </p>
            )}
          </Panel>

          <Panel
            title="Live quality metrics"
            subtitle="Recomputed every 500 ms over the whole episode buffer, by the same engine the batch job uses."
          >
            {metrics && quality ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <MetricBar
                    label="Completeness"
                    value={metrics.completeness_pct}
                    detail={fmtPct(metrics.completeness_pct)}
                  />
                  <MetricBar
                    label="Validity"
                    value={metrics.validity_pct}
                    detail={fmtPct(metrics.validity_pct)}
                  />
                  <MetricBar
                    label="Synchronization"
                    value={quality.subscores.synchronization}
                    detail={`p95 ${fmtMs(metrics.sync_p95_ms)}`}
                  />
                  <MetricBar
                    label="Sensor health"
                    value={quality.subscores.sensor_health}
                    detail={quality.subscores.sensor_health.toFixed(1)}
                  />
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-ink-muted">Episode score so far</span>
                    <ScoreValue score={quality.score} className="text-2xl" />
                  </div>
                  <div className="mt-2">
                    <StatusBadge status={quality.status} />
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {quality.reasons.slice(0, 4).map((reason) => (
                      <li key={reason} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-dim" aria-hidden />
                        {reason}
                      </li>
                    ))}
                  </ul>
                  <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-dim">Duplicates</dt>
                      <dd className="tnum text-ink">{fmtPct(metrics.duplication_pct)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-dim">Out of order</dt>
                      <dd className="tnum text-ink">{fmtPct(metrics.out_of_order_pct)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-dim">Anomalies</dt>
                      <dd className="tnum text-ink">{snapshot.anomalies.length}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-dim">Duration</dt>
                      <dd className="tnum text-ink">{fmtDuration(metrics.duration_s)}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-ink-dim">
                {running ? 'Waiting for the first analysis window…' : 'No active episode.'}
              </p>
            )}
          </Panel>

          <Panel
            title="Event stream"
            subtitle="Raw ingest log — every warning and error, plus a sample of healthy traffic."
            bodyClassName="p-0"
          >
            <EventLog lines={snapshot.log} />
          </Panel>
        </div>

        {/* Right rail */}
        <div className="min-w-0 space-y-6">
          <Panel title="Data quality alerts" bodyClassName="p-0">
            <AlertPanel alerts={snapshot.alerts} />
          </Panel>

          {mode === 'demo' && (
            <Panel title="Demo script" subtitle="Scripted fault sequence, injected exactly like a random one.">
              <ol className="space-y-2">
                {DEMO_TIMELINE.map((step) => {
                  const reached = snapshot.elapsed >= step.at;
                  const current =
                    reached && snapshot.elapsed < step.at + 6 && snapshot.elapsed - step.at < 6;
                  return (
                    <li
                      key={step.at}
                      className={cx(
                        'rounded-md border px-3 py-2 transition-colors',
                        current
                          ? 'border-accent/40 bg-accent/10'
                          : reached
                            ? 'border-line bg-elevated/50'
                            : 'border-line/60',
                      )}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="tnum shrink-0 font-mono text-[11px] text-ink-dim">
                          t+{String(step.at).padStart(2, '0')}s
                        </span>
                        <span
                          className={cx(
                            'text-xs font-medium',
                            reached ? 'text-ink' : 'text-ink-dim',
                          )}
                        >
                          {step.title}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{step.detail}</p>
                    </li>
                  );
                })}
              </ol>
            </Panel>
          )}

          {snapshot.anomalies.length > 0 && (
            <Panel title={`Anomalies in this episode (${snapshot.anomalies.length})`} bodyClassName="p-0">
              <ul className="max-h-64 divide-y divide-line overflow-y-auto">
                {snapshot.anomalies.slice(0, 8).map((anomaly) => (
                  <li key={anomaly.id} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-ink">{anomaly.message}</span>
                      <Badge tone={severityTone(anomaly.severity)}>{anomaly.severity}</Badge>
                    </div>
                    {anomaly.detail && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{anomaly.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel
            title="Session dataset registry"
            subtitle="Episodes completed in this browser session."
          >
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-line bg-base px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wider text-ink-dim">Episodes</dt>
                <dd className="tnum mt-0.5 text-lg font-semibold text-ink">
                  {snapshot.registry.episodes}
                </dd>
              </div>
              <div className="rounded-md border border-line bg-base px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wider text-ink-dim">Events</dt>
                <dd className="tnum mt-0.5 text-lg font-semibold text-ink">
                  {fmtNumber(snapshot.registry.events)}
                </dd>
              </div>
              <div className="rounded-md border border-line bg-base px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wider text-ink-dim">Training ready</dt>
                <dd className="tnum mt-0.5 text-lg font-semibold text-good">
                  {snapshot.registry.training_ready}
                </dd>
              </div>
              <div className="rounded-md border border-line bg-base px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wider text-ink-dim">Rejected</dt>
                <dd className="tnum mt-0.5 text-lg font-semibold text-bad">
                  {snapshot.registry.rejected + snapshot.registry.flagged}
                </dd>
              </div>
            </dl>

            {snapshot.completed.length === 0 ? (
              <p className="mt-3 text-xs text-ink-dim">
                No episode has finished yet. Each one is scored and given a verdict the moment it
                closes.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {snapshot.completed.map((entry) => (
                  <li key={entry.summary.episode_id} className="rounded-md border border-line bg-base p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-ink">{entry.summary.episode_id}</span>
                      <StatusBadge status={entry.summary.status} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-ink-dim">
                      <span>{fmtDuration(entry.summary.duration_s)} · {entry.anomalies.length} anomalies</span>
                      <ScoreValue score={entry.summary.score} />
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                      {entry.quality.reasons[0]}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
