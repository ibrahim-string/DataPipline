import { clamp, round } from '../format';
import { GRADE_BANDS, QUALITY_GATES, QUALITY_WEIGHTS, SYNC_SCORE_ANCHORS } from './config';
import type {
  Anomaly,
  EpisodeMetrics,
  GateFailure,
  QualityGrade,
  QualityReport,
  QualitySubscores,
  EpisodeStatus,
} from './types';

/**
 * Stage 5 — the quality engine.
 *
 * Two independent mechanisms, deliberately:
 *
 *   1. A weighted score (0–100) that ranks episodes against each other. Good for
 *      "give me the best 500 episodes", useless as a safety check because a
 *      single catastrophic dimension gets averaged away by five healthy ones.
 *
 *   2. Hard gates that reject outright. An episode scoring 91 with a 1.4 s LiDAR
 *      hole is still unusable for training — no amount of good IMU data fixes a
 *      missing modality. Gates run first and are not overridable by score.
 *
 * Every rejection carries a machine-readable `gate_failures` list and a
 * human-readable `reasons` list, because "rejected" with no explanation is not
 * an answer a data engineer can act on.
 */

/* ---------------------------------------------------------------- */
/* Subscore mappings — each returns 0..100                           */
/* ---------------------------------------------------------------- */

/** 100% → 100, 90% → 75, 80% → 50, ≤60% → 0. */
export function scoreCompleteness(pct: number): number {
  return clamp(((pct - 60) / 40) * 100, 0, 100);
}

/** Steeper than completeness: 100% → 100, 95% → 75, 90% → 50, ≤80% → 0. */
export function scoreValidity(pct: number): number {
  return clamp(((pct - 80) / 20) * 100, 0, 100);
}

/** Piecewise-linear over p95 deviation, anchored in `SYNC_SCORE_ANCHORS`. */
export function scoreSynchronization(p95Ms: number): number {
  if (!Number.isFinite(p95Ms)) return 0;
  const anchors = SYNC_SCORE_ANCHORS;
  if (p95Ms <= anchors[0]![0]) return 100;
  for (let i = 1; i < anchors.length; i++) {
    const [prevMs, prevScore] = anchors[i - 1]!;
    const [currMs, currScore] = anchors[i]!;
    if (p95Ms <= currMs) {
      const t = (p95Ms - prevMs) / (currMs - prevMs);
      return clamp(prevScore + t * (currScore - prevScore), 0, 100);
    }
  }
  return 0;
}

/**
 * 0% out-of-order → 100, ~8% → 50, ≥16.7% → 0.
 * Gentler than the other dimensions because reordering is fixable downstream by
 * buffering to a watermark; it costs latency, not data.
 */
export function scoreOrdering(outOfOrderPct: number): number {
  return clamp(100 - outOfOrderPct * 6, 0, 100);
}

/** 0% duplicates → 100, ~4% → 50, ≥8.3% → 0. */
export function scoreDuplication(duplicationPct: number): number {
  return clamp(100 - duplicationPct * 12, 0, 100);
}

/* ---------------------------------------------------------------- */
/* Gates                                                             */
/* ---------------------------------------------------------------- */

