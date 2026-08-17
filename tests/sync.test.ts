import { describe, expect, it } from 'vitest';

import { analyseSynchronization, skewSeriesMs, type SensorTiming } from '@/lib/pipeline/sync';
import { analyseStream } from '@/lib/pipeline/episode';
import { makeContext, makeStream, START } from './helpers';

function timing(rateHz: number, duration: number, latencyMs: number): SensorTiming {
  const count = Math.floor(duration * rateHz);
  return {
    capture: Array.from({ length: count }, (_, i) => START + i / rateHz),
    latency_ms: Array.from({ length: count }, () => latencyMs),
  };
}

describe('timestamp synchronization', () => {
  it('reports ~0 skew for perfectly aligned clocks', () => {
    const reference = timing(15, 20, 30);
    const other = timing(100, 20, 30);
    const { skew } = skewSeriesMs(reference, other);
    expect(skew.every((value) => Math.abs(value) < 1e-9)).toBe(true);
  });

  it('measures a constant clock offset', () => {
    // The IMU clock runs 40 ms ahead, so its apparent latency is 40 ms lower.
    const reference = timing(15, 20, 30);
    const other = timing(100, 20, -10);
    const { skew } = skewSeriesMs(reference, other);
    expect(skew[0]).toBeCloseTo(40, 6);
  });

  it('does not alias a large constant offset away', () => {
    // Regression test for the method this replaced: nearest-neighbour matching
    // between two periodic streams reports ≤ half the fast period no matter how
    // far apart the clocks are. Here a 40 ms offset must survive intact even
    // though the IMU period is only 10 ms.
    const analysis = analyseSynchronization(
      { camera: timing(15, 20, 30), imu: timing(100, 20, -10) },
      START,
    );
    const pair = analysis.pairs.find((p) => p.pair === 'camera↔imu');
    expect(pair).toBeDefined();
    expect(Math.abs(pair!.offset_ms)).toBeGreaterThan(35);
    expect(analysis.p95_ms).toBeGreaterThan(35);
  });

  it('detects progressive clock drift as a growing skew', () => {
    const events = analyseStream(
      makeStream({ duration: 30, drift: { imu: 4 } }), // 4 ms of drift per second
      makeContext(),
    );
    const pair = events.metrics.sync.find((p) => p.pair === 'camera↔imu');
    expect(pair).toBeDefined();
    // 30 s at 4 ms/s ends around 120 ms apart; p95 must be well into that range.
    expect(pair!.p95_ms).toBeGreaterThan(80);
    expect(events.metrics.sync_p95_ms).toBeGreaterThan(80);
  });

  it('separates constant offset from jitter via the median', () => {
    const constant = analyseSynchronization(
      { camera: timing(15, 20, 30), imu: timing(100, 20, 10) },
      START,
    ).pairs[0]!;
    // A persistent offset shows up in the median…
    expect(Math.abs(constant.offset_ms)).toBeCloseTo(20, 6);
    // …and the spread around it is zero, so this is skew, not jitter.
    expect(constant.p99_ms).toBeCloseTo(20, 6);
  });

  it('reports a clean stream as well synchronized', () => {
    const analysis = analyseStream(makeStream({ duration: 20 }), makeContext());
    expect(analysis.metrics.sync_p95_ms).toBeLessThan(1);
  });

  it('produces a drift series that grows over the episode', () => {
    const analysis = analyseStream(makeStream({ duration: 30, drift: { imu: 4 } }), makeContext());
    const series = analysis.syncSeries;
    expect(series.length).toBeGreaterThan(5);
    const first = Math.abs(series[0]!.imu_ms);
    const last = Math.abs(series[series.length - 1]!.imu_ms);
    expect(last).toBeGreaterThan(first + 50);
  });

  it('skips pairs with no data instead of throwing', () => {
    const analysis = analyseSynchronization({ camera: timing(15, 10, 30) }, START);
    expect(analysis.pairs).toHaveLength(0);
    expect(analysis.p95_ms).toBe(0);
  });
});
