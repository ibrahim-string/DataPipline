import { mean, round } from '../format';
import { DEFAULT_BUILD_POLICY, type BuildPolicy } from './config';
import type { Episode, EpisodeStatus, QualityGrade, Sensor } from './types';

/**
 * Stages 7–8 — dataset versioning and export.
 *
 * A dataset version is an immutable, explainable selection over episodes:
 * a policy (the rules), a member list (what got in), and statistics (what it
 * contains). Two properties matter more than anything else here:
 *
 *   - Reproducible: the same episodes + the same policy always produce the same
 *     version, so a training run can be traced back to exactly what it saw.
 *   - Explainable: every excluded episode carries the reason it was excluded.
 *     "1,204 candidates → 890 included" is useless without the other 314.
 */

/** The projection of an episode that dataset building actually needs. */
export interface DatasetCandidate {
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
  completeness_pct: number;
  validity_pct: number;
  sync_p95_ms: number;
  events_total: number;
  anomaly_count: number;
  gate_failures: string[];
}

export function toCandidate(episode: Episode): DatasetCandidate {
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
    completeness_pct: episode.metrics.completeness_pct,
    validity_pct: episode.metrics.validity_pct,
    sync_p95_ms: episode.metrics.sync_p95_ms,
    events_total: episode.metrics.events_total,
    anomaly_count: episode.anomalies.length,
    gate_failures: episode.quality.gate_failures.map((g) => g.gate),
  };
}

export interface ExclusionReason {
  reason: string;
  count: number;
}

export interface DatasetStats {
  candidates: number;
  included: number;
  training_ready: number;
  flagged: number;
  rejected: number;
  avg_quality: number;
  min_quality: number;
  total_duration_s: number;
  total_events: number;
  robots: number;
  tasks: Array<{ task: string; episodes: number; avg_quality: number }>;
  sites: Array<{ site: string; episodes: number }>;
  exclusions: ExclusionReason[];
  /** Rough on-disk footprint if raw sensor data were materialised. */
  estimated_size_bytes: number;
}

export interface DatasetVersion {
  dataset: string;
  version: string;
  full_name: string;
  created_at: string;
  parent: string | null;
  policy: BuildPolicy;
  episode_ids: string[];
  stats: DatasetStats;
  notes: string;
}

/** Per-episode row written to the exported manifest. */
export interface ManifestEntry {
  dataset_version: string;
  episode_id: string;
  robot_id: string;
  site: string;
  task: string;
  started_at: string;
  duration_seconds: number;
  sensors: Sensor[];
  quality_score: number;
  completeness_pct: number;
  validity_pct: number;
  sync_p95_ms: number;
  event_count: number;
  status: EpisodeStatus;
}

/**
 * Bytes an episode would occupy if the raw streams were materialised. Purely an
 * estimate for the UI — this POC never writes sensor data. Assumes ~180 KB per
 * RGB frame at 30 Hz plus ~400 KB/s for LiDAR and a few KB/s for everything else.
 */
function estimateEpisodeBytes(candidate: DatasetCandidate): number {
  const perSecond =
    (candidate.sensors.includes('camera') ? 180_000 * 30 : 0) +
    (candidate.sensors.includes('lidar') ? 400_000 : 0) +
    (candidate.sensors.includes('imu') ? 200 * 48 : 0) +
    (candidate.sensors.includes('odometry') ? 50 * 32 : 0) +
    2_000;
  return Math.round(perSecond * candidate.duration_s);
}

export interface BuildResult {
  version: DatasetVersion;
  manifest: ManifestEntry[];
  /** Episodes that did not make it in, with the rule that excluded them. */
  excluded: Array<{ episode_id: string; reason: string; score: number }>;
}

