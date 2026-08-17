import { describe, expect, it } from 'vitest';

import { buildDataset, nextVersion, toCandidate, type DatasetCandidate } from '@/lib/pipeline/dataset';
import { serialiseManifest, toCsv, toJsonl } from '@/lib/pipeline/export';
import { buildEpisode } from '@/lib/pipeline/episode';
import { makeContext, makeStream } from './helpers';

function candidate(overrides: Partial<DatasetCandidate> = {}): DatasetCandidate {
  return {
    episode_id: 'episode-0001',
    robot_id: 'robot-001',
    site: 'Kita General Hospital',
    task: 'navigate_to_room',
    task_label: 'Navigate to Room 204',
    started_at: '2026-07-01T09:00:00.000Z',
    duration_s: 34,
    sensors: ['camera', 'lidar', 'imu', 'odometry', 'action', 'battery'],
    score: 95,
    grade: 'GOOD',
    status: 'TRAINING_READY',
    completeness_pct: 99.5,
    validity_pct: 100,
    sync_p95_ms: 4,
    events_total: 5000,
    anomaly_count: 0,
    gate_failures: [],
    ...overrides,
  };
}

describe('dataset versioning', () => {
  it('includes training-ready episodes that clear the policy', () => {
    const { version, manifest, excluded } = buildDataset({
      dataset: 'hospital-navigation',
      version: 'v0.3',
      candidates: [candidate({ episode_id: 'a' }), candidate({ episode_id: 'b' })],
    });
    expect(version.full_name).toBe('hospital-navigation-v0.3');
    expect(version.episode_ids).toEqual(['a', 'b']);
    expect(manifest).toHaveLength(2);
    expect(excluded).toHaveLength(0);
  });

  it('excludes rejected episodes and says which gate did it', () => {
    const { excluded, version } = buildDataset({
      dataset: 'd',
      version: 'v0.1',
      candidates: [
        candidate({ episode_id: 'ok' }),
        candidate({
          episode_id: 'bad',
          status: 'REJECTED',
          grade: 'REJECTED',
          score: 41,
          gate_failures: ['sensor_dropout'],
        }),
      ],
    });
    expect(version.episode_ids).toEqual(['ok']);
    expect(excluded[0]!.reason).toContain('sensor_dropout');
  });

  it('honours the include_flagged policy switch in both directions', () => {
    const candidates = [
      candidate({ episode_id: 'ready' }),
      candidate({ episode_id: 'flagged', status: 'FLAGGED', grade: 'WARNING', score: 86 }),
    ];

    const strict = buildDataset({ dataset: 'd', version: 'v0.1', candidates });
    expect(strict.version.episode_ids).toEqual(['ready']);
    expect(strict.excluded[0]!.reason).toMatch(/flagged/i);

    const permissive = buildDataset({
      dataset: 'd',
      version: 'v0.2',
      candidates,
      policy: { include_flagged: true, min_quality_score: 80 },
    });
    expect(permissive.version.episode_ids).toEqual(['ready', 'flagged']);
  });

  it('applies the score floor, duration floor and required sensors', () => {
    const { excluded } = buildDataset({
      dataset: 'd',
      version: 'v0.1',
      candidates: [
        candidate({ episode_id: 'low-score', score: 86 }),
        candidate({ episode_id: 'short', duration_s: 4 }),
        candidate({ episode_id: 'no-lidar', sensors: ['camera', 'imu', 'odometry'] }),
      ],
      policy: { min_quality_score: 88, min_duration_s: 8 },
    });
    const reasons = Object.fromEntries(excluded.map((e) => [e.episode_id, e.reason]));
    expect(reasons['low-score']).toMatch(/below policy minimum/i);
    expect(reasons['short']).toMatch(/shorter than policy minimum/i);
    expect(reasons['no-lidar']).toMatch(/missing required sensor: lidar/i);
  });

  it('computes statistics over the included episodes only', () => {
    const { version } = buildDataset({
      dataset: 'd',
      version: 'v0.1',
      candidates: [
        candidate({ episode_id: 'a', score: 90, duration_s: 30, events_total: 1000 }),
        candidate({ episode_id: 'b', score: 100, duration_s: 20, events_total: 2000 }),
        candidate({ episode_id: 'c', score: 30, status: 'REJECTED', gate_failures: ['validity'] }),
      ],
    });
    expect(version.stats.candidates).toBe(3);
    expect(version.stats.included).toBe(2);
    expect(version.stats.rejected).toBe(1);
    expect(version.stats.avg_quality).toBe(95);
    expect(version.stats.min_quality).toBe(90);
    expect(version.stats.total_duration_s).toBe(50);
    expect(version.stats.total_events).toBe(3000);
    expect(version.stats.estimated_size_bytes).toBeGreaterThan(0);
  });

  it('aggregates exclusion reasons for the build report', () => {
    const { version } = buildDataset({
      dataset: 'd',
      version: 'v0.1',
      candidates: [
        candidate({ episode_id: '1', status: 'REJECTED', gate_failures: ['sensor_dropout'] }),
        candidate({ episode_id: '2', status: 'REJECTED', gate_failures: ['sensor_dropout'] }),
        candidate({ episode_id: '3', status: 'REJECTED', gate_failures: ['validity'] }),
      ],
    });
    expect(version.stats.exclusions[0]).toEqual({
      reason: 'Failed quality gate: sensor_dropout',
      count: 2,
    });
  });

  it('is deterministic — the same inputs and policy give the same members', () => {
    const candidates = [candidate({ episode_id: 'a' }), candidate({ episode_id: 'b', score: 91 })];
    const first = buildDataset({ dataset: 'd', version: 'v0.1', candidates, created_at: 'x' });
    const second = buildDataset({ dataset: 'd', version: 'v0.1', candidates, created_at: 'x' });
    expect(first.version).toEqual(second.version);
  });

  it('handles an empty candidate set without dividing by zero', () => {
    const { version } = buildDataset({ dataset: 'd', version: 'v0.1', candidates: [] });
    expect(version.stats.included).toBe(0);
    expect(version.stats.avg_quality).toBe(0);
    expect(Number.isFinite(version.stats.min_quality)).toBe(true);
  });

  it('increments minor versions', () => {
    expect(nextVersion('v0.3')).toBe('v0.4');
    expect(nextVersion('v1.9')).toBe('v1.10');
    expect(nextVersion('nonsense')).toBe('v0.1');
  });

  it('derives a candidate from a real pipeline episode', () => {
    const episode = buildEpisode(makeStream({ duration: 20 }), makeContext());
    const derived = toCandidate(episode);
    expect(derived.episode_id).toBe(episode.episode_id);
    expect(derived.score).toBe(episode.quality.score);
    expect(derived.status).toBe(episode.quality.status);
    expect(derived.sensors).toEqual(episode.sensors);
  });
});

