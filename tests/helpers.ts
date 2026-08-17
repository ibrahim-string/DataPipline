import { SIM_RATES_HZ } from '@/lib/pipeline/config';
import type { EpisodeContext } from '@/lib/pipeline/episode';
import type {
  CompletenessMetric,
  EpisodeMetrics,
  Sensor,
  SensorHealth,
  TelemetryEvent,
} from '@/lib/pipeline/types';

/** Fixed episode start so every assertion is on stable numbers. */
export const START = 1_750_000_000;
/** Constant transport latency, in seconds. Zero jitter keeps sync tests exact. */
export const LATENCY = 0.03;

export const ALL_SENSORS: Sensor[] = ['camera', 'lidar', 'imu', 'odometry', 'action', 'battery'];

export function makeContext(overrides: Partial<EpisodeContext> = {}): EpisodeContext {
  return {
    episode_id: 'episode-test',
    robot_id: 'robot-test',
    robot_model: 'test-model',
    site: 'Test Site',
    environment: 'Test Environment',
    task: 'navigate_to_room',
    task_label: 'Navigate to Room 204',
    started_at: new Date(START * 1000).toISOString(),
    start_ts: START,
    sensors: [...ALL_SENSORS],
    ...overrides,
  };
}

function defaultPayload(sensor: Sensor, index: number): TelemetryEvent['payload'] {
  switch (sensor) {
    case 'camera':
      return { frame_id: 1000 + index, width: 1280, height: 720, blur_score: 0.8, exposure_score: 0.88 };
    case 'lidar':
      return { points: 18_000, range_min: 0.22, range_max: 14.5, invalid_points: 90 };
    case 'imu':
      return { ax: 0.12, ay: -0.03, az: 9.81, gx: 0.002, gy: 0.014, gz: -0.004 };
    case 'odometry':
      return { x: 1.5, y: 2.5, theta: 0.4 };
    case 'action':
      return { action: 'MOVE_FORWARD', linear_velocity: 0.42, angular_velocity: 0.02 };
    case 'battery':
      return { percent: 82, voltage: 55.6, current: 9.4, temperature_c: 33.2 };
  }
}

export interface EventOptions {
  /** Seconds from episode start. */
  offset: number;
  sequence_id?: number;
  /** Extra transport latency in seconds, on top of LATENCY. */
  extraLatency?: number;
  /** Clock error of the sensor in seconds (positive = clock runs ahead). */
  clockOffset?: number;
  payload?: Record<string, unknown>;
}

export function makeEvent(sensor: Sensor, options: EventOptions): TelemetryEvent {
  const {
    offset,
    sequence_id = 0,
    extraLatency = 0,
    clockOffset = 0,
    payload = {},
  } = options;
  return {
    robot_id: 'robot-test',
    episode_id: 'episode-test',
    sensor,
    sequence_id,
    // Reported on the sensor's own clock…
    timestamp: START + offset + clockOffset,
    // …while the collector stamps arrival on the shared clock.
    ingest_timestamp: START + offset + LATENCY + extraLatency,
    payload: { ...defaultPayload(sensor, sequence_id), ...payload },
  } as TelemetryEvent;
}

export interface StreamOptions {
  duration?: number;
  sensors?: Sensor[];
  /** Per-sensor constant clock error in seconds. */
  clockOffsets?: Partial<Record<Sensor, number>>;
  /** Per-sensor drift in ms per second, applied from t=0. */
  drift?: Partial<Record<Sensor, number>>;
}

/**
 * A clean multi-sensor stream at the configured rates, in arrival order.
 * Every test starts from this and damages it in one specific way.
 */
