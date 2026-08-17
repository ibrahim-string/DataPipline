import type { Sensor } from './types';

/**
 * Single source of truth for pipeline behaviour.
 *
 * Thresholds live here (not scattered through the UI) so the dashboard can
 * render the exact numbers the engine gates on. In production this would be a
 * versioned config artifact attached to every dataset build, so a dataset can
 * always be reproduced with the rules that were in force when it was cut.
 */

/**
 * Rates a real Unitree-class humanoid would publish at. We keep them here for
 * documentation and for the "what production looks like" copy — the simulator
 * runs decimated (see SIM_RATES_HZ) so a browser can hold a live stream.
 */
export const NOMINAL_RATES_HZ: Record<Sensor, number> = {
  camera: 30,
  lidar: 10,
  imu: 200,
  odometry: 50,
  action: 10,
  battery: 1,
};

/** Decimation factor applied to every stream in the POC simulator. */
export const SIM_DECIMATION = 2;

export const SIM_RATES_HZ: Record<Sensor, number> = {
  camera: NOMINAL_RATES_HZ.camera / SIM_DECIMATION, // 15 Hz
  lidar: NOMINAL_RATES_HZ.lidar / SIM_DECIMATION, // 5 Hz
  imu: NOMINAL_RATES_HZ.imu / SIM_DECIMATION, // 100 Hz
  odometry: NOMINAL_RATES_HZ.odometry / SIM_DECIMATION, // 25 Hz
  action: NOMINAL_RATES_HZ.action / SIM_DECIMATION, // 5 Hz
  battery: NOMINAL_RATES_HZ.battery, // 1 Hz
};

/**
 * Reference clock for synchronization analysis. Camera is the slowest core
 * modality that VLA training actually keys off, so every other stream is
 * measured against it.
 */
export const REFERENCE_SENSOR: Sensor = 'camera';

/**
 * Quality score weights. They sum to 1.0 — `assertWeightsSum` in the tests
 * keeps that true if someone edits this table.
 */
export const QUALITY_WEIGHTS = {
  completeness: 0.3,
  synchronization: 0.25,
  validity: 0.2,
  sensor_health: 0.15,
  ordering: 0.05,
  duplication: 0.05,
} as const;

/**
 * Hard gates. Any failure rejects the episode regardless of weighted score —
 * a 91-scoring episode with a 1.4 s LiDAR hole is still useless for training.
 */
export const QUALITY_GATES = {
  min_completeness_pct: 85,
  /**
   * Averaging across four modalities hides a single dead one, so we also gate on
   * the weakest core sensor. For training, the weakest modality is the one that
   * decides whether an episode is usable.
   */
  min_sensor_completeness_pct: 75,
  min_validity_pct: 90,
  max_sync_p95_ms: 50,
  max_dropout_ms: 1000,
  max_duplication_pct: 5,
  // Deliberately looser than the others: out-of-order arrival is *recoverable*
  // by buffering to a watermark before writing. Only pathological reordering,
  // where no reasonable watermark would help, should reject an episode.
  max_out_of_order_pct: 10,
  min_duration_s: 5,
} as const;

/**
 * Weighted-score bands, applied after gates pass.
 *
 * The gap between `good` and `warning` is the human-review band: good enough
 * that throwing it away would be wasteful, not good enough to train on
 * unreviewed. Setting `good` at 90 rather than at the gate boundary is
 * deliberate — gates define "not broken", this defines "worth training on".
 */
export const GRADE_BANDS = {
  good: 90,
  warning: 70,
} as const;

/** Score→subscore mapping anchors for synchronization (piecewise linear). */
export const SYNC_SCORE_ANCHORS: ReadonlyArray<readonly [ms: number, score: number]> = [
  [5, 100],
  [15, 90],
  [25, 75],
  [50, 50],
  [100, 20],
  [200, 0],
];

/** Physical / plausibility limits used by the record validator. */
export const VALUE_LIMITS = {
  max_linear_velocity: 1.5, // m/s
  max_angular_velocity: 2.0, // rad/s
  max_accel_magnitude: 40, // m/s^2 — above this the IMU reading is not physical
  max_gyro_magnitude: 12, // rad/s
  lidar_max_range: 30, // m
  lidar_min_points: 1000,
  lidar_max_invalid_ratio: 0.25,
  min_blur_score: 0.35,
  min_exposure_score: 0.3,
  /** Odometry displacement above this while action == STOP is a labelling bug. */
  stop_motion_epsilon_mps: 0.06,
  /** Battery falling faster than this is an electrical fault, not discharge. */
  max_battery_drop_pct_per_s: 1.5,
} as const;

/** A gap larger than `rate_interval * this` counts as a dropout, not jitter. */
export const DROPOUT_GAP_MULTIPLIER = 4;

/** Live-alert thresholds for the streaming dashboard. */
export const ALERT_THRESHOLDS = {
  sync_p95_ms: 25,
  dropout_ms: 300,
  battery_drop_pct_per_s: 1.5,
  invalid_rate_pct: 5,
} as const;

/** Default acceptance policy applied when building a dataset version. */
export const DEFAULT_BUILD_POLICY = {
  min_quality_score: 85,
  include_flagged: false,
  require_sensors: ['camera', 'lidar', 'imu', 'odometry'] as Sensor[],
  min_duration_s: 8,
} as const;

export type BuildPolicy = {
  min_quality_score: number;
  include_flagged: boolean;
  require_sensors: Sensor[];
  min_duration_s: number;
};
