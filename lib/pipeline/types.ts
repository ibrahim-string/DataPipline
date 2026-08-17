/**
 * Canonical telemetry + pipeline types.
 *
 * Everything downstream (validation, synchronization, quality scoring, episode
 * building, dataset manifests) is typed against these structures. They are
 * intentionally framework-free so the exact same code runs in three places:
 *
 *   1. the offline seed job that materialises the demo catalog (`npm run seed`)
 *   2. the server-side telemetry generator that feeds the SSE stream
 *   3. the browser-side consumer that processes the live stream
 */

export const SENSORS = ['camera', 'lidar', 'imu', 'odometry', 'action', 'battery'] as const;
export type Sensor = (typeof SENSORS)[number];

/** Sensors that participate in quality gating for VLA-style training episodes. */
export const CORE_SENSORS = ['camera', 'lidar', 'imu', 'odometry'] as const;
export type CoreSensor = (typeof CORE_SENSORS)[number];

export const ROBOT_ACTIONS = [
  'MOVE_FORWARD',
  'TURN_LEFT',
  'TURN_RIGHT',
  'STOP',
  'FOLLOW_PERSON',
] as const;
export type RobotAction = (typeof ROBOT_ACTIONS)[number];

/* ------------------------------------------------------------------ */
/* Sensor payload schemas                                              */
/* ------------------------------------------------------------------ */

export interface CameraPayload {
  frame_id: number;
  width: number;
  height: number;
  /** 0..1, higher is sharper. */
  blur_score: number;
  /** 0..1, higher is better exposed. */
  exposure_score: number;
}

export interface LidarPayload {
  /** Summarised point-cloud metadata — real clouds live in object storage. */
  points: number;
  range_min: number;
  range_max: number;
  invalid_points: number;
}

export interface ImuPayload {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
}

export interface OdometryPayload {
  x: number;
  y: number;
  theta: number;
}

export interface ActionPayload {
  action: RobotAction;
  linear_velocity: number;
  angular_velocity: number;
}

export interface BatteryPayload {
  percent: number;
  voltage: number;
  current: number;
  temperature_c: number;
}

export type PayloadFor<S extends Sensor> = S extends 'camera'
  ? CameraPayload
  : S extends 'lidar'
    ? LidarPayload
    : S extends 'imu'
      ? ImuPayload
      : S extends 'odometry'
        ? OdometryPayload
        : S extends 'action'
          ? ActionPayload
          : BatteryPayload;

interface Envelope<S extends Sensor, P> {
  robot_id: string;
  episode_id: string;
  sensor: S;
  /** Monotonic per-episode counter assigned at the robot. Duplicates are a bug we detect. */
  sequence_id: number;
  /** Sensor capture time, unix seconds with millisecond precision. */
  timestamp: number;
  /** Time the pipeline received the event — capture..ingest is our transport latency. */
  ingest_timestamp: number;
  payload: P;
}

/**
 * Discriminated on `sensor`, so `switch (event.sensor)` narrows the payload
 * without casts. This is what makes the validator type-safe.
 */
