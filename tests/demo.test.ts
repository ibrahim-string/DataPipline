import { describe, expect, it } from 'vitest';

import { buildEpisode } from '@/lib/pipeline/episode';
import { DEMO_DURATION_S, DEMO_TIMELINE, planDemoEpisode } from '@/lib/sim/demo';
import { generateEvents } from '@/lib/sim/generator';
import { Rng } from '@/lib/sim/rng';

/**
 * The demo is the first thing anyone sees, and it makes specific promises: a
 * camera dropout at t+11, IMU drift from t+17, a gate-breaking LiDAR dropout at
 * t+28, invalid ranges at t+36, duplicates at t+40, and a REJECTED verdict that
 * names the reasons. These tests exist so a tuning change to the generator or
 * the thresholds cannot quietly turn the demo into a clean, boring episode.
 */
describe('scripted demo episode', () => {
  const plan = planDemoEpisode(1_750_000_000, 1);
  const events = generateEvents(new Rng('demo:1'), plan);
  const episode = buildEpisode(events, plan.ctx);

  it('produces a full multimodal stream of the expected size', () => {
    expect(episode.duration_s).toBeGreaterThan(DEMO_DURATION_S - 2);
    expect(episode.metrics.events_total).toBeGreaterThan(6_000);
    expect(episode.sensors).toContain('camera');
    expect(episode.sensors).toContain('lidar');
  });

  it('is rejected, and the rejection names the gates it broke', () => {
    expect(episode.quality.status).toBe('REJECTED');
    const gates = episode.quality.gate_failures.map((failure) => failure.gate);
    expect(gates).toContain('sensor_dropout');
    expect(gates).toContain('synchronization');
    expect(episode.quality.reasons.join(' ')).toMatch(/lidar/i);
  });

  it('detects the camera dropout at t+11 but keeps it inside the gate', () => {
    const dropout = episode.metrics.dropouts.find(
      (entry) => entry.sensor === 'camera' && entry.start_offset_s > 10 && entry.start_offset_s < 12,
    );
    expect(dropout).toBeDefined();
    // Long enough to raise a HIGH alert…
    expect(dropout!.duration_ms).toBeGreaterThan(600);
    // …but clear of the 1 s gate, with margin. The narrative depends on the
    // camera being survivable and the LiDAR being the one that rejects; at
    // 0.9 s the measured gap straddled the threshold and flipped between runs.
    expect(dropout!.duration_ms).toBeLessThan(900);
  });

  it('detects the gate-breaking LiDAR dropout at t+28', () => {
    const dropout = episode.metrics.dropouts.find(
      (entry) => entry.sensor === 'lidar' && entry.start_offset_s > 27 && entry.start_offset_s < 30,
    );
    expect(dropout).toBeDefined();
    expect(dropout!.duration_ms).toBeGreaterThan(1_000);
  });

  it('detects IMU clock drift that grows over the episode', () => {
    const pair = episode.metrics.sync.find((entry) => entry.pair === 'camera↔imu');
    expect(pair).toBeDefined();
    expect(pair!.p95_ms).toBeGreaterThan(50);

    const series = episode.sync_series;
    const early = series.find((sample) => sample.offset_s > 5 && sample.offset_s < 15);
    const late = series[series.length - 1];
    expect(Math.abs(late!.imu_ms)).toBeGreaterThan(Math.abs(early!.imu_ms) + 50);
  });

  it('detects invalid LiDAR values and duplicate publishes', () => {
    expect(episode.metrics.validity_pct).toBeLessThan(100);
    expect(episode.metrics.events_duplicate).toBeGreaterThan(0);

    const kinds = episode.anomalies.map((anomaly) => anomaly.kind);
    expect(kinds).toContain('INVALID_VALUES');
    expect(kinds).toContain('DUPLICATE_EVENTS');
    expect(kinds).toContain('TIMESTAMP_DRIFT');
    expect(kinds).toContain('SENSOR_DROPOUT');
  });

  it('raises at least one CRITICAL anomaly for the alert panel', () => {
    const critical = episode.anomalies.filter(
      (anomaly) => anomaly.severity === 'CRITICAL' || anomaly.severity === 'HIGH',
    );
    expect(critical.length).toBeGreaterThan(0);
  });

  it('keeps the narration in step with the injected faults', () => {
    for (const step of DEMO_TIMELINE) {
      expect(step.at).toBeGreaterThanOrEqual(0);
      expect(step.at).toBeLessThanOrEqual(DEMO_DURATION_S);
    }
    // Every fault in the plan should have a narration entry within 2 s of it.
    for (const fault of plan.faults) {
      const narrated = DEMO_TIMELINE.some((step) => Math.abs(step.at - fault.start_s) <= 2);
      expect(narrated, `no narration for ${fault.kind} at t+${fault.start_s}`).toBe(true);
    }
  });

  it('reports a positive transport latency despite the injected clock drift', () => {
    // Apparent latency is ingest − capture, so the drifting IMU reports a
    // shrinking and eventually negative value. Measuring on the reference clock
    // keeps this a transport number instead of a clock-skew artefact.
    expect(episode.metrics.ingest_latency_ms).toBeGreaterThan(0);
    expect(episode.metrics.ingest_latency_ms).toBeLessThan(200);
  });

  it('tells the same story on every episode number, not just the first', () => {
    for (let n = 1; n <= 5; n++) {
      const other = planDemoEpisode(1_750_000_000, n);
      const built = buildEpisode(generateEvents(new Rng(`demo:${n}`), other), other.ctx);
      const gates = built.quality.gate_failures.map((failure) => failure.gate);

      expect(built.quality.status, `episode ${n}`).toBe('REJECTED');
      expect(gates, `episode ${n}`).toContain('sensor_dropout');
      // The LiDAR gap is the gate breaker; the camera gap must never be.
      const worst = built.metrics.dropouts[0];
      expect(worst?.sensor, `episode ${n}`).toBe('lidar');
      expect(built.metrics.ingest_latency_ms, `episode ${n}`).toBeGreaterThan(0);
    }
  });

  it('is deterministic — the same seed gives the same verdict', () => {
    const again = buildEpisode(generateEvents(new Rng('demo:1'), planDemoEpisode(1_750_000_000, 1)), plan.ctx);
    expect(again.quality.score).toBe(episode.quality.score);
    expect(again.metrics.events_total).toBe(episode.metrics.events_total);
  });
});
