/**
 * Offline catalog build — `npm run seed`.
 *
 * This is the batch half of the pipeline. It plays the role a nightly Airflow /
 * Dagster DAG would play in production:
 *
 *   generate telemetry → validate → synchronise → score → segment into episodes
 *   → roll up fleet statistics → cut dataset versions → link experiment runs
 *
 * The output is `data/catalog.json`, committed to the repo so the deployed demo
 * has no cold-start cost and no database dependency. It is fully reproducible:
 * the same SEED always produces the same 180 episodes, the same anomalies and
 * the same quality scores.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { round } from '../lib/format';
import { buildDataset, toCandidate, type DatasetCandidate, type DatasetVersion } from '../lib/pipeline/dataset';
import { toSummary } from '../lib/pipeline/episode';
import type { Episode } from '../lib/pipeline/types';
import { ROBOTS, type RobotProfile } from '../lib/sim/catalog';
import { simulateEpisode } from '../lib/sim/generator';
import { Rng } from '../lib/sim/rng';
import type { Catalog, Experiment, ExperimentRun, FleetRobotStats } from '../lib/data/types';

const SEED = process.env.SEED ?? 'omakase-ela-lab-2026';
const EPISODE_COUNT = Number(process.env.EPISODE_COUNT ?? 180);
/** Fixed so the committed catalog is stable across regenerations. */
const WINDOW_END = new Date(process.env.WINDOW_END ?? '2026-08-15T09:00:00Z').getTime() / 1000;
const WINDOW_DAYS = 45;
const WINDOW_START = WINDOW_END - WINDOW_DAYS * 86_400;

/** Collection volume per fleet group — the hospital deployment is the focus. */
const GROUP_WEIGHTS: Record<string, number> = {
  'hospital-alpha': 3.2,
  research: 1.0,
  hospitality: 1.4,
  retail: 1.2,
};

function buildRobotSchedule(rng: Rng): RobotProfile[] {
  const pool: Array<readonly [RobotProfile, number]> = ROBOTS.map((robot) => [
    robot,
    GROUP_WEIGHTS[robot.fleet_group] ?? 1,
  ]);
  return Array.from({ length: EPISODE_COUNT }, () => rng.weighted(pool));
}