export function buildDataset(options: {
  dataset: string;
  version: string;
  candidates: DatasetCandidate[];
  policy?: Partial<BuildPolicy>;
  created_at?: string;
  parent?: string | null;
  notes?: string;
}): BuildResult {
  const policy: BuildPolicy = { ...DEFAULT_BUILD_POLICY, ...options.policy };
  const fullName = `${options.dataset}-${options.version}`;

  const included: DatasetCandidate[] = [];
  const excluded: Array<{ episode_id: string; reason: string; score: number }> = [];

  for (const candidate of options.candidates) {
    const reason = rejectionReason(candidate, policy);
    if (reason) {
      excluded.push({ episode_id: candidate.episode_id, reason, score: candidate.score });
    } else {
      included.push(candidate);
    }
  }

  const exclusionCounts = new Map<string, number>();
  for (const entry of excluded) {
    exclusionCounts.set(entry.reason, (exclusionCounts.get(entry.reason) ?? 0) + 1);
  }

  const taskMap = new Map<string, number[]>();
  for (const candidate of included) {
    const scores = taskMap.get(candidate.task) ?? [];
    scores.push(candidate.score);
    taskMap.set(candidate.task, scores);
  }

  const siteMap = new Map<string, number>();
  for (const candidate of included) {
    siteMap.set(candidate.site, (siteMap.get(candidate.site) ?? 0) + 1);
  }

  const stats: DatasetStats = {
    candidates: options.candidates.length,
    included: included.length,
    training_ready: options.candidates.filter((c) => c.status === 'TRAINING_READY').length,
    flagged: options.candidates.filter((c) => c.status === 'FLAGGED').length,
    rejected: options.candidates.filter((c) => c.status === 'REJECTED').length,
    avg_quality: round(mean(included.map((c) => c.score)), 2),
    min_quality: included.length ? round(Math.min(...included.map((c) => c.score)), 2) : 0,
    total_duration_s: round(
      included.reduce((sum, c) => sum + c.duration_s, 0),
      1,
    ),
    total_events: included.reduce((sum, c) => sum + c.events_total, 0),
    robots: new Set(included.map((c) => c.robot_id)).size,
    tasks: [...taskMap.entries()]
      .map(([task, scores]) => ({
        task,
        episodes: scores.length,
        avg_quality: round(mean(scores), 1),
      }))
      .sort((a, b) => b.episodes - a.episodes),
    sites: [...siteMap.entries()]
      .map(([site, episodes]) => ({ site, episodes }))
      .sort((a, b) => b.episodes - a.episodes),
    exclusions: [...exclusionCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    estimated_size_bytes: included.reduce((sum, c) => sum + estimateEpisodeBytes(c), 0),
  };

  const version: DatasetVersion = {
    dataset: options.dataset,
    version: options.version,
    full_name: fullName,
    created_at: options.created_at ?? new Date().toISOString(),
    parent: options.parent ?? null,
    policy,
    episode_ids: included.map((c) => c.episode_id),
    stats,
    notes: options.notes ?? '',
  };

  return { version, manifest: included.map((c) => toManifestEntry(c, fullName)), excluded };
}

function rejectionReason(candidate: DatasetCandidate, policy: BuildPolicy): string | null {
  if (candidate.status === 'REJECTED') {
    const gate = candidate.gate_failures[0];
    return gate ? `Failed quality gate: ${gate}` : 'Rejected by quality engine';
  }
  if (candidate.status === 'FLAGGED' && !policy.include_flagged) {
    return 'Flagged episode excluded by policy';
  }
  if (candidate.score < policy.min_quality_score) {
    return `Quality score below policy minimum (${policy.min_quality_score})`;
  }
  if (candidate.duration_s < policy.min_duration_s) {
    return `Shorter than policy minimum (${policy.min_duration_s}s)`;
  }
  const missing = policy.require_sensors.filter((s) => !candidate.sensors.includes(s));
  if (missing.length > 0) {
    return `Missing required sensor: ${missing.join(', ')}`;
  }
  return null;
}

export function toManifestEntry(candidate: DatasetCandidate, datasetVersion: string): ManifestEntry {
  return {
    dataset_version: datasetVersion,
    episode_id: candidate.episode_id,
    robot_id: candidate.robot_id,
    site: candidate.site,
    task: candidate.task,
    started_at: candidate.started_at,
    duration_seconds: candidate.duration_s,
    sensors: candidate.sensors,
    quality_score: candidate.score,
    completeness_pct: candidate.completeness_pct,
    validity_pct: candidate.validity_pct,
    sync_p95_ms: candidate.sync_p95_ms,
    event_count: candidate.events_total,
    status: candidate.status,
  };
}

/** `v0.3` → `v0.4`. Versions are minor-only in this POC. */
export function nextVersion(current: string): string {
  const match = /^v(\d+)\.(\d+)$/.exec(current);
  if (!match) return 'v0.1';
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return `v${major}.${minor + 1}`;
}
