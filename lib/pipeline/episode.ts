import { clamp, mean, median, round } from '../format';
import {
  ALERT_THRESHOLDS,
  DROPOUT_GAP_MULTIPLIER,
  QUALITY_GATES,
  REFERENCE_SENSOR,
  SIM_RATES_HZ,
  VALUE_LIMITS,
} from './config';
import { computeQuality } from './quality';
import { analyseSynchronization, type TimingBySensor } from './sync';
import { validateEvent } from './validate';
import {
  CORE_SENSORS,
  type ActionSegment,
  type Anomaly,
  type CompletenessMetric,
  type Dropout,
  type Episode,
  type EpisodeMetrics,
  type EpisodeSummary,
  type MotionSample,
  type Sensor,
  type SensorHealth,
  type Severity,
  type SyncSample,
  type TelemetryEvent,
  type TimelineBucket,
  type ValidationIssue,
} from './types';

/**
 * Stage 6 — episode segmentation and assembly.
 *
 * An "episode" is one task attempt by one robot: navigate to Room 204, hand off
 * a tray, follow a nurse down a corridor. It is the unit a VLA model trains on,
 * so it is also the unit we accept or reject.
 *
 * This function takes the raw event stream *in arrival order* (arrival order
 * matters — that is how we detect out-of-order delivery) and produces
 * everything the platform needs downstream, then throws the raw events away
 * except for a small anomaly-biased sample. Real systems do the same: metrics
 * and manifests stay hot, raw frames go to object storage.
 */

export interface EpisodeContext {
  episode_id: string;
  robot_id: string;
  robot_model: string;
  site: string;
  environment: string;
  task: string;
  task_label: string;
  started_at: string;
  /** Unix seconds of episode t=0. */
  start_ts: number;
  /** Sensors the robot was *supposed* to publish — completeness is measured against this. */
  sensors: Sensor[];
}

const SEVERITY_ORDER: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

export interface StreamAnalysis {
  metrics: EpisodeMetrics;
  anomalies: Anomaly[];
  uniqueEvents: TelemetryEvent[];
  invalidSequences: Set<number>;
  timestampsBySensor: Partial<Record<Sensor, number[]>>;
  issues: ValidationIssue[];
  syncSeries: SyncSample[];
  firstTs: number;
}

