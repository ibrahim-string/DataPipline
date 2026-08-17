import { describe, expect, it } from 'vitest';

import { VALUE_LIMITS } from '@/lib/pipeline/config';
import { validateBatch, validateEvent } from '@/lib/pipeline/validate';
import { makeEvent, makeStream } from './helpers';

describe('record validation', () => {
  it('passes a clean event with no issues', () => {
    const result = validateEvent(makeEvent('imu', { offset: 1 }));
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('passes an entire clean stream', () => {
    const { valid, invalid, issues } = validateBatch(makeStream({ duration: 10 }));
    expect(invalid).toBe(0);
    expect(valid).toBeGreaterThan(0);
    expect(issues).toHaveLength(0);
  });

  describe('invalid numeric values', () => {
    it('rejects NaN', () => {
      const result = validateEvent(makeEvent('imu', { offset: 1, payload: { ax: Number.NaN } }));
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain('NAN_VALUE');
    });

    it('rejects Infinity', () => {
      const result = validateEvent(
        makeEvent('imu', { offset: 1, payload: { ay: Number.POSITIVE_INFINITY } }),
      );
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain('INFINITE_VALUE');
    });

    it('rejects -Infinity and names the field', () => {
      const result = validateEvent(
        makeEvent('odometry', { offset: 1, payload: { x: Number.NEGATIVE_INFINITY } }),
      );
      expect(result.ok).toBe(false);
      const issue = result.issues.find((i) => i.code === 'INFINITE_VALUE');
      expect(issue?.field).toBe('x');
      expect(issue?.detail).toContain('-Infinity');
    });

    it('rejects a missing numeric field', () => {
      const event = makeEvent('lidar', { offset: 1 });
      delete (event.payload as unknown as Record<string, unknown>).range_max;
      const result = validateEvent(event);
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain('MISSING_FIELD');
    });
  });

  describe('physical plausibility', () => {
    it('rejects a negative LiDAR range', () => {
      const result = validateEvent(makeEvent('lidar', { offset: 1, payload: { range_min: -0.4 } }));
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain('NEGATIVE_RANGE');
    });

    it('rejects a LiDAR range beyond the sensor spec', () => {
      const result = validateEvent(
        makeEvent('lidar', { offset: 1, payload: { range_max: VALUE_LIMITS.lidar_max_range + 50 } }),
      );
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain('OUT_OF_RANGE');
    });

    it('rejects an impossible acceleration', () => {
      const result = validateEvent(makeEvent('imu', { offset: 1, payload: { ax: 180 } }));
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain('IMPOSSIBLE_ACCELERATION');
    });

    it('accepts gravity, which is close to but under the limit', () => {
      const result = validateEvent(makeEvent('imu', { offset: 1, payload: { az: 9.81 } }));
      expect(result.ok).toBe(true);
    });

    it('rejects a commanded velocity above the safety limit', () => {
      const result = validateEvent(
        makeEvent('action', {
          offset: 1,
          payload: { linear_velocity: VALUE_LIMITS.max_linear_velocity + 0.4 },
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain('VELOCITY_LIMIT_EXCEEDED');
    });

    it('rejects a velocity limit breach in reverse too', () => {
      const result = validateEvent(
        makeEvent('action', {
          offset: 1,
          payload: { linear_velocity: -(VALUE_LIMITS.max_linear_velocity + 0.4) },
        }),
      );
      expect(result.ok).toBe(false);
    });

    it('rejects a state of charge outside [0,100]', () => {
      const result = validateEvent(makeEvent('battery', { offset: 1, payload: { percent: 128 } }));
      expect(result.ok).toBe(false);
    });

    it('rejects an action outside the vocabulary', () => {
      const result = validateEvent(makeEvent('action', { offset: 1, payload: { action: 'MOONWALK' } }));
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain('UNKNOWN_ACTION');
    });
  });

  describe('degradation is a warning, not an error', () => {
    it('flags a soft camera frame without failing the record', () => {
      const result = validateEvent(makeEvent('camera', { offset: 1, payload: { blur_score: 0.12 } }));
      expect(result.ok).toBe(true);
      const issue = result.issues.find((i) => i.code === 'CAMERA_DEGRADED');
      expect(issue?.level).toBe('warning');
    });

    it('flags a noisy point cloud without failing the record', () => {
      const result = validateEvent(
        makeEvent('lidar', { offset: 1, payload: { points: 10_000, invalid_points: 6_000 } }),
      );
      expect(result.ok).toBe(true);
      expect(result.issues.map((i) => i.code)).toContain('LIDAR_INVALID_RATIO');
    });

    it('flags negative transport latency as clock skew', () => {
      const event = makeEvent('imu', { offset: 1 });
      const skewed = { ...event, ingest_timestamp: event.timestamp - 0.2 };
      const result = validateEvent(skewed);
      expect(result.ok).toBe(true);
      expect(result.issues.map((i) => i.code)).toContain('NEGATIVE_LATENCY');
    });
  });

  it('reports every problem on a record, not just the first', () => {
    const result = validateEvent(
      makeEvent('lidar', { offset: 1, payload: { range_min: -1, range_max: 400, points: 0 } }),
    );
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});
