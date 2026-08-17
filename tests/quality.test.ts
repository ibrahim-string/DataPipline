import { describe, expect, it } from 'vitest';

import { GRADE_BANDS, QUALITY_GATES, QUALITY_WEIGHTS } from '@/lib/pipeline/config';
import {
  computeQuality,
  computeSubscores,
  evaluateGates,
  scoreCompleteness,
  scoreDuplication,
  scoreOrdering,
  scoreSynchronization,
  scoreValidity,
  weightedScore,
} from '@/lib/pipeline/quality';
import type { Anomaly } from '@/lib/pipeline/types';
import { makeMetrics } from './helpers';

function anomaly(overrides: Partial<Anomaly> = {}): Anomaly {
  return {
    id: 'a1',
    kind: 'SENSOR_DROPOUT',
    sensor: 'lidar',
    severity: 'HIGH',
    message: 'LIDAR dropout: 0.80 s',
    start_offset_s: 4,
    end_offset_s: 4.8,
    ...overrides,
  };
}

describe('quality engine', () => {
  describe('configuration invariants', () => {
    it('has weights that sum to exactly 1', () => {
      const total = Object.values(QUALITY_WEIGHTS).reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(1, 10);
    });

    it('has a review band between the warning and good thresholds', () => {
      expect(GRADE_BANDS.good).toBeGreaterThan(GRADE_BANDS.warning);
    });
  });

  describe('subscore mappings', () => {
    it('maps completeness monotonically', () => {
      expect(scoreCompleteness(100)).toBe(100);
      expect(scoreCompleteness(90)).toBeCloseTo(75, 6);
      expect(scoreCompleteness(80)).toBeCloseTo(50, 6);
      expect(scoreCompleteness(50)).toBe(0);
    });

    it('penalises validity more steeply than completeness', () => {
      expect(scoreValidity(90)).toBeLessThan(scoreCompleteness(90));
      expect(scoreValidity(100)).toBe(100);
      expect(scoreValidity(70)).toBe(0);
    });

    it('interpolates synchronization between anchors', () => {
      expect(scoreSynchronization(2)).toBe(100);
      expect(scoreSynchronization(5)).toBe(100);
      expect(scoreSynchronization(50)).toBeCloseTo(50, 6);
      expect(scoreSynchronization(10)).toBeGreaterThan(scoreSynchronization(20));
      expect(scoreSynchronization(500)).toBe(0);
    });

    it('maps ordering monotonically', () => {
      expect(scoreOrdering(0)).toBe(100);
      expect(scoreOrdering(8)).toBeCloseTo(52, 6);
      expect(scoreOrdering(50)).toBe(0);
    });

    it('penalises duplication', () => {
      expect(scoreDuplication(0)).toBe(100);
      expect(scoreDuplication(5)).toBeCloseTo(40, 6);
      expect(scoreDuplication(100)).toBe(0);
    });

    it('clamps every mapping into [0,100]', () => {
      for (const value of [-50, 0, 50, 150, 1e6]) {
        for (const fn of [scoreCompleteness, scoreValidity, scoreSynchronization, scoreOrdering, scoreDuplication]) {
          const score = fn(value);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
        }
      }
    });
  });

  describe('weighted score', () => {
    it('gives 100 to a flawless episode', () => {
      expect(weightedScore(computeSubscores(makeMetrics()))).toBe(100);
    });

    it('weights completeness above ordering', () => {
      const viaCompleteness = weightedScore(
        computeSubscores(makeMetrics({ completeness_pct: 80 })),
      );
      const viaOrdering = weightedScore(computeSubscores(makeMetrics({ out_of_order_pct: 8 })));
      expect(viaCompleteness).toBeLessThan(viaOrdering);
    });

    it('treats out-of-order arrival more leniently than data loss, via weighting', () => {
      // Reordering is recoverable by buffering to a watermark; loss is not. The
      // leniency lives in the weights, not in the subscore mapping.
      const loss = weightedScore(computeSubscores(makeMetrics({ completeness_pct: 95 })));
      const reorder = weightedScore(computeSubscores(makeMetrics({ out_of_order_pct: 5 })));
      expect(reorder).toBeGreaterThan(loss);
    });

    it('dilutes a single bad dimension — which is exactly why gates exist', () => {
      // 45 ms p95 is a serious synchronization problem, yet five healthy
      // dimensions keep the weighted score comfortably above the reject band.
      const score = weightedScore(computeSubscores(makeMetrics({ sync_p95_ms: 45 })));
      expect(score).toBeGreaterThan(GRADE_BANDS.warning + 15);
    });
  });

  describe('hard gates', () => {
    it('passes a flawless episode', () => {
      expect(evaluateGates(makeMetrics())).toHaveLength(0);
    });

    it('fails on low overall completeness', () => {
      const failures = evaluateGates(makeMetrics({ completeness_pct: 70 }));
      expect(failures.map((f) => f.gate)).toContain('completeness');
    });

    it('fails when one modality is starved even if the average looks fine', () => {
      const metrics = makeMetrics({
        completeness_pct: 94,
        completeness: [
          { sensor: 'camera', expected: 100, received: 100, pct: 100 },
          { sensor: 'imu', expected: 100, received: 100, pct: 100 },
          { sensor: 'odometry', expected: 100, received: 100, pct: 100 },
          { sensor: 'lidar', expected: 100, received: 40, pct: 40 },
        ],
      });
      const failures = evaluateGates(metrics);
      expect(failures.map((f) => f.gate)).toContain('sensor_completeness');
    });

    it('fails on a dropout longer than the threshold', () => {
      const metrics = makeMetrics({
        dropouts: [
          {
            sensor: 'lidar',
            start_offset_s: 12,
            end_offset_s: 13.4,
            duration_ms: QUALITY_GATES.max_dropout_ms + 400,
            missed_events: 7,
          },
        ],
      });
      const failures = evaluateGates(metrics);
      expect(failures.map((f) => f.gate)).toContain('sensor_dropout');
      expect(failures.find((f) => f.gate === 'sensor_dropout')?.message).toContain('lidar');
    });

    it('tolerates a dropout just under the threshold', () => {
      const metrics = makeMetrics({
        dropouts: [
          {
            sensor: 'lidar',
            start_offset_s: 12,
            end_offset_s: 12.9,
            duration_ms: QUALITY_GATES.max_dropout_ms - 100,
            missed_events: 4,
          },
        ],
      });
      expect(evaluateGates(metrics).map((f) => f.gate)).not.toContain('sensor_dropout');
    });

    it('fails on excessive synchronization deviation', () => {
      const failures = evaluateGates(makeMetrics({ sync_p95_ms: QUALITY_GATES.max_sync_p95_ms + 5 }));
      expect(failures.map((f) => f.gate)).toContain('synchronization');
    });

    it('fails on low validity, duplication, ordering and short duration', () => {
      expect(evaluateGates(makeMetrics({ validity_pct: 50 })).map((f) => f.gate)).toContain('validity');
      expect(evaluateGates(makeMetrics({ duplication_pct: 30 })).map((f) => f.gate)).toContain('duplication');
      expect(evaluateGates(makeMetrics({ out_of_order_pct: 40 })).map((f) => f.gate)).toContain('ordering');
      expect(evaluateGates(makeMetrics({ duration_s: 2 })).map((f) => f.gate)).toContain('duration');
    });

    it('reports every failing gate, not just the first', () => {
      const failures = evaluateGates(
        makeMetrics({ completeness_pct: 40, validity_pct: 40, sync_p95_ms: 400 }),
      );
      expect(failures.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('accept / reject decision', () => {
    it('accepts a flawless episode as training-ready', () => {
      const report = computeQuality(makeMetrics());
      expect(report.grade).toBe('GOOD');
      expect(report.status).toBe('TRAINING_READY');
      expect(report.gate_failures).toHaveLength(0);
    });

    it('rejects a gate failure regardless of a high weighted score', () => {
      const metrics = makeMetrics({
        dropouts: [
          {
            sensor: 'lidar',
            start_offset_s: 3,
            end_offset_s: 4.4,
            duration_ms: 1400,
            missed_events: 7,
          },
        ],
      });
      const report = computeQuality(metrics);
      expect(report.score).toBeGreaterThan(GRADE_BANDS.good);
      expect(report.status).toBe('REJECTED');
    });

    it('always explains a rejection', () => {
      const report = computeQuality(makeMetrics({ completeness_pct: 40 }));
      expect(report.status).toBe('REJECTED');
      expect(report.reasons.length).toBeGreaterThan(0);
      expect(report.reasons.join(' ')).toMatch(/complete/i);
    });

    it('flags a mid-band score for human review', () => {
      const report = computeQuality(
        makeMetrics({ completeness_pct: 90, sync_p95_ms: 40, validity_pct: 96 }),
      );
      expect(report.score).toBeGreaterThanOrEqual(GRADE_BANDS.warning);
      expect(report.score).toBeLessThan(GRADE_BANDS.good);
      expect(report.status).toBe('FLAGGED');
    });

    it('blocks auto-inclusion when a high-severity anomaly survives the gates', () => {
      const clean = computeQuality(makeMetrics());
      expect(clean.status).toBe('TRAINING_READY');

      const vetoed = computeQuality(makeMetrics(), [anomaly()]);
      expect(vetoed.score).toBe(clean.score);
      expect(vetoed.status).toBe('FLAGGED');
      expect(vetoed.reasons.join(' ')).toContain('LIDAR dropout');
    });

    it('does not veto on low-severity anomalies', () => {
      const report = computeQuality(makeMetrics(), [anomaly({ severity: 'LOW' }), anomaly({ severity: 'MEDIUM' })]);
      expect(report.status).toBe('TRAINING_READY');
    });

    it('rejects anything below the warning band', () => {
      const report = computeQuality(makeMetrics({ sync_p95_ms: 49, completeness_pct: 86, validity_pct: 91 }));
      expect(report.score).toBeLessThan(GRADE_BANDS.warning);
      expect(report.status).toBe('REJECTED');
    });

    it('surfaces the weakest dimensions even on a passing episode', () => {
      const report = computeQuality(makeMetrics({ sync_p95_ms: 20 }));
      expect(report.status).toBe('TRAINING_READY');
      expect(report.reasons.some((r) => r.includes('Weakest dimension'))).toBe(true);
    });
  });
});