function main(): void {
  const started = Date.now();
  const rng = new Rng(SEED);
  const schedule = buildRobotSchedule(rng);

  // Episodes are spread across the collection window, then sorted so episode
  // numbering follows real chronological order.
  const startTimes = schedule
    .map(() => WINDOW_START + rng.next() * (WINDOW_END - WINDOW_START))
    .sort((a, b) => a - b);

  const episodes: Episode[] = [];
  for (let i = 0; i < schedule.length; i++) {
    const robot = schedule[i]!;
    const { episode } = simulateEpisode(
      `${SEED}:${robot.robot_id}:${i}`,
      robot,
      i + 1,
      round(startTimes[i]!, 3),
    );
    episodes.push(episode);
    if ((i + 1) % 20 === 0) {
      process.stdout.write(`  simulated ${i + 1}/${schedule.length} episodes\n`);
    }
  }

  const summaries = episodes.map(toSummary);
  const candidates = episodes.map(toCandidate);

  const datasets = buildDatasetVersions(candidates);
  const fleet = buildFleetStats(episodes);
  const experiments = buildExperiments(new Rng(`${SEED}:experiments`), datasets);

  const eventsProcessed = episodes.reduce((sum, e) => sum + e.metrics.events_total, 0);
  const catalog: Catalog = {
    generated_at: new Date(WINDOW_END * 1000).toISOString(),
    seed: SEED,
    stats: {
      robots: ROBOTS.length,
      episodes: episodes.length,
      events_processed: eventsProcessed,
      training_ready: summaries.filter((s) => s.status === 'TRAINING_READY').length,
      flagged: summaries.filter((s) => s.status === 'FLAGGED').length,
      rejected: summaries.filter((s) => s.status === 'REJECTED').length,
      avg_quality: round(summaries.reduce((sum, s) => sum + s.score, 0) / summaries.length, 2),
      total_duration_s: round(
        episodes.reduce((sum, e) => sum + e.duration_s, 0),
        1,
      ),
      anomalies: episodes.reduce((sum, e) => sum + e.anomalies.length, 0),
      dataset_versions: datasets.length,
      window_start: new Date(WINDOW_START * 1000).toISOString(),
      window_end: new Date(WINDOW_END * 1000).toISOString(),
    },
    robots: ROBOTS,
    fleet,
    episodes,
    summaries,
    datasets,
    experiments,
  };

  const outDir = path.join(process.cwd(), 'data');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'catalog.json');
  writeFileSync(outFile, JSON.stringify(catalog), 'utf8');

  const sizeMb = Buffer.byteLength(JSON.stringify(catalog)) / 1024 / 1024;
  process.stdout.write(
    [
      '',
      `catalog written to data/catalog.json (${sizeMb.toFixed(2)} MB) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      `  seed              ${SEED}`,
      `  robots            ${ROBOTS.length}`,
      `  episodes          ${episodes.length}`,
      `  telemetry events  ${eventsProcessed.toLocaleString('en-US')}`,
      `  training-ready    ${catalog.stats.training_ready}`,
      `  flagged           ${catalog.stats.flagged}`,
      `  rejected          ${catalog.stats.rejected}`,
      `  anomalies         ${catalog.stats.anomalies}`,
      `  dataset versions  ${datasets.length}`,
      `  experiments       ${experiments.length}`,
      '',
    ].join('\n'),
  );
}

/* ------------------------------------------------------------------ */
/* Dataset versions                                                    */
/* ------------------------------------------------------------------ */

/**
 * Four versions across two datasets, cut the way a real team cuts them: an
 * early permissive version, then progressively stricter policies as the team
 * learns which data actually helps the model.
 */
function buildDatasetVersions(candidates: DatasetCandidate[]): DatasetVersion[] {
  const chronological = [...candidates].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
  );
  const hospital = chronological.filter((c) => c.site === 'Kita General Hospital');
  const service = chronological.filter((c) => c.site !== 'Kita General Hospital');

  const at = (fraction: number) => hospital.slice(0, Math.floor(hospital.length * fraction));
  const dateAt = (fraction: number) =>
    new Date(WINDOW_START * 1000 + (WINDOW_END - WINDOW_START) * 1000 * fraction).toISOString();

  const v01 = buildDataset({
    dataset: 'hospital-navigation',
    version: 'v0.1',
    candidates: at(0.4),
    created_at: dateAt(0.42),
    parent: null,
    policy: { min_quality_score: 75, include_flagged: true, min_duration_s: 5 },
    notes:
      'First cut. Permissive on purpose — we wanted volume to see whether the pipeline held up end to end, and flagged episodes were included.',
  }).version;

  const v02 = buildDataset({
    dataset: 'hospital-navigation',
    version: 'v0.2',
    candidates: at(0.72),
    created_at: dateAt(0.75),
    parent: 'hospital-navigation-v0.1',
    policy: { min_quality_score: 85, include_flagged: false, min_duration_s: 8 },
    notes:
      'Dropped flagged episodes after the v0.1 ablation showed they hurt evaluation. Raised the score floor to 85.',
  }).version;

  const v03 = buildDataset({
    dataset: 'hospital-navigation',
    version: 'v0.3',
    candidates: hospital,
    created_at: dateAt(0.99),
    parent: 'hospital-navigation-v0.2',
    policy: { min_quality_score: 88, include_flagged: false, min_duration_s: 10 },
    notes:
      'Current production cut. Requires all four core modalities, 88+ quality and at least 10 s of task time.',
  }).version;

  const service01 = buildDataset({
    dataset: 'service-multisite',
    version: 'v0.1',
    candidates: service,
    created_at: dateAt(0.9),
    parent: null,
    policy: { min_quality_score: 82, include_flagged: false, min_duration_s: 8 },
    notes:
      'Hotel, retail and test-facility episodes. Kept separate from the hospital dataset because the environments differ too much to mix without a domain label.',
  }).version;

  return [v01, v02, v03, service01];
}

/* ------------------------------------------------------------------ */
/* Fleet rollup                                                        */
/* ------------------------------------------------------------------ */

function buildFleetStats(episodes: Episode[]): FleetRobotStats[] {
  return ROBOTS.map((robot) => {
    const own = episodes.filter((e) => e.robot_id === robot.robot_id);
    const count = own.length || 1;
    const avgQuality = round(own.reduce((sum, e) => sum + e.quality.score, 0) / count, 2);
    const totalDuration = round(
      own.reduce((sum, e) => sum + e.duration_s, 0),
      1,
    );
    const totalEvents = own.reduce((sum, e) => sum + e.metrics.events_total, 0);

    const healthBySensor = new Map<string, number[]>();
    for (const episode of own) {
      for (const health of episode.metrics.sensor_health) {
        const list = healthBySensor.get(health.sensor) ?? [];
        list.push(health.score);
        healthBySensor.set(health.sensor, list);
      }
    }

    const anomalyKinds = new Map<string, number>();
    for (const episode of own) {
      for (const anomaly of episode.anomalies) {
        anomalyKinds.set(anomaly.kind, (anomalyKinds.get(anomaly.kind) ?? 0) + 1);
      }
    }

    const lastEpisode = own.reduce<Episode | null>(
      (latest, e) => (!latest || e.started_at > latest.started_at ? e : latest),
      null,
    );

    const rejected = own.filter((e) => e.quality.status === 'REJECTED').length;
    const status: FleetRobotStats['status'] =
      avgQuality < 78 || rejected / count > 0.3 ? 'WARNING' : 'ONLINE';

    return {
      robot_id: robot.robot_id,
      episodes: own.length,
      training_ready: own.filter((e) => e.quality.status === 'TRAINING_READY').length,
      flagged: own.filter((e) => e.quality.status === 'FLAGGED').length,
      rejected,
      avg_quality: avgQuality,
      total_events: totalEvents,
      total_duration_s: totalDuration,
      anomalies: own.reduce((sum, e) => sum + e.anomalies.length, 0),
      // Uptime tracks reliability, discounted by how much of its data we threw away.
      uptime_pct: round(Math.min(99.9, robot.reliability * 100 + 4 - (rejected / count) * 12), 2),
      events_per_second: round(totalEvents / Math.max(totalDuration, 1), 1),
      status,
      last_episode_at: lastEpisode?.started_at ?? new Date(WINDOW_START * 1000).toISOString(),
      sensor_health: [...healthBySensor.entries()]
        .map(([sensor, scores]) => ({
          sensor,
          score: round(scores.reduce((sum, s) => sum + s, 0) / scores.length, 1),
        }))
        .sort((a, b) => a.sensor.localeCompare(b.sensor)),
      top_anomaly_kinds: [...anomalyKinds.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 4),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Experiment tracking (simulated)                                     */
/* ------------------------------------------------------------------ */

/**
 * Simulated training runs. The numbers are generated, not measured — no model
 * was trained. What is real is the *linkage*: every run points at a dataset
 * version that this pipeline actually produced, so "which data did this model
 * see?" has an exact answer. That linkage is the part worth building.
 *
 * The generated relationship is monotone in dataset quality on purpose: it is
 * the hypothesis the whole ELA pipeline exists to test.
 */
function buildExperiments(rng: Rng, datasets: DatasetVersion[]): Experiment[] {
  const byName = new Map(datasets.map((d) => [d.full_name, d]));

  const makeRun = (
    experimentId: string,
    index: number,
    datasetName: string,
    model: string,
    trainedAt: string,
    bias: number,
    notes: string,
    status: ExperimentRun['status'] = 'completed',
  ): ExperimentRun => {
    const dataset = byName.get(datasetName);
    const quality = dataset?.stats.avg_quality ?? 80;
    const episodes = dataset?.stats.included ?? 0;
    // Success rate rises with dataset quality and (log) volume, plus noise.
    const base = 0.34 + (quality - 78) * 0.026 + Math.log10(Math.max(episodes, 1)) * 0.075;
    const success = clamp01(base + bias + rng.normal(0, 0.012));
    return {
      run_id: `${experimentId}-run-${String(index).padStart(3, '0')}`,
      experiment_id: experimentId,
      dataset_version: datasetName,
      model,
      episodes,
      dataset_avg_quality: quality,
      train_hours: round(rng.float(3.5, 26), 1),
      success_rate: round(success * 100, 1),
      collision_rate: round(Math.max(0.1, (1 - success) * rng.float(7, 12)), 2),
      mean_time_to_goal_s: round(46 - success * 16 + rng.normal(0, 1.2), 1),
      val_loss: round(0.92 - success * 0.55 + rng.normal(0, 0.015), 4),
      trained_at: trainedAt,
      status,
      notes,
    };
  };

  const day = (offset: number) =>
    new Date((WINDOW_END - offset * 86_400) * 1000).toISOString();

  const experiments: Experiment[] = [
    {
      experiment_id: 'exp-001',
      name: 'Navigation Policy Evaluation',
      objective: 'Does tightening the dataset quality bar improve corridor navigation success?',
      task: 'navigate_to_room',
      owner: 'ela-team',
      created_at: day(38),
      runs: [
        makeRun('exp-001', 1, 'hospital-navigation-v0.1', 'nav-policy-0.1.0', day(30), 0, 'Baseline on the permissive v0.1 cut.'),
        makeRun('exp-001', 2, 'hospital-navigation-v0.2', 'nav-policy-0.2.0', day(17), 0, 'Same architecture, stricter data.'),
        makeRun('exp-001', 3, 'hospital-navigation-v0.3', 'nav-policy-0.3.0', day(4), 0, 'Current candidate for field validation.'),
      ],
    },
    {
      experiment_id: 'exp-002',
      name: 'VLA Instruction Following',
      objective: 'Language-conditioned policy on corridor + room-entry instructions.',
      task: 'deliver_supplies',
      owner: 'ai-team',
      created_at: day(26),
      runs: [
        makeRun('exp-002', 1, 'hospital-navigation-v0.2', 'vla-small-0.1.0', day(21), -0.06, 'First language-conditioned run; underfits on the smaller cut.'),
        makeRun('exp-002', 2, 'hospital-navigation-v0.3', 'vla-small-0.2.0', day(9), -0.03, 'Adds instruction augmentation from the episode task labels.'),
        makeRun('exp-002', 3, 'hospital-navigation-v0.3', 'vla-base-0.1.0', day(2), 0.02, 'Larger backbone, same data.', 'running'),
      ],
    },
    {
      experiment_id: 'exp-003',
      name: 'Data-Quality Ablation',
      objective: 'Do FLAGGED episodes help or hurt? This is what set the v0.2 policy.',
      task: 'navigate_to_room',
      owner: 'ela-team',
      created_at: day(24),
      runs: [
        makeRun('exp-003', 1, 'hospital-navigation-v0.1', 'nav-policy-abl-a', day(23), -0.045, 'Flagged episodes included (v0.1 policy).'),
        makeRun('exp-003', 2, 'hospital-navigation-v0.2', 'nav-policy-abl-b', day(22), 0.01, 'Flagged episodes excluded. Same episode count ±5%.'),
      ],
    },
    {
      experiment_id: 'exp-004',
      name: 'SLAM Loop-Closure Regression',
      objective: 'Track map drift against LiDAR completeness on the same episode set.',
      task: 'patrol_corridor',
      owner: 'autonomy',
      created_at: day(19),
      runs: [
        makeRun('exp-004', 1, 'hospital-navigation-v0.2', 'slam-tuned-0.4.1', day(15), -0.02, 'Baseline loop-closure thresholds.'),
        makeRun('exp-004', 2, 'hospital-navigation-v0.3', 'slam-tuned-0.5.0', day(6), 0.015, 'Benefits directly from the LiDAR dropout gate.'),
      ],
    },
    {
      experiment_id: 'exp-005',
      name: 'Person-Following Robustness',
      objective: 'Cross-site generalisation for follow-person behaviour.',
      task: 'follow_person',
      owner: 'ai-team',
      created_at: day(12),
      runs: [
        makeRun('exp-005', 1, 'service-multisite-v0.1', 'follow-0.1.0', day(10), -0.05, 'Hotel and retail episodes only.'),
        makeRun('exp-005', 2, 'hospital-navigation-v0.3', 'follow-0.2.0', day(3), -0.01, 'Hospital-only comparison run.'),
        makeRun('exp-005', 3, 'service-multisite-v0.1', 'follow-0.3.0', day(1), -0.12, 'Failed: dataloader OOM on the 4-modality batch.', 'failed'),
      ],
    },
  ];

  return experiments;
}

function clamp01(value: number): number {
  return Math.min(0.985, Math.max(0.05, value));
}

main();