export function analyseStream(events: TelemetryEvent[], ctx: EpisodeContext): StreamAnalysis {
  const seen = new Set<string>();
  const maxTimestampBySensor = new Map<Sensor, number>();
  /** (capture time, apparent latency) pairs per sensor, kept together so sorting cannot desync them. */
  const samplesBySensor: Partial<Record<Sensor, Array<[capture: number, latencyMs: number]>>> = {};
  const timestampsBySensor: Partial<Record<Sensor, number[]>> = {};
  const timings: TimingBySensor = {};
  const issues: ValidationIssue[] = [];
  const invalidSequences = new Set<number>();
  const uniqueEvents: TelemetryEvent[] = [];

  const perSensor = new Map<Sensor, { received: number; valid: number; warnings: number }>();
  const bump = (sensor: Sensor) => {
    const entry = perSensor.get(sensor) ?? { received: 0, valid: 0, warnings: 0 };
    perSensor.set(sensor, entry);
    return entry;
  };

  let duplicates = 0;
  let outOfOrder = 0;
  let validCount = 0;
  const latencies: number[] = [];

  for (const event of events) {
    // --- de-duplication (stream level, needs memory of what we've seen) ---
    const key = `${event.sensor}:${event.sequence_id}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);

    // --- ordering (arrival order vs capture order) ------------------------
    const previousMax = maxTimestampBySensor.get(event.sensor);
    if (previousMax !== undefined && event.timestamp < previousMax - 1e-9) {
      outOfOrder++;
    } else {
      maxTimestampBySensor.set(event.sensor, event.timestamp);
    }

    // --- record validation ------------------------------------------------
    const result = validateEvent(event);
    const entry = bump(event.sensor);
    entry.received++;
    for (const issue of result.issues) {
      issues.push(issue);
      if (issue.level === 'warning') entry.warnings++;
    }
    if (result.ok) {
      entry.valid++;
      validCount++;
    } else {
      invalidSequences.add(event.sequence_id);
    }

    const latencyMs = (event.ingest_timestamp - event.timestamp) * 1000;
    if (Number.isFinite(latencyMs)) latencies.push(latencyMs);

    uniqueEvents.push(event);
    if (Number.isFinite(event.timestamp)) {
      (samplesBySensor[event.sensor] ??= []).push([
        event.timestamp,
        Number.isFinite(latencyMs) ? latencyMs : 0,
      ]);
    }
  }

  // Capture order, not arrival order, for every timeline computation.
  for (const sensor of Object.keys(samplesBySensor) as Sensor[]) {
    const samples = samplesBySensor[sensor]!;
    samples.sort((a, b) => a[0] - b[0]);
    timestampsBySensor[sensor] = samples.map((s) => s[0]);
    timings[sensor] = {
      capture: timestampsBySensor[sensor]!,
      latency_ms: samples.map((s) => s[1]),
    };
  }

  // Spread-based Math.min/max would be both slow and unsafe at ~10k events.
  let firstTs = Number.POSITIVE_INFINITY;
  let lastTs = Number.NEGATIVE_INFINITY;
  for (const event of uniqueEvents) {
    if (!Number.isFinite(event.timestamp)) continue;
    if (event.timestamp < firstTs) firstTs = event.timestamp;
    if (event.timestamp > lastTs) lastTs = event.timestamp;
  }
  if (!Number.isFinite(firstTs)) {
    firstTs = ctx.start_ts;
    lastTs = ctx.start_ts;
  }
  const duration = Math.max(round(lastTs - firstTs, 2), 0);

  // --- completeness -------------------------------------------------------
  const completeness: CompletenessMetric[] = ctx.sensors.map((sensor) => {
    const expected = Math.max(1, Math.round(duration * SIM_RATES_HZ[sensor]));
    const received = timestampsBySensor[sensor]?.length ?? 0;
    return {
      sensor,
      expected,
      received,
      pct: round(clamp((received / expected) * 100, 0, 100), 2),
    };
  });
  const coreCompleteness = completeness.filter((c) =>
    (CORE_SENSORS as readonly Sensor[]).includes(c.sensor),
  );
  const completenessPct = round(
    mean((coreCompleteness.length ? coreCompleteness : completeness).map((c) => c.pct)),
    2,
  );

  // --- dropouts -----------------------------------------------------------
  const dropouts = detectDropouts(timestampsBySensor, ctx, firstTs, lastTs);

  // --- synchronization ----------------------------------------------------
  const sync = analyseSynchronization(timings, firstTs);

  // --- per-sensor health --------------------------------------------------
  const sensorHealth: SensorHealth[] = ctx.sensors.map((sensor) => {
    const stats = perSensor.get(sensor) ?? { received: 0, valid: 0, warnings: 0 };
    const completenessEntry = completeness.find((c) => c.sensor === sensor);
    const completenessPctForSensor = completenessEntry?.pct ?? 0;
    const validityPctForSensor = stats.received > 0 ? (stats.valid / stats.received) * 100 : 0;
    const sensorDropouts = dropouts.filter((d) => d.sensor === sensor);
    const longestGap = sensorDropouts.reduce((max, d) => Math.max(max, d.duration_ms), 0);

    const nominalIntervalMs = 1000 / SIM_RATES_HZ[sensor];
    const excessMs = Math.max(0, longestGap - nominalIntervalMs * DROPOUT_GAP_MULTIPLIER);
    const dropoutScore = clamp(100 - (excessMs / QUALITY_GATES.max_dropout_ms) * 100, 0, 100);

    return {
      sensor,
      score: round(
        clamp(
          0.45 * completenessPctForSensor + 0.35 * validityPctForSensor + 0.2 * dropoutScore,
          0,
          100,
        ),
        2,
      ),
      completeness_pct: round(completenessPctForSensor, 2),
      validity_pct: round(validityPctForSensor, 2),
      longest_gap_ms: round(longestGap, 1),
      dropout_count: sensorDropouts.length,
      events: stats.received,
    };
  });

  /*
   * Transport latency is measured on the REFERENCE sensor only, and as a median.
   *
   * Apparent latency is `ingest - capture`, so a sensor whose clock runs ahead
   * reports a smaller latency — and a badly drifting one reports a negative
   * value. Averaging across sensors therefore turns a clock problem into a
   * nonsense transport number (the demo episode produced -6 ms). Clock skew
   * belongs in the synchronization metrics; this number should answer only
   * "how long does an event take to reach the collector?".
   */
  const referenceLatencies = timings[REFERENCE_SENSOR]?.latency_ms;
  const latencySource =
    referenceLatencies && referenceLatencies.length > 0 ? referenceLatencies : latencies;

  const totalReceived = events.length;
  const issuesByCode: Record<string, number> = {};
  for (const issue of issues) {
    issuesByCode[issue.code] = (issuesByCode[issue.code] ?? 0) + 1;
  }

  const metrics: EpisodeMetrics = {
    events_total: totalReceived,
    events_valid: validCount,
    events_duplicate: duplicates,
    events_out_of_order: outOfOrder,
    duration_s: duration,
    completeness,
    completeness_pct: completenessPct,
    sync: sync.pairs,
    sync_mean_ms: sync.mean_ms,
    sync_p95_ms: sync.p95_ms,
    sync_p99_ms: sync.p99_ms,
    sync_max_ms: sync.max_ms,
    validity_pct: round(uniqueEvents.length ? (validCount / uniqueEvents.length) * 100 : 0, 2),
    duplication_pct: round(totalReceived ? (duplicates / totalReceived) * 100 : 0, 2),
    out_of_order_pct: round(totalReceived ? (outOfOrder / totalReceived) * 100 : 0, 2),
    sensor_health: sensorHealth,
    dropouts,
    issues_by_code: issuesByCode,
    ingest_latency_ms: round(median(latencySource), 2),
  };

  const anomalies = detectAnomalies(metrics, uniqueEvents, issues, ctx, firstTs);

  return {
    metrics,
    anomalies,
    uniqueEvents,
    invalidSequences,
    timestampsBySensor,
    issues,
    syncSeries: sync.series,
    firstTs,
  };
}

function detectDropouts(
  timestampsBySensor: Partial<Record<Sensor, number[]>>,
  ctx: EpisodeContext,
  start: number,
  end: number,
): Dropout[] {
  const dropouts: Dropout[] = [];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return dropouts;

  for (const sensor of ctx.sensors) {
    const times = timestampsBySensor[sensor];
    const rate = SIM_RATES_HZ[sensor];
    const intervalMs = 1000 / rate;
    const thresholdMs = intervalMs * DROPOUT_GAP_MULTIPLIER;

    if (!times || times.length === 0) {
      // A stream that never appeared is the most severe dropout there is.
      const span = end - start;
      dropouts.push({
        sensor,
        start_offset_s: 0,
        end_offset_s: round(span, 2),
        duration_ms: round(span * 1000, 1),
        missed_events: Math.round(span * rate),
      });
      continue;
    }

    for (let i = 1; i < times.length; i++) {
      const gapMs = (times[i]! - times[i - 1]!) * 1000;
      if (gapMs > thresholdMs) {
        dropouts.push({
          sensor,
          start_offset_s: round(times[i - 1]! - start, 2),
          end_offset_s: round(times[i]! - start, 2),
          duration_ms: round(gapMs, 1),
          missed_events: Math.max(0, Math.round((gapMs / 1000) * rate) - 1),
        });
      }
    }
  }

  return dropouts.sort((a, b) => b.duration_ms - a.duration_ms);
}

function detectAnomalies(
  metrics: EpisodeMetrics,
  events: TelemetryEvent[],
  issues: ValidationIssue[],
  ctx: EpisodeContext,
  firstTs: number,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  let counter = 0;
  const add = (a: Omit<Anomaly, 'id'>) => {
    anomalies.push({ ...a, id: `${ctx.episode_id}-a${++counter}` });
  };

  // --- sensor dropouts ---------------------------------------------------
  for (const dropout of metrics.dropouts) {
    if (dropout.duration_ms < ALERT_THRESHOLDS.dropout_ms) continue;
    const severity: Severity =
      dropout.duration_ms > QUALITY_GATES.max_dropout_ms
        ? 'CRITICAL'
        : dropout.duration_ms > 600
          ? 'HIGH'
          : 'MEDIUM';
    add({
      kind: 'SENSOR_DROPOUT',
      sensor: dropout.sensor,
      severity,
      message: `${dropout.sensor.toUpperCase()} dropout: ${(dropout.duration_ms / 1000).toFixed(2)} s`,
      detail: `Stream stopped at t+${dropout.start_offset_s.toFixed(1)}s and resumed at t+${dropout.end_offset_s.toFixed(1)}s, missing ~${dropout.missed_events} events`,
      start_offset_s: dropout.start_offset_s,
      end_offset_s: dropout.end_offset_s,
      count: dropout.missed_events,
    });
  }

  // --- synchronization drift ---------------------------------------------
  for (const pair of metrics.sync) {
    if (pair.p95_ms <= ALERT_THRESHOLDS.sync_p95_ms) continue;
    const severity: Severity =
      pair.p95_ms > QUALITY_GATES.max_sync_p95_ms
        ? 'HIGH'
        : pair.p95_ms > ALERT_THRESHOLDS.sync_p95_ms * 1.4
          ? 'MEDIUM'
          : 'LOW';
    const constantOffset = Math.abs(pair.offset_ms) > pair.p95_ms * 0.6;
    add({
      kind: 'TIMESTAMP_DRIFT',
      sensor: pair.from === 'camera' ? pair.to : pair.from,
      severity,
      message: `Timestamp drift ${pair.pair}: p95 ${pair.p95_ms.toFixed(1)} ms`,
      detail: constantOffset
        ? `Median offset ${pair.offset_ms.toFixed(1)} ms is a constant clock skew — a time-sync (PTP/NTP) problem, not jitter`
        : `Median offset ${pair.offset_ms.toFixed(1)} ms with p99 ${pair.p99_ms.toFixed(1)} ms — transport jitter rather than clock skew`,
      start_offset_s: 0,
      end_offset_s: metrics.duration_s,
      count: pair.samples,
    });
  }

  // --- duplicates / ordering ---------------------------------------------
  if (metrics.duplication_pct > 0.5) {
    add({
      kind: 'DUPLICATE_EVENTS',
      sensor: 'system',
      severity: metrics.duplication_pct > QUALITY_GATES.max_duplication_pct ? 'HIGH' : 'MEDIUM',
      message: `${metrics.events_duplicate} duplicate events (${metrics.duplication_pct.toFixed(1)}%)`,
      detail: 'Repeated sequence IDs — at-least-once delivery without idempotent consumption',
      start_offset_s: 0,
      end_offset_s: metrics.duration_s,
      count: metrics.events_duplicate,
    });
  }

  if (metrics.out_of_order_pct > 0.5) {
    add({
      kind: 'OUT_OF_ORDER',
      sensor: 'system',
      severity: metrics.out_of_order_pct > QUALITY_GATES.max_out_of_order_pct ? 'HIGH' : 'MEDIUM',
      message: `${metrics.events_out_of_order} out-of-order events (${metrics.out_of_order_pct.toFixed(1)}%)`,
      detail: 'Events arrived with timestamps older than events already processed for the same sensor',
      start_offset_s: 0,
      end_offset_s: metrics.duration_s,
      count: metrics.events_out_of_order,
    });
  }

  // --- invalid values -----------------------------------------------------
  const errorIssues = issues.filter((i) => i.level === 'error');
  if (errorIssues.length > 0 && metrics.validity_pct < 100) {
    const byCode = new Map<string, number>();
    for (const issue of errorIssues) byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1);
    const top = [...byCode.entries()].sort((a, b) => b[1] - a[1]);
    add({
      kind: 'INVALID_VALUES',
      sensor: errorIssues[0]!.sensor,
      severity: metrics.validity_pct < QUALITY_GATES.min_validity_pct ? 'HIGH' : 'MEDIUM',
      message: `${errorIssues.length} records failed validation (${(100 - metrics.validity_pct).toFixed(1)}%)`,
      detail: top.map(([code, count]) => `${code} ×${count}`).join(', '),
      start_offset_s: 0,
      end_offset_s: metrics.duration_s,
      count: errorIssues.length,
    });
  }

  // --- camera degradation -------------------------------------------------
  const cameraFrames = events.filter((e) => e.sensor === 'camera').length;
  const degraded = issues.filter((i) => i.code === 'CAMERA_DEGRADED').length;
  if (cameraFrames > 0 && degraded / cameraFrames > 0.05) {
    add({
      kind: 'CAMERA_DEGRADATION',
      sensor: 'camera',
      severity: degraded / cameraFrames > 0.35 ? 'HIGH' : 'MEDIUM',
      message: `${((degraded / cameraFrames) * 100).toFixed(1)}% of frames below blur/exposure thresholds`,
      detail: 'Motion blur or exposure swings reduce the value of these frames for visual grounding',
      start_offset_s: 0,
      end_offset_s: metrics.duration_s,
      count: degraded,
    });
  }

  // --- velocity safety limit ---------------------------------------------
  const velocityIssues = issues.filter((i) => i.code === 'VELOCITY_LIMIT_EXCEEDED');
  if (velocityIssues.length > 0) {
    const first = velocityIssues[0]!;
    add({
      kind: 'VELOCITY_LIMIT',
      sensor: 'action',
      severity: 'HIGH',
      message: `Velocity safety limit exceeded ${velocityIssues.length}×`,
      detail: first.detail,
      start_offset_s: round(first.timestamp - firstTs, 2),
      end_offset_s: round(velocityIssues[velocityIssues.length - 1]!.timestamp - firstTs, 2),
      count: velocityIssues.length,
    });
  }

  // --- battery discontinuity ---------------------------------------------
  const batterySeries = events
    .filter((e) => e.sensor === 'battery')
    .sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 1; i < batterySeries.length; i++) {
    const prev = batterySeries[i - 1]!;
    const curr = batterySeries[i]!;
    if (prev.sensor !== 'battery' || curr.sensor !== 'battery') continue;
    const dt = curr.timestamp - prev.timestamp;
    if (dt <= 0) continue;
    const dropRate = (prev.payload.percent - curr.payload.percent) / dt;
    if (dropRate > VALUE_LIMITS.max_battery_drop_pct_per_s) {
      add({
        kind: 'BATTERY_ANOMALY',
        sensor: 'battery',
        severity: dropRate > 4 ? 'CRITICAL' : 'HIGH',
        message: `Battery dropped ${(prev.payload.percent - curr.payload.percent).toFixed(1)}% in ${dt.toFixed(1)} s`,
        detail: `${dropRate.toFixed(1)} %/s discharge is not physical — likely a cell fault or a bad state-of-charge estimate`,
        start_offset_s: round(prev.timestamp - firstTs, 2),
        end_offset_s: round(curr.timestamp - firstTs, 2),
      });
      break;
    }
  }

  // --- action ↔ odometry disagreement ------------------------------------
  const mismatch = detectActionStateMismatch(events, firstTs);
  if (mismatch) add(mismatch);

  // --- low per-sensor completeness ---------------------------------------
  for (const entry of metrics.completeness) {
    if (!(CORE_SENSORS as readonly Sensor[]).includes(entry.sensor)) continue;
    if (entry.pct >= 95) continue;
    add({
      kind: 'LOW_COMPLETENESS',
      sensor: entry.sensor,
      severity: entry.pct < QUALITY_GATES.min_completeness_pct ? 'HIGH' : 'LOW',
      message: `${entry.sensor.toUpperCase()} completeness ${entry.pct.toFixed(1)}%`,
      detail: `Received ${entry.received} of ~${entry.expected} expected samples (${entry.expected - entry.received} missing)`,
      start_offset_s: 0,
      end_offset_s: metrics.duration_s,
      count: entry.expected - entry.received,
    });
  }

  return anomalies.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
}

/**
 * A commanded STOP does not stop a walking robot instantly — it decelerates over
 * roughly a second. Flagging motion immediately after the command would fire on
 * almost every episode (it did: 122 of 200 before this grace period existed).
 */
const STOP_SETTLE_S = 0.8;
/** Ignore STOP windows too short for the base to have settled at all. */
const MIN_STOP_WINDOW_S = 1.6;
/**
 * Minimum baseline for a speed estimate.
 *
 * Odometry carries ~4 mm of position noise. Differentiating between consecutive
 * 25 Hz samples divides that by dt = 0.04 s and manufactures ~0.18 m/s of
 * phantom speed — far above the 0.06 m/s threshold, which is why the naive
 * version flagged 121 of 200 episodes. Measuring net displacement over a
 * half-second baseline divides the same noise by 0.5 s instead, leaving
 * ~0.016 m/s. Differentiating a noisy signal is the mistake; widen the window.
 */
const SPEED_BASELINE_S = 0.5;

/**
 * The label-integrity check: if the action stream says STOP and the base is
 * still moving a full second later, one of the two is lying. Either way the
 * episode teaches a policy the wrong thing, so it has to be caught before
 * training — action labels are the supervision signal for a VLA model.
 */
function detectActionStateMismatch(events: TelemetryEvent[], firstTs: number): Omit<Anomaly, 'id'> | null {
  const stops = events
    .filter((e): e is Extract<TelemetryEvent, { sensor: 'action' }> => e.sensor === 'action')
    .filter((e) => e.payload.action === 'STOP')
    .sort((a, b) => a.timestamp - b.timestamp);
  if (stops.length === 0) return null;

  const odometry = events
    .filter((e): e is Extract<TelemetryEvent, { sensor: 'odometry' }> => e.sensor === 'odometry')
    .sort((a, b) => a.timestamp - b.timestamp);
  if (odometry.length < 2) return null;

  // Merge consecutive STOP commands into contiguous windows, keep only windows
  // long enough to judge, and skip the settling period at the start of each.
  const stopWindows = mergeWindows(stops.map((s) => [s.timestamp, s.timestamp + 0.25] as const))
    .filter(([a, b]) => b - a >= MIN_STOP_WINDOW_S)
    .map(([a, b]) => [a + STOP_SETTLE_S, b] as [number, number]);
  if (stopWindows.length === 0) return null;

  let worstSpeed = 0;
  let worstAt = 0;
  for (const [windowStart, windowEnd] of stopWindows) {
    const inWindow = odometry.filter(
      (o) =>
        o.timestamp >= windowStart &&
        o.timestamp <= windowEnd &&
        Number.isFinite(o.payload.x) &&
        Number.isFinite(o.payload.y),
    );
    if (inWindow.length < 2) continue;

    const first = inWindow[0]!;
    const last = inWindow[inWindow.length - 1]!;
    const span = last.timestamp - first.timestamp;
    if (span < SPEED_BASELINE_S) continue;

    const dx = last.payload.x - first.payload.x;
    const dy = last.payload.y - first.payload.y;
    const speed = Math.sqrt(dx * dx + dy * dy) / span;
    if (Number.isFinite(speed) && speed > worstSpeed) {
      worstSpeed = speed;
      worstAt = first.timestamp;
    }
  }

  if (worstSpeed <= VALUE_LIMITS.stop_motion_epsilon_mps) return null;

  return {
    kind: 'ACTION_STATE_MISMATCH',
    sensor: 'system',
    severity: worstSpeed > 0.2 ? 'HIGH' : 'MEDIUM',
    message: `Action says STOP but odometry shows ${worstSpeed.toFixed(2)} m/s`,
    detail: `Measured ${STOP_SETTLE_S.toFixed(1)}s after the STOP command, well past normal deceleration — the action labels for this window cannot be trusted as supervision`,
    start_offset_s: round(worstAt - firstTs, 2),
    end_offset_s: round(worstAt - firstTs, 2),
  };
}

function mergeWindows(windows: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Derived series                                                      */
/* ------------------------------------------------------------------ */

export function buildTimeline(
  events: TelemetryEvent[],
  invalidSequences: Set<number>,
  firstTs: number,
  duration: number,
): TimelineBucket[] {
  const bucketCount = Math.max(1, Math.ceil(duration));
  const buckets: TimelineBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    offset_s: i,
    camera: 0,
    lidar: 0,
    imu: 0,
    odometry: 0,
    invalid: 0,
  }));

  for (const event of events) {
    const index = clamp(Math.floor(event.timestamp - firstTs), 0, bucketCount - 1);
    const bucket = buckets[index]!;
    if (event.sensor === 'camera' || event.sensor === 'lidar' || event.sensor === 'imu' || event.sensor === 'odometry') {
      bucket[event.sensor] += 1;
    }
    if (invalidSequences.has(event.sequence_id)) bucket.invalid += 1;
  }

  return buckets;
}

export function buildActionSegments(events: TelemetryEvent[], firstTs: number): ActionSegment[] {
  const actions = events
    .filter((e): e is Extract<TelemetryEvent, { sensor: 'action' }> => e.sensor === 'action')
    .sort((a, b) => a.timestamp - b.timestamp);
  if (actions.length === 0) return [];

  const segments: ActionSegment[] = [];
  let current: { action: ActionSegment['action']; start: number; end: number; linear: number[]; angular: number[] } | null =
    null;

  for (const event of actions) {
    if (!current || current.action !== event.payload.action) {
      if (current) {
        segments.push(finaliseSegment(current, firstTs));
      }
      current = {
        action: event.payload.action,
        start: event.timestamp,
        end: event.timestamp,
        linear: [],
        angular: [],
      };
    }
    current.end = event.timestamp;
    if (Number.isFinite(event.payload.linear_velocity)) current.linear.push(event.payload.linear_velocity);
    if (Number.isFinite(event.payload.angular_velocity)) current.angular.push(event.payload.angular_velocity);
  }
  if (current) segments.push(finaliseSegment(current, firstTs));

  return segments;
}

function finaliseSegment(
  segment: { action: ActionSegment['action']; start: number; end: number; linear: number[]; angular: number[] },
  firstTs: number,
): ActionSegment {
  return {
    action: segment.action,
    start_offset_s: round(segment.start - firstTs, 2),
    end_offset_s: round(segment.end - firstTs, 2),
    mean_linear_velocity: round(mean(segment.linear), 3),
    mean_angular_velocity: round(mean(segment.angular), 3),
  };
}

export function buildMotionSeries(
  events: TelemetryEvent[],
  firstTs: number,
  duration: number,
): MotionSample[] {
  const bucketCount = Math.max(1, Math.ceil(duration));
  const linear: number[][] = Array.from({ length: bucketCount }, () => []);
  const angular: number[][] = Array.from({ length: bucketCount }, () => []);
  const battery: number[][] = Array.from({ length: bucketCount }, () => []);

  for (const event of events) {
    const index = clamp(Math.floor(event.timestamp - firstTs), 0, bucketCount - 1);
    if (event.sensor === 'action') {
      if (Number.isFinite(event.payload.linear_velocity)) linear[index]!.push(event.payload.linear_velocity);
      if (Number.isFinite(event.payload.angular_velocity)) angular[index]!.push(event.payload.angular_velocity);
    } else if (event.sensor === 'battery' && Number.isFinite(event.payload.percent)) {
      battery[index]!.push(event.payload.percent);
    }
  }

  let lastBattery = 100;
  return Array.from({ length: bucketCount }, (_, i) => {
    if (battery[i]!.length > 0) lastBattery = mean(battery[i]!);
    return {
      offset_s: i,
      linear: round(mean(linear[i]!), 3),
      angular: round(mean(angular[i]!), 3),
      battery: round(lastBattery, 2),
    };
  });
}

/**
 * Keep a small, deliberately anomaly-biased sample of raw events so the episode
 * detail page can show real records. Everything else is dropped — in production
 * the full stream would already be in object storage as MCAP/Parquet.
 */
export function sampleEvents(
  events: TelemetryEvent[],
  invalidSequences: Set<number>,
  limit = 24,
): TelemetryEvent[] {
  const flagged = events.filter((e) => invalidSequences.has(e.sequence_id)).slice(0, Math.floor(limit * 0.6));
  const remaining = limit - flagged.length;
  const healthy = events.filter((e) => !invalidSequences.has(e.sequence_id));
  const stride = Math.max(1, Math.floor(healthy.length / Math.max(1, remaining)));
  const sampled: TelemetryEvent[] = [];
  for (let i = 0; i < healthy.length && sampled.length < remaining; i += stride) {
    sampled.push(healthy[i]!);
  }
  return [...flagged, ...sampled].sort((a, b) => a.timestamp - b.timestamp);
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

export function buildEpisode(events: TelemetryEvent[], ctx: EpisodeContext): Episode {
  const analysis = analyseStream(events, ctx);
  const quality = computeQuality(analysis.metrics, analysis.anomalies);
  const firstTs = analysis.firstTs;
  const duration = analysis.metrics.duration_s;

  return {
    episode_id: ctx.episode_id,
    robot_id: ctx.robot_id,
    robot_model: ctx.robot_model,
    site: ctx.site,
    environment: ctx.environment,
    task: ctx.task,
    task_label: ctx.task_label,
    started_at: ctx.started_at,
    duration_s: duration,
    sensors: ctx.sensors,
    metrics: analysis.metrics,
    quality,
    anomalies: analysis.anomalies,
    actions: buildActionSegments(analysis.uniqueEvents, firstTs),
    timeline: buildTimeline(analysis.uniqueEvents, analysis.invalidSequences, firstTs, duration),
    sync_series: analysis.syncSeries,
    motion_series: buildMotionSeries(analysis.uniqueEvents, firstTs, duration),
    event_samples: sampleEvents(analysis.uniqueEvents, analysis.invalidSequences),
  };
}

export function toSummary(episode: Episode): EpisodeSummary {
  return {
    episode_id: episode.episode_id,
    robot_id: episode.robot_id,
    site: episode.site,
    task: episode.task,
    task_label: episode.task_label,
    started_at: episode.started_at,
    duration_s: episode.duration_s,
    sensors: episode.sensors,
    score: episode.quality.score,
    grade: episode.quality.grade,
    status: episode.quality.status,
    events_total: episode.metrics.events_total,
    anomaly_count: episode.anomalies.length,
    top_reason: episode.quality.reasons[0] ?? '',
  };
}
