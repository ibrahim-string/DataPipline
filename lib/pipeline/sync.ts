import { mean, median, percentile, round } from '../format';
import type { Sensor, SyncPairMetric, SyncSample } from './types';

/**
 * Stage 4 — timestamp synchronization.
 *
 * Multimodal robot data is only useful if you can say *what the camera saw at
 * the moment the IMU reported that acceleration*. Sensors run on different
 * clocks, so we need to measure how far apart those clocks actually are.
 *
 * ## Why not nearest-neighbour matching?
 *
 * The obvious approach — for each camera frame find the nearest IMU sample and
 * call the difference "drift" — does not work, and it took building it to see
 * why. Both streams are periodic. If the IMU clock is 30 ms ahead at 100 Hz,
 * nearest-neighbour matching simply pairs each frame with a sample three slots
 * over and still reports ≤5 ms. Constant offset ALIASES away entirely: the
 * method can only ever see errors smaller than half the faster stream's period,
 * which is exactly the range nobody cares about.
 *
 * ## What we do instead
 *
 * Every event carries two timestamps: `timestamp` (stamped by the sensor, on the
 * sensor's clock) and `ingest_timestamp` (stamped by the collector, on one
 * shared clock). Their difference is the apparent latency:
 *
 *     latency(e) = ingest_timestamp(e) - timestamp(e)
 *
 * A sensor whose clock runs δ ms ahead reports timestamps δ ms too large, so its
 * apparent latency is δ ms too small. Comparing the apparent latency of two
 * sensors at the same moment therefore cancels the transport time they share and
 * leaves the clock difference:
 *
 *     skew(X vs camera, t) = latency(camera, t) - latency(X, t)
 *
 * This sees constant offset, sees drift as a ramp, and does not alias.
 *
 * ## Honest limitation
 *
 * It cannot separate a clock that is 20 ms ahead from a transport that is 20 ms
 * faster — both shift apparent latency. We partly disentangle them by reporting
 * the median (a persistent offset: clock skew) separately from the spread (noisy:
 * transport jitter). A production system would remove the ambiguity properly with
 * PTP-disciplined clocks or a hardware trigger line shared by the sensors, and
 * compare against that reference instead.
 */

/** Capture times and apparent latencies for one sensor, sorted by capture time. */
export interface SensorTiming {
  capture: number[];
  latency_ms: number[];
}

export type TimingBySensor = Partial<Record<Sensor, SensorTiming>>;

/** Reference clock. Camera is the modality VLA training keys off. */
const REFERENCE: Sensor = 'camera';
const COMPARED: readonly Sensor[] = ['imu', 'odometry', 'lidar'];

export interface SyncAnalysis {
  pairs: SyncPairMetric[];
  mean_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  /** Downsampled signed skew over the episode, for the synchronization chart. */
  series: SyncSample[];
}

/**
 * Signed skew of `other` against `reference`, sampled at every `other` event.
 * Both timings must be sorted by capture time. O(n + m).
 */
export function skewSeriesMs(reference: SensorTiming, other: SensorTiming): { at: number[]; skew: number[] } {
  const at: number[] = [];
  const skew: number[] = [];
  if (reference.capture.length === 0 || other.capture.length === 0) return { at, skew };

  let j = 0;
  for (let i = 0; i < other.capture.length; i++) {
    const t = other.capture[i]!;
    while (
      j + 1 < reference.capture.length &&
      Math.abs(reference.capture[j + 1]! - t) <= Math.abs(reference.capture[j]! - t)
    ) {
      j++;
    }
    at.push(t);
    skew.push(reference.latency_ms[j]! - other.latency_ms[i]!);
  }
  return { at, skew };
}

export function summarisePair(
  label: string,
  from: Sensor,
  to: Sensor,
  skewMs: number[],
): SyncPairMetric {
  const abs = skewMs.map(Math.abs);
  return {
    pair: label,
    from,
    to,
    mean_ms: round(mean(abs), 2),
    p95_ms: round(percentile(abs, 95), 2),
    p99_ms: round(percentile(abs, 99), 2),
    max_ms: round(maxOf(abs), 2),
    // Persistent component: a non-zero median is clock skew, not jitter.
    offset_ms: round(median(skewMs), 2),
    samples: skewMs.length,
  };
}

export function analyseSynchronization(
  timings: TimingBySensor,
  episodeStart: number,
  seriesPoints = 60,
): SyncAnalysis {
  const reference = timings[REFERENCE];
  const pairs: SyncPairMetric[] = [];
  const allAbs: number[] = [];
  const collected: Array<{ sensor: Sensor; at: number[]; skew: number[] }> = [];

  if (reference && reference.capture.length > 0) {
    for (const sensor of COMPARED) {
      const other = timings[sensor];
      if (!other || other.capture.length === 0) continue;
      const { at, skew } = skewSeriesMs(reference, other);
      if (skew.length === 0) continue;
      pairs.push(summarisePair(`${REFERENCE}↔${sensor}`, REFERENCE, sensor, skew));
      collected.push({ sensor, at, skew });
      for (const value of skew) allAbs.push(Math.abs(value));
    }
  }

  return {
    pairs,
    mean_ms: round(mean(allAbs), 2),
    p95_ms: round(percentile(allAbs, 95), 2),
    p99_ms: round(percentile(allAbs, 99), 2),
    max_ms: round(maxOf(allAbs), 2),
    series: buildSeries(collected, episodeStart, seriesPoints),
  };
}

/**
 * Bins the per-sensor skew onto one shared time axis. Necessary because the
 * three streams run at 5 / 25 / 100 Hz and cannot share raw sample indices.
 */
function buildSeries(
  collected: Array<{ sensor: Sensor; at: number[]; skew: number[] }>,
  episodeStart: number,
  points: number,
): SyncSample[] {
  if (collected.length === 0) return [];

  let span = 0;
  for (const entry of collected) {
    const last = entry.at[entry.at.length - 1];
    if (last !== undefined) span = Math.max(span, last - episodeStart);
  }
  if (span <= 0) return [];

  const binCount = Math.max(1, Math.min(points, Math.round(span)));
  const binWidth = span / binCount;

  const key = (sensor: Sensor): keyof Omit<SyncSample, 'offset_s'> =>
    sensor === 'imu' ? 'imu_ms' : sensor === 'lidar' ? 'lidar_ms' : 'odometry_ms';

  const sums = new Map<string, { sum: number; n: number }>();
  for (const entry of collected) {
    const field = key(entry.sensor);
    for (let i = 0; i < entry.skew.length; i++) {
      const bin = Math.min(binCount - 1, Math.max(0, Math.floor((entry.at[i]! - episodeStart) / binWidth)));
      const id = `${bin}|${field}`;
      const acc = sums.get(id) ?? { sum: 0, n: 0 };
      acc.sum += entry.skew[i]!;
      acc.n += 1;
      sums.set(id, acc);
    }
  }

  const read = (bin: number, field: string): number => {
    const acc = sums.get(`${bin}|${field}`);
    return acc && acc.n > 0 ? round(acc.sum / acc.n, 2) : 0;
  };

  return Array.from({ length: binCount }, (_, bin) => ({
    offset_s: round(bin * binWidth + binWidth / 2, 2),
    imu_ms: read(bin, 'imu_ms'),
    odometry_ms: read(bin, 'odometry_ms'),
    lidar_ms: read(bin, 'lidar_ms'),
  }));
}

/** Loop rather than `Math.max(...arr)` — these arrays reach tens of thousands. */
function maxOf(values: number[]): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i]! > max) max = values[i]!;
  }
  return max;
}
