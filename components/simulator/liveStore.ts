import { ALERT_THRESHOLDS, QUALITY_GATES, SIM_RATES_HZ } from '@/lib/pipeline/config';
import {
  analyseStream,
  buildEpisode,
  buildTimeline,
  toSummary,
  type EpisodeContext,
} from '@/lib/pipeline/episode';
import { computeQuality } from '@/lib/pipeline/quality';
import { validateEvent } from '@/lib/pipeline/validate';
import type {
  Anomaly,
  EpisodeMetrics,
  EpisodeSummary,
  QualityReport,
  Sensor,
  SyncSample,
  TelemetryEvent,
  TimelineBucket,
} from '@/lib/pipeline/types';
import type { Fault } from '@/lib/sim/generator';

/**
 * The live consumer.
 *
 * The server streams raw telemetry and nothing else; every metric on the
 * simulator page is computed here, in the browser, by the same pipeline modules
 * the offline seed job calls. That is the main thing this component is meant to
 * demonstrate — one implementation of validation, synchronization, quality
 * scoring and episode assembly, driven by two very different callers.
 *
 * Telemetry arrives at ~190 events/second, far too fast to re-render on. Mutable
 * state lives in this class; the React layer pulls an immutable snapshot on a
 * fixed interval.
 */

export type ConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

export interface LogLine {
  key: string;
  timestamp: number;
  sensor: Sensor;
  sequence_id: number;
  level: 'OK' | 'WARNING' | 'ERROR';
  message: string;
}

export interface LiveAlert {
  id: string;
  level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'RESOLVED';
  title: string;
  detail: string;
  episode_id: string;
  at: number;
}

export interface CompletedEpisode {
  summary: EpisodeSummary;
  quality: QualityReport;
  anomalies: Anomaly[];
  at: number;
}

export interface RegistryTally {
  episodes: number;
  training_ready: number;
  flagged: number;
  rejected: number;
  events: number;
}

export interface LiveSnapshot {
  connection: ConnectionState;
  ctx: EpisodeContext | null;
  profile: string | null;
  faults: Fault[];
  plannedDuration: number;
  elapsed: number;
  eventsReceived: number;
  eventsPerSecond: number;
  latencyMs: number;
  sensorsUp: number;
  sensorsExpected: number;
  sensorStatus: Array<{ sensor: Sensor; up: boolean }>;
  metrics: EpisodeMetrics | null;
  quality: QualityReport | null;
  anomalies: Anomaly[];
  syncSeries: SyncSample[];
  timeline: TimelineBucket[];
  log: LogLine[];
  alerts: LiveAlert[];
  completed: CompletedEpisode[];
  registry: RegistryTally;
}

const LOG_LIMIT = 140;
const ALERT_LIMIT = 30;
const COMPLETED_LIMIT = 8;
/** Log one in N healthy events; every problem event is always logged. */
const HEALTHY_LOG_SAMPLING = 12;

export const EMPTY_SNAPSHOT: LiveSnapshot = {
  connection: 'idle',
  ctx: null,
  profile: null,
  faults: [],
  plannedDuration: 0,
  elapsed: 0,
  eventsReceived: 0,
  eventsPerSecond: 0,
  latencyMs: 0,
  sensorsUp: 0,
  sensorsExpected: 0,
  sensorStatus: [],
  metrics: null,
  quality: null,
  anomalies: [],
  syncSeries: [],
  timeline: [],
  log: [],
  alerts: [],
  completed: [],
  registry: { episodes: 0, training_ready: 0, flagged: 0, rejected: 0, events: 0 },
};

export class LiveStore {
  /**
   * Connection state lives here rather than in React state so that subscribing
   * to the stream never has to call setState from inside an effect body — the
   * component pulls it with everything else on the snapshot interval.
   */
  private connection: ConnectionState = 'idle';
  private ctx: EpisodeContext | null = null;
  private profile: string | null = null;
  private faults: Fault[] = [];
  private plannedDuration = 0;
  private episodeStartedAt = 0;

