import type { DatasetVersion } from '../pipeline/dataset';
import type { Episode, EpisodeSummary } from '../pipeline/types';
import type { RobotProfile } from '../sim/catalog';

/**
 * Shape of the materialised catalog written by `npm run seed`.
 *
 * The catalog is the POC's stand-in for a warehouse: the seed job plays the
 * role of the batch pipeline (generate → validate → synchronise → score →
 * segment → version), and the committed JSON is the table the app reads. That
 * keeps the deployed demo instant and, more importantly, reproducible — anyone
 * can regenerate it byte-for-byte from the same seed.
 */

export interface ExperimentRun {
  run_id: string;
  experiment_id: string;
  dataset_version: string;
  model: string;
  /** Episodes in the dataset version this run trained on. */
  episodes: number;
  dataset_avg_quality: number;
  train_hours: number;
  /** Simulated evaluation metrics — see the disclaimer on the Experiments page. */
  success_rate: number;
  collision_rate: number;
  mean_time_to_goal_s: number;
  val_loss: number;
  trained_at: string;
  status: 'completed' | 'running' | 'failed';
  notes: string;
}

export interface Experiment {
  experiment_id: string;
  name: string;
  objective: string;
  task: string;
  owner: string;
  created_at: string;
  runs: ExperimentRun[];
}

export interface FleetRobotStats {
  robot_id: string;
  episodes: number;
  training_ready: number;
  flagged: number;
  rejected: number;
  avg_quality: number;
  total_events: number;
  total_duration_s: number;
  anomalies: number;
  uptime_pct: number;
  events_per_second: number;
  status: 'ONLINE' | 'WARNING' | 'OFFLINE';
  last_episode_at: string;
  sensor_health: Array<{ sensor: string; score: number }>;
  top_anomaly_kinds: Array<{ kind: string; count: number }>;
}

export interface CatalogStats {
  robots: number;
  episodes: number;
  events_processed: number;
  training_ready: number;
  flagged: number;
  rejected: number;
  avg_quality: number;
  total_duration_s: number;
  anomalies: number;
  dataset_versions: number;
  window_start: string;
  window_end: string;
}

export interface Catalog {
  generated_at: string;
  seed: string;
  stats: CatalogStats;
  robots: RobotProfile[];
  fleet: FleetRobotStats[];
  episodes: Episode[];
  summaries: EpisodeSummary[];
  datasets: DatasetVersion[];
  experiments: Experiment[];
}