export function evaluateGates(metrics: EpisodeMetrics): GateFailure[] {
  const failures: GateFailure[] = [];

  if (metrics.completeness_pct < QUALITY_GATES.min_completeness_pct) {
    failures.push({
      gate: 'completeness',
      observed: `${metrics.completeness_pct.toFixed(1)}%`,
      threshold: `≥ ${QUALITY_GATES.min_completeness_pct}%`,
      message: `Only ${metrics.completeness_pct.toFixed(1)}% of expected sensor events were received`,
    });
  }

  const CORE = ['camera', 'lidar', 'imu', 'odometry'];
  const weakestSensor = metrics.completeness
    .filter((c) => CORE.includes(c.sensor))
    .reduce<(typeof metrics.completeness)[number] | null>(
      (worst, c) => (!worst || c.pct < worst.pct ? c : worst),
      null,
    );
  if (weakestSensor && weakestSensor.pct < QUALITY_GATES.min_sensor_completeness_pct) {
    failures.push({
      gate: 'sensor_completeness',
      observed: `${weakestSensor.sensor} at ${weakestSensor.pct.toFixed(1)}%`,
      threshold: `≥ ${QUALITY_GATES.min_sensor_completeness_pct}% per sensor`,
      message: `${weakestSensor.sensor.toUpperCase()} delivered only ${weakestSensor.pct.toFixed(1)}% of expected samples — the weakest modality decides whether an episode is trainable`,
    });
  }

  if (metrics.validity_pct < QUALITY_GATES.min_validity_pct) {
    failures.push({
      gate: 'validity',
      observed: `${metrics.validity_pct.toFixed(1)}%`,
      threshold: `≥ ${QUALITY_GATES.min_validity_pct}%`,
      message: `${(100 - metrics.validity_pct).toFixed(1)}% of records failed schema or value validation`,
    });
  }

  if (metrics.sync_p95_ms > QUALITY_GATES.max_sync_p95_ms) {
    failures.push({
      gate: 'synchronization',
      observed: `p95 ${metrics.sync_p95_ms.toFixed(1)} ms`,
      threshold: `≤ ${QUALITY_GATES.max_sync_p95_ms} ms`,
      message: `Cross-sensor timestamp deviation p95 is ${metrics.sync_p95_ms.toFixed(1)} ms — frames cannot be reliably paired with robot state`,
    });
  }

  const worstDropout = metrics.dropouts.reduce<number>((max, d) => Math.max(max, d.duration_ms), 0);
  if (worstDropout > QUALITY_GATES.max_dropout_ms) {
    const worst = metrics.dropouts.find((d) => d.duration_ms === worstDropout);
    failures.push({
      gate: 'sensor_dropout',
      observed: `${(worstDropout / 1000).toFixed(2)} s (${worst?.sensor ?? 'sensor'})`,
      threshold: `≤ ${QUALITY_GATES.max_dropout_ms} ms`,
      message: `${worst?.sensor ?? 'A sensor'} dropped out for ${(worstDropout / 1000).toFixed(2)} s at t+${worst?.start_offset_s.toFixed(1) ?? '?'}s`,
    });
  }

  if (metrics.duplication_pct > QUALITY_GATES.max_duplication_pct) {
    failures.push({
      gate: 'duplication',
      observed: `${metrics.duplication_pct.toFixed(1)}%`,
      threshold: `≤ ${QUALITY_GATES.max_duplication_pct}%`,
      message: `${metrics.duplication_pct.toFixed(1)}% duplicate sequence IDs — the stream was replayed or double-published`,
    });
  }

  if (metrics.out_of_order_pct > QUALITY_GATES.max_out_of_order_pct) {
    failures.push({
      gate: 'ordering',
      observed: `${metrics.out_of_order_pct.toFixed(1)}%`,
      threshold: `≤ ${QUALITY_GATES.max_out_of_order_pct}%`,
      message: `${metrics.out_of_order_pct.toFixed(1)}% of events arrived out of timestamp order`,
    });
  }

  if (metrics.duration_s < QUALITY_GATES.min_duration_s) {
    failures.push({
      gate: 'duration',
      observed: `${metrics.duration_s.toFixed(1)} s`,
      threshold: `≥ ${QUALITY_GATES.min_duration_s} s`,
      message: `Episode is too short (${metrics.duration_s.toFixed(1)} s) to contain a complete task`,
    });
  }

  return failures;
}

/* ---------------------------------------------------------------- */
/* Engine                                                            */
/* ---------------------------------------------------------------- */

export function computeSubscores(metrics: EpisodeMetrics): QualitySubscores {
  const coreHealth = metrics.sensor_health.filter((h) =>
    ['camera', 'lidar', 'imu', 'odometry'].includes(h.sensor),
  );
  const healthScore = coreHealth.length
    ? coreHealth.reduce((sum, h) => sum + h.score, 0) / coreHealth.length
    : 0;

  return {
    completeness: round(scoreCompleteness(metrics.completeness_pct), 2),
    synchronization: round(scoreSynchronization(metrics.sync_p95_ms), 2),
    validity: round(scoreValidity(metrics.validity_pct), 2),
    ordering: round(scoreOrdering(metrics.out_of_order_pct), 2),
    duplication: round(scoreDuplication(metrics.duplication_pct), 2),
    sensor_health: round(healthScore, 2),
  };
}