  private events: TelemetryEvent[] = [];
  private log: LogLine[] = [];
  private alerts: LiveAlert[] = [];
  private completed: CompletedEpisode[] = [];
  private registry: RegistryTally = { episodes: 0, training_ready: 0, flagged: 0, rejected: 0, events: 0 };

  private metrics: EpisodeMetrics | null = null;
  private quality: QualityReport | null = null;
  private anomalies: Anomaly[] = [];
  private syncSeries: SyncSample[] = [];
  private timeline: TimelineBucket[] = [];

  private lastSeen = new Map<Sensor, number>();
  private downSince = new Map<Sensor, number>();
  private activeAlertKeys = new Set<string>();
  private arrivals: number[] = [];
  private healthyLogCounter = 0;
  private sequence = 0;

  setConnection(state: ConnectionState): void {
    // Once live, a transport hiccup is a reconnect, not a fresh failure.
    if (state === 'error' && this.connection === 'live') {
      this.connection = 'reconnecting';
      return;
    }
    this.connection = state;
  }

  reset(): void {
    this.connection = 'idle';
    this.ctx = null;
    this.profile = null;
    this.faults = [];
    this.plannedDuration = 0;
    this.events = [];
    this.log = [];
    this.alerts = [];
    this.completed = [];
    this.registry = { episodes: 0, training_ready: 0, flagged: 0, rejected: 0, events: 0 };
    this.metrics = null;
    this.quality = null;
    this.anomalies = [];
    this.syncSeries = [];
    this.timeline = [];
    this.lastSeen.clear();
    this.downSince.clear();
    this.activeAlertKeys.clear();
    this.arrivals = [];
  }

  /* ---------------------------------------------------------------- */
  /* Stream handlers                                                   */
  /* ---------------------------------------------------------------- */

  onEpisodeStart(payload: {
    ctx: EpisodeContext;
    profile: string;
    faults: Fault[];
    duration_s: number;
  }): void {
    this.ctx = payload.ctx;
    this.profile = payload.profile;
    this.faults = payload.faults;
    this.plannedDuration = payload.duration_s;
    this.episodeStartedAt = Date.now();

    this.events = [];
    this.metrics = null;
    this.quality = null;
    this.anomalies = [];
    this.syncSeries = [];
    this.timeline = [];
    this.lastSeen.clear();
    this.downSince.clear();
    this.activeAlertKeys.clear();

    const now = Date.now();
    for (const sensor of payload.ctx.sensors) this.lastSeen.set(sensor, now);
  }

  onTelemetry(events: TelemetryEvent[]): void {
    const now = Date.now();

    for (const event of events) {
      this.events.push(event);
      this.arrivals.push(now);
      this.registry.events += 1;

      // A sensor that was down is back the moment one of its events lands.
      if (this.downSince.has(event.sensor)) {
        const downAt = this.downSince.get(event.sensor)!;
        this.downSince.delete(event.sensor);
        this.clearAlert(`dropout:${event.sensor}`);
        this.pushAlert({
          level: 'RESOLVED',
          title: `${event.sensor.toUpperCase()} stream restored`,
          detail: `Data quality recovered after ${((now - downAt) / 1000).toFixed(1)} s without data.`,
        });
      }
      this.lastSeen.set(event.sensor, now);

      this.appendLog(event);
    }

    // Keep only the last two seconds of arrivals for the rate readout.
    const cutoff = now - 2000;
    if (this.arrivals.length > 0 && this.arrivals[0]! < cutoff) {
      this.arrivals = this.arrivals.filter((at) => at >= cutoff);
    }
  }