describe('manifest export', () => {
  const built = buildDataset({
    dataset: 'hospital-navigation',
    version: 'v0.3',
    candidates: [candidate({ episode_id: 'a' }), candidate({ episode_id: 'b' })],
  });

  it('writes one JSON line per episode', () => {
    const lines = toJsonl(built.manifest).split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).episode_id).toBe('a');
    expect(JSON.parse(lines[0]!).dataset_version).toBe('hospital-navigation-v0.3');
  });

  it('writes a CSV header plus one row per episode', () => {
    const rows = toCsv(built.manifest).split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('episode_id');
    expect(rows[1]).toContain('hospital-navigation-v0.3');
  });

  it('flattens the sensor list rather than breaking the CSV', () => {
    const rows = toCsv(built.manifest).split('\n');
    expect(rows[1]).toContain('camera|lidar|imu|odometry');
    expect(rows[1]!.split(',')).toHaveLength(14);
  });

  it('wraps JSON exports with the policy and statistics that produced them', () => {
    const parsed = JSON.parse(serialiseManifest('json', built.version, built.manifest));
    expect(parsed.dataset_version).toBe('hospital-navigation-v0.3');
    expect(parsed.policy.min_quality_score).toBeDefined();
    expect(parsed.statistics.included).toBe(2);
    expect(parsed.episodes).toHaveLength(2);
  });
});