export function weightedScore(subscores: QualitySubscores): number {
  const total =
    subscores.completeness * QUALITY_WEIGHTS.completeness +
    subscores.synchronization * QUALITY_WEIGHTS.synchronization +
    subscores.validity * QUALITY_WEIGHTS.validity +
    subscores.sensor_health * QUALITY_WEIGHTS.sensor_health +
    subscores.ordering * QUALITY_WEIGHTS.ordering +
    subscores.duplication * QUALITY_WEIGHTS.duplication;
  return round(clamp(total, 0, 100), 1);
}

const SUBSCORE_LABELS: Record<keyof QualitySubscores, string> = {
  completeness: 'completeness',
  synchronization: 'cross-sensor synchronization',
  validity: 'record validity',
  ordering: 'event ordering',
  duplication: 'duplicate suppression',
  sensor_health: 'sensor health',
};

/**
 * The decision function. Gates first, then bands, then an anomaly veto.
 *
 * GOOD    → TRAINING_READY : goes straight into a dataset build
 * WARNING → FLAGGED        : usable only if a build policy opts flagged data in
 * REJECTED                 : never enters a dataset, reasons always attached
 *
 * The anomaly veto exists because scores average. An episode can clear every
 * gate and still score 94 while containing an 800 ms LiDAR hole or an action
 * label that contradicts the odometry. Those are not "slightly worse data",
 * they are specific defects a human should look at before a model trains on
 * them — so any HIGH or CRITICAL anomaly blocks automatic inclusion.
 */
export function computeQuality(metrics: EpisodeMetrics, anomalies: Anomaly[] = []): QualityReport {
  const subscores = computeSubscores(metrics);
  const score = weightedScore(subscores);
  const gateFailures = evaluateGates(metrics);
  const severeAnomalies = anomalies.filter(
    (a) => a.severity === 'HIGH' || a.severity === 'CRITICAL',
  );

  let grade: QualityGrade;
  let status: EpisodeStatus;
  const reasons: string[] = [];

  if (gateFailures.length > 0) {
    grade = 'REJECTED';
    status = 'REJECTED';
    for (const failure of gateFailures) reasons.push(failure.message);
  } else if (score >= GRADE_BANDS.good && severeAnomalies.length === 0) {
    grade = 'GOOD';
    status = 'TRAINING_READY';
    reasons.push(
      `All quality gates passed with a weighted score of ${score.toFixed(1)}`,
      `Completeness ${metrics.completeness_pct.toFixed(1)}%, validity ${metrics.validity_pct.toFixed(1)}%, sync p95 ${metrics.sync_p95_ms.toFixed(1)} ms`,
    );
  } else if (score >= GRADE_BANDS.good) {
    grade = 'WARNING';
    status = 'FLAGGED';
    reasons.push(
      `Score ${score.toFixed(1)} clears the bar, but ${severeAnomalies.length} high-severity ${
        severeAnomalies.length === 1 ? 'anomaly blocks' : 'anomalies block'
      } automatic inclusion`,
      ...severeAnomalies.slice(0, 3).map((a) => `${a.severity}: ${a.message}`),
    );
  } else if (score >= GRADE_BANDS.warning) {
    grade = 'WARNING';
    status = 'FLAGGED';
    reasons.push(
      `Weighted score ${score.toFixed(1)} is below the ${GRADE_BANDS.good} threshold for automatic inclusion`,
    );
  } else {
    grade = 'REJECTED';
    status = 'REJECTED';
    reasons.push(`Weighted score ${score.toFixed(1)} is below the ${GRADE_BANDS.warning} minimum`);
  }

  // Always surface the two weakest dimensions — useful even for a passing episode.
  const weakest = (Object.entries(subscores) as Array<[keyof QualitySubscores, number]>)
    .sort((a, b) => a[1] - b[1])
    .filter(([, value]) => value < 90)
    .slice(0, 2);
  for (const [key, value] of weakest) {
    reasons.push(`Weakest dimension: ${SUBSCORE_LABELS[key]} at ${value.toFixed(1)}/100`);
  }

  return { subscores, score, grade, status, gate_failures: gateFailures, reasons };
}