  onEpisodeEnd(): void {
    if (!this.ctx || this.events.length === 0) return;

    const episode = buildEpisode(this.events, this.ctx);
    this.completed.unshift({
      summary: toSummary(episode),
      quality: episode.quality,
      anomalies: episode.anomalies,
      at: Date.now(),
    });
    if (this.completed.length > COMPLETED_LIMIT) this.completed.length = COMPLETED_LIMIT;

    this.registry.episodes += 1;
    if (episode.quality.status === 'TRAINING_READY') this.registry.training_ready += 1;
    else if (episode.quality.status === 'FLAGGED') this.registry.flagged += 1;
    else this.registry.rejected += 1;

    this.pushAlert({
      level: episode.quality.status === 'REJECTED' ? 'HIGH' : 'RESOLVED',
      title: `${episode.episode_id} → ${episode.quality.status.replace('_', ' ')}`,
      detail: episode.quality.reasons[0] ?? `Scored ${episode.quality.score.toFixed(1)}.`,
    });

    this.ctx = null;
    this.metrics = null;
    this.quality = null;
  }

  /* ---------------------------------------------------------------- */
  /* Periodic recompute                                                */
  /* ---------------------------------------------------------------- */

  tick(): void {
    this.detectDropouts();

    if (!this.ctx || this.events.length === 0) return;

    const analysis = analyseStream(this.events, this.ctx);
    this.metrics = analysis.metrics;
    this.anomalies = analysis.anomalies;
    this.quality = computeQuality(analysis.metrics, analysis.anomalies);
    this.syncSeries = analysis.syncSeries;
    this.timeline = buildTimeline(
      analysis.uniqueEvents,
      analysis.invalidSequences,
      analysis.firstTs,
      analysis.metrics.duration_s,
    );

    this.checkThresholdAlerts(analysis.metrics);
  }

  /** Live dropout detection from arrival times — not from the batch analysis. */
  private detectDropouts(): void {
    if (!this.ctx) return;
    const now = Date.now();

    for (const sensor of this.ctx.sensors) {
      const seen = this.lastSeen.get(sensor);
      if (seen === undefined) continue;
      const interval = 1000 / SIM_RATES_HZ[sensor];
      const threshold = Math.max(ALERT_THRESHOLDS.dropout_ms, interval * 5);
      const silentFor = now - seen;

      if (silentFor > threshold && !this.downSince.has(sensor)) {
        this.downSince.set(sensor, seen);
        this.pushAlert({
          key: `dropout:${sensor}`,
          level: silentFor > QUALITY_GATES.max_dropout_ms ? 'CRITICAL' : 'HIGH',
          title: `${sensor.toUpperCase()} dropout`,
          detail: `No data for ${(silentFor / 1000).toFixed(2)} s — gate rejects at ${(QUALITY_GATES.max_dropout_ms / 1000).toFixed(1)} s.`,
        });
      }
    }
  }