export function makeStream(options: StreamOptions = {}): TelemetryEvent[] {
  const { duration = 30, sensors = ALL_SENSORS, clockOffsets = {}, drift = {} } = options;

  const drafts: Array<{ sensor: Sensor; offset: number; clockOffset: number }> = [];
  for (const sensor of sensors) {
    const rate = SIM_RATES_HZ[sensor];
    const count = Math.floor(duration * rate);
    for (let i = 0; i < count; i++) {
      const offset = i / rate;
      const driftS = ((drift[sensor] ?? 0) * offset) / 1000;
      drafts.push({ sensor, offset, clockOffset: (clockOffsets[sensor] ?? 0) + driftS });
    }
  }

  // Sequence IDs are assigned at the robot in capture order.
  drafts.sort((a, b) => a.offset - b.offset || a.sensor.localeCompare(b.sensor));
  return drafts.map((draft, index) =>
    makeEvent(draft.sensor, {
      offset: draft.offset,
      sequence_id: index,
      clockOffset: draft.clockOffset,
    }),
  );
}

/** Removes every event of `sensor` captured inside [from, to) seconds. */
export function dropWindow(
  events: TelemetryEvent[],
  sensor: Sensor,
  from: number,
  to: number,
): TelemetryEvent[] {
  return events.filter((event) => {
    if (event.sensor !== sensor) return true;
    const offset = event.timestamp - START;
    return offset < from || offset >= to;
  });
}

/** Re-emits every `nth` event of `sensor` with the same sequence ID. */
export function duplicateEvery(
  events: TelemetryEvent[],
  sensor: Sensor,
  nth: number,
): TelemetryEvent[] {
  const out: TelemetryEvent[] = [];
  let seen = 0;
  for (const event of events) {
    out.push(event);
    if (event.sensor === sensor && seen++ % nth === 0) {
      out.push({ ...event, ingest_timestamp: event.ingest_timestamp + 0.005 });
    }
  }
  return out;
}

/**
 * Delays a fraction of `sensor` events so they arrive after events captured
 * later — reordering the stream without touching capture timestamps.
 */
export function delayEvery(
  events: TelemetryEvent[],
  sensor: Sensor,
  nth: number,
  delayS = 0.5,
): TelemetryEvent[] {
  let seen = 0;
  const delayed = events.map((event) => {
    if (event.sensor !== sensor || seen++ % nth !== 0) return event;
    return { ...event, ingest_timestamp: event.ingest_timestamp + delayS };
  });
  return delayed.sort((a, b) => a.ingest_timestamp - b.ingest_timestamp);
}

/** Overwrites payload fields on a fraction of `sensor` events. */
export function corruptEvery(
  events: TelemetryEvent[],
  sensor: Sensor,
  nth: number,
  patch: Record<string, unknown>,
): TelemetryEvent[] {
  let seen = 0;
  return events.map((event) => {
    if (event.sensor !== sensor || seen++ % nth !== 0) return event;
    return { ...event, payload: { ...event.payload, ...patch } } as TelemetryEvent;
  });
}

/* ------------------------------------------------------------------ */
/* Metrics fixture — a perfect episode, for testing the scorer alone   */
/* ------------------------------------------------------------------ */

export function makeMetrics(overrides: Partial<EpisodeMetrics> = {}): EpisodeMetrics {
  const completeness: CompletenessMetric[] = ALL_SENSORS.map((sensor) => ({
    sensor,
    expected: 100,
    received: 100,
    pct: 100,
  }));
  const sensorHealth: SensorHealth[] = ALL_SENSORS.map((sensor) => ({
    sensor,
    score: 100,
    completeness_pct: 100,
    validity_pct: 100,
    longest_gap_ms: 0,
    dropout_count: 0,
    events: 100,
  }));

  return {
    events_total: 1000,
    events_valid: 1000,
    events_duplicate: 0,
    events_out_of_order: 0,
    duration_s: 30,
    completeness,
    completeness_pct: 100,
    sync: [],
    sync_mean_ms: 1,
    sync_p95_ms: 2,
    sync_p99_ms: 3,
    sync_max_ms: 4,
    validity_pct: 100,
    duplication_pct: 0,
    out_of_order_pct: 0,
    sensor_health: sensorHealth,
    dropouts: [],
    issues_by_code: {},
    ingest_latency_ms: 30,
    ...overrides,
  };
}
