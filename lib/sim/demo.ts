import { ROBOTS } from './catalog';
import type { EpisodePlan, Fault } from './generator';

/**
 * The scripted demo episode.
 *
 * Everything else in the simulator is randomly generated; this one is written by
 * hand so a first-time viewer sees the whole story in about 75 seconds, in an
 * order that makes sense:
 *
 *   t+0   clean multimodal ingest, quality ~99
 *   t+11  camera drops out for 0.9 s   → HIGH alert, gates still pass
 *   t+17  IMU clock starts drifting     → sync deviation climbs, score falls
 *   t+28  LiDAR drops out for 1.35 s    → CRITICAL alert, breaks the dropout gate
 *   t+36  LiDAR emits invalid ranges    → validity falls
 *   t+40  publisher re-emits events     → duplicates appear
 *   t+50  episode ends                  → REJECTED, with reasons, into the registry
 *
 * The faults are injected into the generator exactly like random ones; nothing
 * about the detection path is special-cased for the demo.
 */

export const DEMO_DURATION_S = 50;
export const DEMO_ROBOT_ID = 'robot-001';

const DEMO_FAULTS: Fault[] = [
  {
    // 0.72 s of silence plus one 15 Hz sampling interval reads as an ~800 ms
    // gap: HIGH severity, but comfortably inside the 1 s dropout gate. That
    // separation is the point — this one alerts, the LiDAR one at t+28 rejects.
    // (At 0.9 s the measured gap landed on 997–1002 ms and flipped the verdict
    // between runs, which made the demo tell a different story each time.)
    kind: 'SENSOR_DROPOUT',
    sensor: 'camera',
    start_s: 11,
    duration_s: 0.72,
    magnitude: 1,
    label: 'Camera stops publishing for 0.72s',
  },
  {
    kind: 'CLOCK_DRIFT',
    sensor: 'imu',
    start_s: 17,
    duration_s: DEMO_DURATION_S - 17,
    magnitude: 5.5,
    label: 'IMU clock drifts against the camera reference at 5.5 ms/s',
  },
  {
    kind: 'SENSOR_DROPOUT',
    sensor: 'lidar',
    start_s: 28,
    duration_s: 1.35,
    magnitude: 1,
    label: 'LiDAR stops publishing for 1.35s',
  },
  {
    kind: 'INVALID_VALUES',
    sensor: 'lidar',
    start_s: 36,
    duration_s: 4,
    magnitude: 0.5,
    label: 'LiDAR emits negative and out-of-spec ranges',
  },
  {
    kind: 'DUPLICATE_PUBLISH',
    start_s: 40,
    duration_s: 5,
    magnitude: 0.09,
    label: 'Publisher retries without idempotency, re-emitting sequence IDs',
  },
];

export function planDemoEpisode(startTs: number, episodeNumber: number): EpisodePlan {
  const robot = ROBOTS.find((item) => item.robot_id === DEMO_ROBOT_ID) ?? ROBOTS[0]!;

  return {
    ctx: {
      episode_id: `episode-demo-${String(episodeNumber).padStart(2, '0')}`,
      robot_id: robot.robot_id,
      robot_model: robot.model,
      site: robot.site,
      environment: robot.environment,
      task: 'navigate_to_room',
      task_label: 'Navigate to Room 204',
      started_at: new Date(startTs * 1000).toISOString(),
      start_ts: startTs,
      sensors: robot.sensors,
    },
    duration_s: DEMO_DURATION_S,
    profile: 'faulty',
    faults: DEMO_FAULTS,
    base_latency_s: 0.032,
    start_battery: 74,
    sequence_base: episodeNumber * 1_000_000,
  };
}

/** Narration shown alongside the live dashboard while the demo runs. */
export const DEMO_TIMELINE: Array<{ at: number; title: string; detail: string }> = [
  { at: 0, title: 'Ingest starts', detail: 'Six streams arrive, validated per record as they land.' },
  { at: 11, title: 'Camera dropout', detail: '0.8 s with no frames — flagged HIGH, still inside the 1 s gate.' },
  { at: 17, title: 'IMU clock drifts', detail: 'Skew against the camera reference starts climbing at 5.5 ms/s.' },
  { at: 28, title: 'LiDAR dropout', detail: '1.35 s gap — past the 1 s gate. The episode can no longer be accepted.' },
  { at: 36, title: 'Invalid LiDAR ranges', detail: 'Negative and out-of-spec values; validity falls.' },
  { at: 40, title: 'Duplicate events', detail: 'The publisher re-emits sequence IDs it already sent.' },
  { at: 50, title: 'Episode closes', detail: 'Quality engine runs, rejects the episode, and records why.' },
];