export type TelemetryEvent =
  | Envelope<'camera', CameraPayload>
  | Envelope<'lidar', LidarPayload>
  | Envelope<'imu', ImuPayload>
  | Envelope<'odometry', OdometryPayload>
  | Envelope<'action', ActionPayload>
  | Envelope<'battery', BatteryPayload>;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export const VALIDATION_CODES = [
  'NAN_VALUE',
  'INFINITE_VALUE',
  'MISSING_FIELD',
  'OUT_OF_RANGE',
  'NEGATIVE_RANGE',
  'IMPOSSIBLE_ACCELERATION',
  'VELOCITY_LIMIT_EXCEEDED',
  'CAMERA_DEGRADED',
  'LIDAR_INVALID_RATIO',
  'UNKNOWN_ACTION',
  'NEGATIVE_LATENCY',
] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ValidationIssue {
  code: ValidationCode;
  sensor: Sensor;
  sequence_id: number;
  timestamp: number;
  field: string;
  detail: string;
  /** `error` records fail validity; `warning` records are counted but still usable. */
  level: 'error' | 'warning';
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/* ------------------------------------------------------------------ */
/* Stream-level analysis                                               */
/* ------------------------------------------------------------------ */

export interface Dropout {
  sensor: Sensor;
  /** Seconds from episode start. */
  start_offset_s: number;
  end_offset_s: number;
  duration_ms: number;
  /** How many events we expected during the gap, given the sensor's nominal rate. */
  missed_events: number;
}

export interface SyncPairMetric {
  /** e.g. "camera→imu" — timestamps of `from` matched to nearest `to`. */
  pair: string;
  from: Sensor;
  to: Sensor;
  mean_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  /** Median signed deviation — a persistent non-zero value means clock offset, not jitter. */
  offset_ms: number;
  samples: number;
}

export interface CompletenessMetric {
  sensor: Sensor;
  expected: number;
  received: number;
  pct: number;
}

export interface SensorHealth {
  sensor: Sensor;
  /** 0..100 composite of completeness, validity and dropout behaviour. */
  score: number;
  completeness_pct: number;
  validity_pct: number;
  longest_gap_ms: number;
  dropout_count: number;
  events: number;
}

export const ANOMALY_KINDS = [
  'SENSOR_DROPOUT',
  'TIMESTAMP_DRIFT',
  'DUPLICATE_EVENTS',
  'OUT_OF_ORDER',
  'INVALID_VALUES',
  'CAMERA_DEGRADATION',
  'BATTERY_ANOMALY',
  'VELOCITY_LIMIT',
  'ACTION_STATE_MISMATCH',
  'LOW_COMPLETENESS',
] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

export interface Anomaly {
  id: string;
  kind: AnomalyKind;
  sensor: Sensor | 'system';
  severity: Severity;
  message: string;
  detail?: string;
  start_offset_s: number;
  end_offset_s: number;
  count?: number;
}

/* ------------------------------------------------------------------ */
/* Quality engine                                                      */
/* ------------------------------------------------------------------ */

export interface QualitySubscores {
  completeness: number;
  synchronization: number;
  validity: number;
  ordering: number;
  duplication: number;
  sensor_health: number;
}

export type QualityGrade = 'GOOD' | 'WARNING' | 'REJECTED';
export type EpisodeStatus = 'TRAINING_READY' | 'FLAGGED' | 'REJECTED';

export interface GateFailure {
  gate: string;
  observed: string;
  threshold: string;
  message: string;
}

export interface EpisodeMetrics {
  events_total: number;
  events_valid: number;
  events_duplicate: number;
  events_out_of_order: number;
  duration_s: number;

  completeness: CompletenessMetric[];
  completeness_pct: number;

  sync: SyncPairMetric[];
  sync_mean_ms: number;
  sync_p95_ms: number;
  sync_p99_ms: number;
  sync_max_ms: number;

  validity_pct: number;
  duplication_pct: number;
  out_of_order_pct: number;

  sensor_health: SensorHealth[];
  dropouts: Dropout[];
  issues_by_code: Record<string, number>;
  /** Mean capture→ingest latency in ms. Surfaced as "pipeline latency" in the UI. */
  ingest_latency_ms: number;
}

export interface QualityReport {
  subscores: QualitySubscores;
  score: number;
  grade: QualityGrade;
  status: EpisodeStatus;
  gate_failures: GateFailure[];
  /** Human-readable justification — every accept/reject decision is explainable. */
  reasons: string[];
}

/* ------------------------------------------------------------------ */
/* Episodes                                                            */
/* ------------------------------------------------------------------ */

export interface ActionSegment {
  action: RobotAction;
  start_offset_s: number;
  end_offset_s: number;
  mean_linear_velocity: number;
  mean_angular_velocity: number;
}

/** Per-second rollup used to draw episode timelines without keeping raw events. */
export interface TimelineBucket {
  offset_s: number;
  camera: number;
  lidar: number;
  imu: number;
  odometry: number;
  invalid: number;
}

export interface SyncSample {
  offset_s: number;
  /** Signed deviation in ms vs the reference clock, per sensor. */
  imu_ms: number;
  lidar_ms: number;
  odometry_ms: number;
}

export interface MotionSample {
  offset_s: number;
  linear: number;
  angular: number;
  battery: number;
}

export interface Episode {
  episode_id: string;
  robot_id: string;
  robot_model: string;
  site: string;
  environment: string;
  task: string;
  task_label: string;
  started_at: string;
  duration_s: number;
  sensors: Sensor[];
  metrics: EpisodeMetrics;
  quality: QualityReport;
  anomalies: Anomaly[];
  actions: ActionSegment[];
  timeline: TimelineBucket[];
  sync_series: SyncSample[];
  motion_series: MotionSample[];
  /** Small, anomaly-biased sample of raw events, kept for inspection in the UI. */
  event_samples: TelemetryEvent[];
}

/** The list-view projection — cheap to ship to the client. */
export interface EpisodeSummary {
  episode_id: string;
  robot_id: string;
  site: string;
  task: string;
  task_label: string;
  started_at: string;
  duration_s: number;
  sensors: Sensor[];
  score: number;
  grade: QualityGrade;
  status: EpisodeStatus;
  events_total: number;
  anomaly_count: number;
  top_reason: string;
}