  private checkThresholdAlerts(metrics: EpisodeMetrics): void {
    // Synchronization
    if (metrics.sync_p95_ms > ALERT_THRESHOLDS.sync_p95_ms) {
      const worst = [...metrics.sync].sort((a, b) => b.p95_ms - a.p95_ms)[0];
      this.pushAlert({
        key: 'sync',
        level: metrics.sync_p95_ms > QUALITY_GATES.max_sync_p95_ms ? 'HIGH' : 'MEDIUM',
        title: `Sensor synchronization — ${worst?.pair ?? 'cross-sensor'}`,
        detail: `p95 ${metrics.sync_p95_ms.toFixed(1)} ms against a ${ALERT_THRESHOLDS.sync_p95_ms} ms alert threshold (gate ${QUALITY_GATES.max_sync_p95_ms} ms).`,
      });
    } else if (this.activeAlertKeys.has('sync')) {
      this.clearAlert('sync');
      this.pushAlert({
        level: 'RESOLVED',
        title: 'Synchronization back within threshold',
        detail: `Cross-sensor p95 is ${metrics.sync_p95_ms.toFixed(1)} ms.`,
      });
    }

    // Validity
    const invalidPct = 100 - metrics.validity_pct;
    if (invalidPct > ALERT_THRESHOLDS.invalid_rate_pct) {
      this.pushAlert({
        key: 'validity',
        level: metrics.validity_pct < QUALITY_GATES.min_validity_pct ? 'HIGH' : 'MEDIUM',
        title: 'Invalid records',
        detail: `${invalidPct.toFixed(1)}% of records are failing validation (gate ≥ ${QUALITY_GATES.min_validity_pct}% valid).`,
      });
    } else if (this.activeAlertKeys.has('validity')) {
      this.clearAlert('validity');
    }

    // Duplicates
    if (metrics.duplication_pct > 1) {
      this.pushAlert({
        key: 'duplication',
        level: metrics.duplication_pct > QUALITY_GATES.max_duplication_pct ? 'HIGH' : 'MEDIUM',
        title: 'Duplicate events',
        detail: `${metrics.events_duplicate} repeated sequence IDs (${metrics.duplication_pct.toFixed(1)}%).`,
      });
    } else if (this.activeAlertKeys.has('duplication')) {
      this.clearAlert('duplication');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  private appendLog(event: TelemetryEvent): void {
    const result = validateEvent(event);
    const errors = result.issues.filter((issue) => issue.level === 'error');
    const warnings = result.issues.filter((issue) => issue.level === 'warning');

    let level: LogLine['level'] = 'OK';
    let message = 'accepted';
    if (errors.length > 0) {
      level = 'ERROR';
      message = errors[0]!.detail;
    } else if (warnings.length > 0) {
      level = 'WARNING';
      message = warnings[0]!.detail;
    } else if (this.healthyLogCounter++ % HEALTHY_LOG_SAMPLING !== 0) {
      // Sample healthy traffic so the log stays readable at ~190 events/s.
      return;
    }

    this.log.unshift({
      key: `${event.sequence_id}-${this.sequence++}`,
      timestamp: event.timestamp,
      sensor: event.sensor,
      sequence_id: event.sequence_id,
      level,
      message,
    });
    if (this.log.length > LOG_LIMIT) this.log.length = LOG_LIMIT;
  }

  private pushAlert(alert: {
    key?: string;
    level: LiveAlert['level'];
    title: string;
    detail: string;
  }): void {
    if (alert.key) {
      if (this.activeAlertKeys.has(alert.key)) return;
      this.activeAlertKeys.add(alert.key);
    }
    this.alerts.unshift({
      id: `${alert.key ?? 'event'}-${this.sequence++}`,
      level: alert.level,
      title: alert.title,
      detail: alert.detail,
      episode_id: this.ctx?.episode_id ?? '—',
      at: Date.now(),
    });
    if (this.alerts.length > ALERT_LIMIT) this.alerts.length = ALERT_LIMIT;
  }

  private clearAlert(key: string): void {
    this.activeAlertKeys.delete(key);
  }

  /* ---------------------------------------------------------------- */
  /* Snapshot                                                          */
  /* ---------------------------------------------------------------- */

  snapshot(): LiveSnapshot {
    const now = Date.now();
    const windowMs = 2000;
    const recent = this.arrivals.length;
    const sensors = this.ctx?.sensors.filter((s) => s !== 'action' && s !== 'battery') ?? [];
    const sensorStatus = sensors.map((sensor) => ({
      sensor,
      up: !this.downSince.has(sensor),
    }));

    return {
      connection: this.connection,
      ctx: this.ctx,
      profile: this.profile,
      faults: this.faults,
      plannedDuration: this.plannedDuration,
      elapsed: this.ctx ? (now - this.episodeStartedAt) / 1000 : 0,
      eventsReceived: this.events.length,
      eventsPerSecond: Math.round((recent / windowMs) * 1000),
      // Single source of truth: the pipeline's own reference-clock measurement.
      latencyMs: this.metrics?.ingest_latency_ms ?? 0,
      sensorsUp: sensorStatus.filter((entry) => entry.up).length,
      sensorsExpected: sensorStatus.length,
      sensorStatus,
      metrics: this.metrics,
      quality: this.quality,
      anomalies: this.anomalies,
      syncSeries: this.syncSeries,
      timeline: this.timeline,
      log: this.log,
      alerts: this.alerts,
      completed: this.completed,
      registry: this.registry,
    };
  }
}
