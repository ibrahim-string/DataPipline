import { describe, expect, it } from 'vitest';

import { QUALITY_GATES, SIM_RATES_HZ } from '@/lib/pipeline/config';
import { analyseStream, buildEpisode, toSummary } from '@/lib/pipeline/episode';
import type { Sensor } from '@/lib/pipeline/types';
import {
  corruptEvery,
  delayEvery,
  dropWindow,
  duplicateEvery,
  makeContext,
  makeEvent,
  makeStream,
  START,
} from './helpers';

describe('episode assembly', () => {
  describe('a clean episode', () => {
    const episode = buildEpisode(makeStream({ duration: 30 }), makeContext());

    it('is accepted as training-ready', () => {
      expect(episode.quality.status).toBe('TRAINING_READY');
      expect(episode.quality.gate_failures).toHaveLength(0);
    });

    it('reports near-perfect completeness and validity', () => {
      expect(episode.metrics.completeness_pct).toBeGreaterThan(99);
      expect(episode.metrics.validity_pct).toBe(100);
      expect(episode.metrics.events_duplicate).toBe(0);
      expect(episode.metrics.events_out_of_order).toBe(0);
    });

    it('measures the episode duration from the telemetry, not the context', () => {
      expect(episode.duration_s).toBeGreaterThan(29);
      expect(episode.duration_s).toBeLessThanOrEqual(30);
    });

    it('has no anomalies worth reporting', () => {
      expect(episode.anomalies.filter((a) => a.severity !== 'LOW')).toHaveLength(0);
    });

    it('produces the series the UI needs', () => {
      expect(episode.timeline.length).toBeGreaterThan(0);
      expect(episode.sync_series.length).toBeGreaterThan(0);
      expect(episode.motion_series.length).toBeGreaterThan(0);
      expect(episode.event_samples.length).toBeGreaterThan(0);
    });

    it('projects to a summary without losing the verdict', () => {
      const summary = toSummary(episode);
      expect(summary.episode_id).toBe(episode.episode_id);
      expect(summary.score).toBe(episode.quality.score);
      expect(summary.status).toBe(episode.quality.status);
    });
  });

  describe('missing sensor events', () => {
    it('counts a dropout and attributes it to the right sensor', () => {
      const events = dropWindow(makeStream({ duration: 30 }), 'lidar', 10, 11.4);
      const { metrics } = analyseStream(events, makeContext());
      const dropout = metrics.dropouts.find((d) => d.sensor === 'lidar');
      expect(dropout).toBeDefined();
      expect(dropout!.duration_ms).toBeGreaterThan(1300);
      expect(dropout!.start_offset_s).toBeCloseTo(9.8, 1);
    });

    it('rejects an episode whose dropout exceeds the gate', () => {
      const events = dropWindow(makeStream({ duration: 30 }), 'lidar', 10, 12);
      const episode = buildEpisode(events, makeContext());
      expect(episode.quality.status).toBe('REJECTED');
      expect(episode.quality.gate_failures.map((g) => g.gate)).toContain('sensor_dropout');
      expect(episode.quality.reasons.join(' ')).toMatch(/lidar/i);
    });

    it('does not call normal sampling intervals a dropout', () => {
      const { metrics } = analyseStream(makeStream({ duration: 30 }), makeContext());
      expect(metrics.dropouts).toHaveLength(0);
    });

    it('drops completeness when samples go missing', () => {
      const events = dropWindow(makeStream({ duration: 30 }), 'imu', 5, 15);
      const { metrics } = analyseStream(events, makeContext());
      const imu = metrics.completeness.find((c) => c.sensor === 'imu');
      expect(imu!.pct).toBeCloseTo(66.7, 0);
      expect(metrics.completeness_pct).toBeLessThan(95);
    });

    it('treats a stream that never appeared as a full-episode dropout', () => {
      const sensors: Sensor[] = ['camera', 'lidar', 'imu', 'odometry', 'action', 'battery'];
      const events = makeStream({ duration: 20, sensors: sensors.filter((s) => s !== 'lidar') });
      const { metrics } = analyseStream(events, makeContext({ sensors }));
      const dropout = metrics.dropouts.find((d) => d.sensor === 'lidar');
      expect(dropout).toBeDefined();
      expect(dropout!.duration_ms).toBeGreaterThan(19_000);
      expect(metrics.completeness.find((c) => c.sensor === 'lidar')!.pct).toBe(0);
    });

    it('does not penalise a sensor the robot was never fitted with', () => {
      const sensors: Sensor[] = ['camera', 'imu', 'odometry', 'action', 'battery'];
      const events = makeStream({ duration: 20, sensors });
      const episode = buildEpisode(events, makeContext({ sensors }));
      expect(episode.metrics.dropouts).toHaveLength(0);
      expect(episode.quality.status).toBe('TRAINING_READY');
    });
  });

  describe('duplicate events', () => {
    it('counts duplicates and excludes them from the unique stream', () => {
      const base = makeStream({ duration: 20 });
      const events = duplicateEvery(base, 'imu', 4);
      const { metrics, uniqueEvents } = analyseStream(events, makeContext());
      expect(metrics.events_duplicate).toBeGreaterThan(400);
      expect(metrics.events_total).toBe(events.length);
      expect(uniqueEvents).toHaveLength(base.length);
      expect(metrics.duplication_pct).toBeGreaterThan(10);
    });

    it('rejects a stream with pathological duplication', () => {
      const events = duplicateEvery(makeStream({ duration: 20 }), 'imu', 1);
      const episode = buildEpisode(events, makeContext());
      expect(episode.quality.gate_failures.map((g) => g.gate)).toContain('duplication');
      expect(episode.quality.status).toBe('REJECTED');
    });

    it('does not let duplicates inflate completeness', () => {
      const events = duplicateEvery(makeStream({ duration: 20 }), 'imu', 2);
      const { metrics } = analyseStream(events, makeContext());
      const imu = metrics.completeness.find((c) => c.sensor === 'imu');
      expect(imu!.pct).toBeLessThanOrEqual(100);
    });
  });

  describe('out-of-order events', () => {
    it('detects events that arrive after later-captured events', () => {
      const events = delayEvery(makeStream({ duration: 20 }), 'imu', 10, 0.6);
      const { metrics } = analyseStream(events, makeContext());
      expect(metrics.events_out_of_order).toBeGreaterThan(100);
      expect(metrics.out_of_order_pct).toBeGreaterThan(3);
    });

    it('finds no reordering in a stream delivered in capture order', () => {
      const { metrics } = analyseStream(makeStream({ duration: 20 }), makeContext());
      expect(metrics.events_out_of_order).toBe(0);
    });

    it('rejects pathological reordering', () => {
      const events = delayEvery(makeStream({ duration: 20 }), 'imu', 2, 1.5);
      const episode = buildEpisode(events, makeContext());
      expect(episode.quality.gate_failures.map((g) => g.gate)).toContain('ordering');
    });
  });

  describe('invalid values', () => {
    it('excludes invalid records from validity but still counts them as received', () => {
      const events = corruptEvery(makeStream({ duration: 20 }), 'imu', 5, { ax: Number.NaN });
      const { metrics } = analyseStream(events, makeContext());
      expect(metrics.validity_pct).toBeLessThan(95);
      expect(metrics.issues_by_code.NAN_VALUE).toBeGreaterThan(300);
      expect(metrics.events_total).toBe(events.length);
    });

    it('rejects an episode whose validity falls below the gate', () => {
      const events = corruptEvery(makeStream({ duration: 20 }), 'imu', 1, {
        ax: Number.POSITIVE_INFINITY,
      });
      const episode = buildEpisode(events, makeContext());
      expect(episode.quality.gate_failures.map((g) => g.gate)).toContain('validity');
      expect(episode.quality.status).toBe('REJECTED');
    });

    it('raises an INVALID_VALUES anomaly naming the dominant code', () => {
      const events = corruptEvery(makeStream({ duration: 20 }), 'lidar', 2, { range_min: -3 });
      const { anomalies } = analyseStream(events, makeContext());
      const anomaly = anomalies.find((a) => a.kind === 'INVALID_VALUES');
      expect(anomaly).toBeDefined();
      expect(anomaly!.detail).toContain('NEGATIVE_RANGE');
    });
  });

  describe('timestamp drift', () => {
    it('rejects an episode whose clocks have drifted apart', () => {
      const episode = buildEpisode(makeStream({ duration: 30, drift: { imu: 4 } }), makeContext());
      expect(episode.metrics.sync_p95_ms).toBeGreaterThan(QUALITY_GATES.max_sync_p95_ms);
      expect(episode.quality.gate_failures.map((g) => g.gate)).toContain('synchronization');
    });

    it('distinguishes a constant offset from jitter in the anomaly detail', () => {
      const episode = buildEpisode(
        makeStream({ duration: 30, clockOffsets: { imu: 0.045 } }),
        makeContext(),
      );
      const anomaly = episode.anomalies.find((a) => a.kind === 'TIMESTAMP_DRIFT');
      expect(anomaly).toBeDefined();
      expect(anomaly!.detail).toContain('constant clock skew');
    });
  });

  describe('action / odometry disagreement', () => {
    const context = makeContext({ sensors: ['action', 'odometry'] });

    function stopEpisode(moving: boolean) {
      const events = [];
      const actionRate = SIM_RATES_HZ.action;
      const odomRate = SIM_RATES_HZ.odometry;
      const duration = 12;
      let seq = 0;
      for (let i = 0; i < duration * actionRate; i++) {
        events.push(
          makeEvent('action', {
            offset: i / actionRate,
            sequence_id: seq++,
            payload: { action: 'STOP', linear_velocity: 0, angular_velocity: 0 },
          }),
        );
      }
      for (let i = 0; i < duration * odomRate; i++) {
        const t = i / odomRate;
        events.push(
          makeEvent('odometry', {
            offset: t,
            sequence_id: seq++,
            payload: { x: moving ? 0.5 * t : 1.5, y: 2.5, theta: 0.4 },
          }),
        );
      }
      return events.sort((a, b) => a.ingest_timestamp - b.ingest_timestamp);
    }

    it('flags a STOP label while the base keeps moving', () => {
      const { anomalies } = analyseStream(stopEpisode(true), context);
      const mismatch = anomalies.find((a) => a.kind === 'ACTION_STATE_MISMATCH');
      expect(mismatch).toBeDefined();
      expect(mismatch!.message).toContain('STOP');
    });

    it('does not flag a genuinely stationary robot', () => {
      const { anomalies } = analyseStream(stopEpisode(false), context);
      expect(anomalies.find((a) => a.kind === 'ACTION_STATE_MISMATCH')).toBeUndefined();
    });
  });

  describe('battery anomalies', () => {
    it('flags a state-of-charge collapse', () => {
      const events = makeStream({ duration: 20, sensors: ['battery', 'camera'] });
      const patched = events.map((event) => {
        if (event.sensor !== 'battery') return event;
        const offset = event.timestamp - START;
        return {
          ...event,
          payload: { ...event.payload, percent: offset < 10 ? 80 : 55 },
        } as typeof event;
      });
      const { anomalies } = analyseStream(patched, makeContext({ sensors: ['battery', 'camera'] }));
      const anomaly = anomalies.find((a) => a.kind === 'BATTERY_ANOMALY');
      expect(anomaly).toBeDefined();
      expect(anomaly!.severity).toBe('CRITICAL');
    });
  });

  describe('short episodes', () => {
    it('rejects an episode too short to contain a task', () => {
      const episode = buildEpisode(makeStream({ duration: 3 }), makeContext());
      expect(episode.quality.gate_failures.map((g) => g.gate)).toContain('duration');
    });
  });

  describe('empty input', () => {
    it('does not throw on an episode with no events', () => {
      const episode = buildEpisode([], makeContext());
      expect(episode.quality.status).toBe('REJECTED');
      expect(episode.metrics.events_total).toBe(0);
      expect(Number.isFinite(episode.duration_s)).toBe(true);
    });
  });
});
