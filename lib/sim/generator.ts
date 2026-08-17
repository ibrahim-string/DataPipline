import { SIM_RATES_HZ } from '../pipeline/config';
import type { EpisodeContext } from '../pipeline/episode';
import { buildEpisode } from '../pipeline/episode';
import type { Episode, RobotAction, Sensor, TelemetryEvent } from '../pipeline/types';
import { clamp, round } from '../format';
import { Rng } from './rng';
import { tasksForEnvironment, type RobotProfile } from './catalog';

/**
 * Stage 1 — the robot.
 *
 * Generates multimodal telemetry for one episode from a simple kinematic model,
 * then *deliberately damages it* the way real fleets damage data: sensors drop
 * out, clocks drift apart, Wi-Fi roaming delivers events late and out of order,
 * a bad harness emits NaN, an action label disagrees with the odometry.
 *
 * The whole point of the project is downstream of this file: if the generator
 * only produced clean data, the quality engine would have nothing to prove.
 */

export const FAULT_KINDS = [
  'SENSOR_MISSING',
  'SENSOR_DROPOUT',
  'PACKET_LOSS',
  'CLOCK_DRIFT',
  'LATE_DELIVERY',
  'DUPLICATE_PUBLISH',
  'INVALID_VALUES',
  'CAMERA_DEGRADATION',
  'BATTERY_FAULT',
  'VELOCITY_SPIKE',
  'ACTION_MISMATCH',
] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export interface Fault {
  kind: FaultKind;
  sensor?: Sensor;
  start_s: number;
  duration_s: number;
  /** Meaning depends on kind: seconds of drift per second, corruption rate, % drop, … */
  magnitude: number;
  label: string;
}

export type QualityProfile = 'pristine' | 'nominal' | 'degraded' | 'faulty';

export interface EpisodePlan {
  ctx: EpisodeContext;
  duration_s: number;
  profile: QualityProfile;
  faults: Fault[];
  /** Base transport latency for this robot/site in seconds. */
  base_latency_s: number;
  start_battery: number;
  sequence_base: number;
}

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

export function planEpisode(
  rng: Rng,
  robot: RobotProfile,
  episodeNumber: number,
  startTs: number,
): EpisodePlan {
  const template = rng.pick(tasksForEnvironment(robot.environment));
  const duration = round(rng.float(template.duration[0], template.duration[1]), 2);

  // Reliability biases the profile mix: a healthy robot mostly produces clean
  // episodes, a robot with a known issue mostly produces damaged ones.
  const r = robot.reliability;
  const profile = rng.weighted<QualityProfile>([
    ['pristine', r * r * 55],
    ['nominal', 30 + r * 10],
    ['degraded', (1 - r) * 60 + 8],
    ['faulty', (1 - r) * 55 + 3],
  ]);

  const faults = planFaults(rng, robot, profile, duration);

  return {
    ctx: {
      episode_id: `episode-${String(episodeNumber).padStart(4, '0')}`,
      robot_id: robot.robot_id,
      robot_model: robot.model,
      site: robot.site,
      environment: robot.environment,
      task: template.task,
      task_label: template.label,
      started_at: new Date(startTs * 1000).toISOString(),
      start_ts: startTs,
      sensors: robot.sensors,
    },
    duration_s: duration,
    profile,
    faults,
    base_latency_s: rng.float(0.018, 0.055),
    start_battery: round(rng.float(38, 99), 1),
    sequence_base: episodeNumber * 1_000_000,
  };
}

function planFaults(
  rng: Rng,
  robot: RobotProfile,
  profile: QualityProfile,
  duration: number,
): Fault[] {
  const faults: Fault[] = [];
  const coreSensors = robot.sensors.filter((s) => s !== 'action' && s !== 'battery');

  // A robot without LiDAR fitted is a permanent, expected "missing sensor".
  if (!robot.sensors.includes('lidar')) {
    faults.push({
      kind: 'SENSOR_MISSING',
      sensor: 'lidar',
      start_s: 0,
      duration_s: duration,
      magnitude: 1,
      label: 'No LiDAR fitted on this variant',
    });
  }

  const faultCount = {
    pristine: 0,
    nominal: rng.int(1, 2),
    degraded: rng.int(2, 3),
    faulty: rng.int(3, 5),
  }[profile];

  const severity = { pristine: 0, nominal: 0.35, degraded: 0.7, faulty: 1 }[profile];

  for (let i = 0; i < faultCount; i++) {
    const kind = rng.weighted<FaultKind>([
      ['SENSOR_DROPOUT', 22],
      ['PACKET_LOSS', 14],
      ['CLOCK_DRIFT', 20],
      ['LATE_DELIVERY', 10],
      ['DUPLICATE_PUBLISH', 9],
      ['INVALID_VALUES', 11],
      ['CAMERA_DEGRADATION', 8],
      ['BATTERY_FAULT', 4],
      ['VELOCITY_SPIKE', 4],
      ['ACTION_MISMATCH', 4],
    ]);

    const start = round(rng.float(1.5, Math.max(2.5, duration - 4)), 2);
    const sensor = rng.pick(coreSensors);

    switch (kind) {
      case 'SENSOR_DROPOUT': {
        // Known-issue robots get the long, gate-failing dropouts.
        const ceiling = robot.known_issue ? 2.4 : 1.2;
        const length = round(rng.float(0.25, 0.25 + ceiling * severity), 2);
        faults.push({
          kind,
          sensor,
          start_s: start,
          duration_s: Math.min(length, duration - start),
          magnitude: 1,
          label: `${sensor} stops publishing for ${length.toFixed(2)}s`,
        });
        break;
      }
      case 'CLOCK_DRIFT': {
        const driftSensor = rng.pick(coreSensors.filter((s) => s !== 'camera').concat('imu'));
        faults.push({
          kind,
          sensor: driftSensor,
          start_s: start,
          duration_s: duration - start,
          // ms of additional offset accumulated per second
          magnitude: round(rng.float(0.8, 0.8 + 5 * severity), 2),
          label: `${driftSensor} clock drifts against the camera reference`,
        });
        break;
      }
      case 'PACKET_LOSS': {
        // Lossy Wi-Fi drops individual samples rather than opening one long gap,
        // so this dents completeness without ever tripping the dropout gate.
        faults.push({
          kind,
          sensor,
          start_s: start,
          duration_s: round(Math.min(duration - start, rng.float(5, 5 + 25 * severity)), 2),
          magnitude: round(rng.float(0.06, 0.06 + 0.45 * severity), 3),
          label: `${sensor} loses individual samples across a lossy-link window`,
        });
        break;
      }
      case 'LATE_DELIVERY': {
        faults.push({
          kind,
          start_s: start,
          duration_s: round(rng.float(1.2, 4.5), 2),
          magnitude: round(rng.float(0.04, 0.04 + 0.4 * severity), 3),
          label: 'Network stall delivers a burst of events late and out of order',
        });
        break;
      }
      case 'DUPLICATE_PUBLISH': {
        faults.push({
          kind,
          start_s: start,
          duration_s: round(Math.min(duration - start, rng.float(4, 4 + 26 * severity)), 2),
          magnitude: round(rng.float(0.03, 0.03 + 0.3 * severity), 4),
          label: 'Publisher retries without idempotency, re-emitting sequence IDs',
        });
        break;
      }
      case 'INVALID_VALUES': {
        // A sensor emitting garbage usually keeps emitting garbage, so severe
        // instances run to the end of the episode rather than for a few seconds.
        const persistent = severity > 0.5 && rng.bool(0.8);
        faults.push({
          kind,
          sensor,
          start_s: start,
          duration_s: persistent ? duration - start : round(rng.float(1, 6), 2),
          magnitude: round(rng.float(0.05, 0.05 + 0.75 * severity), 3),
          label: `${sensor} emits NaN / Infinity / out-of-range values`,
        });
        break;
      }
      case 'CAMERA_DEGRADATION': {
        faults.push({
          kind,
          sensor: 'camera',
          start_s: start,
          duration_s: round(rng.float(2, 9), 2),
          magnitude: round(rng.float(0.3, 0.75), 2),
          label: 'Motion blur / exposure swing degrades frames',
        });
        break;
      }
      case 'BATTERY_FAULT': {
        faults.push({
          kind,
          sensor: 'battery',
          start_s: start,
          duration_s: 1,
          magnitude: round(rng.float(4, 14), 1),
          label: 'Sudden state-of-charge collapse',
        });
        break;
      }
      case 'VELOCITY_SPIKE': {
        faults.push({
          kind,
          sensor: 'action',
          start_s: start,
          duration_s: round(rng.float(0.4, 1.6), 2),
          magnitude: round(rng.float(1.6, 2.6), 2),
          label: 'Commanded velocity exceeds the configured safety limit',
        });
        break;
      }
      case 'ACTION_MISMATCH': {
        faults.push({
          kind,
          start_s: start,
          duration_s: round(rng.float(2, 4.5), 2),
          magnitude: 1,
          label: 'Action stream reports STOP while the base is still moving',
        });
        break;
      }
      case 'SENSOR_MISSING':
        break;
    }
  }

  return faults.sort((a, b) => a.start_s - b.start_s);
}

/* ------------------------------------------------------------------ */
/* Kinematics                                                          */
/* ------------------------------------------------------------------ */

const SIM_DT = 0.01;

interface MotionSample {
  t: number;
  x: number;
  y: number;
  theta: number;
  v: number;
  omega: number;
  ax: number;
  ay: number;
  action: RobotAction;
  battery: number;
}

/** Integrates a differential-drive style base through a scripted action sequence. */
function simulateMotion(rng: Rng, plan: EpisodePlan): MotionSample[] {
  const steps = Math.ceil(plan.duration_s / SIM_DT);
  const samples: MotionSample[] = new Array(steps);

  let x = rng.float(-6, 6);
  let y = rng.float(-6, 6);
  let theta = rng.float(-Math.PI, Math.PI);
  let v = 0;
  let omega = 0;
  let battery = plan.start_battery;
  const drain = rng.float(0.015, 0.055);

  let action: RobotAction = 'MOVE_FORWARD';
  let targetV = 0;
  let targetOmega = 0;
  let segmentEnd = 0;

  const batteryFault = plan.faults.find((f) => f.kind === 'BATTERY_FAULT');
  const mismatch = plan.faults.find((f) => f.kind === 'ACTION_MISMATCH');
  let batteryFaultApplied = false;

  for (let i = 0; i < steps; i++) {
    const t = i * SIM_DT;

    if (t >= segmentEnd) {
      action = rng.weighted<RobotAction>([
        ['MOVE_FORWARD', 42],
        ['TURN_LEFT', 14],
        ['TURN_RIGHT', 14],
        ['STOP', 16],
        ['FOLLOW_PERSON', 14],
      ]);
      segmentEnd = t + rng.float(1.8, 6.5);
      switch (action) {
        case 'MOVE_FORWARD':
          targetV = rng.float(0.35, 0.95);
          targetOmega = rng.normal(0, 0.04);
          break;
        case 'TURN_LEFT':
          targetV = rng.float(0.05, 0.25);
          targetOmega = rng.float(0.4, 0.95);
          break;
        case 'TURN_RIGHT':
          targetV = rng.float(0.05, 0.25);
          targetOmega = -rng.float(0.4, 0.95);
          break;
        case 'STOP':
          targetV = 0;
          targetOmega = 0;
          break;
        case 'FOLLOW_PERSON':
          targetV = rng.float(0.25, 0.8);
          targetOmega = rng.normal(0, 0.2);
          break;
      }
    }

    // First-order lag toward the commanded velocity — gives realistic accelerations.
    const prevV = v;
    const prevOmega = omega;
    v += (targetV - v) * 0.06;
    omega += (targetOmega - omega) * 0.09;

    const inMismatch = mismatch && t >= mismatch.start_s && t <= mismatch.start_s + mismatch.duration_s;
    // During a mismatch the *label* says STOP but the base keeps moving.
    const reportedAction: RobotAction = inMismatch ? 'STOP' : action;

    theta = normaliseAngle(theta + omega * SIM_DT);
    x += v * Math.cos(theta) * SIM_DT;
    y += v * Math.sin(theta) * SIM_DT;

    battery = Math.max(0, battery - drain * SIM_DT);
    if (batteryFault && !batteryFaultApplied && t >= batteryFault.start_s) {
      battery = Math.max(0, battery - batteryFault.magnitude);
      batteryFaultApplied = true;
    }

    samples[i] = {
      t,
      x,
      y,
      theta,
      v,
      omega,
      ax: (v - prevV) / SIM_DT,
      ay: ((omega - prevOmega) / SIM_DT) * 0.35,
      action: reportedAction,
      battery,
    };
  }

  return samples;
}

function normaliseAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/* ------------------------------------------------------------------ */
/* Telemetry emission                                                  */
/* ------------------------------------------------------------------ */

interface DraftEvent {
  sensor: Sensor;
  timestamp: number;
  ingest_timestamp: number;
  payload: TelemetryEvent['payload'];
}

export function generateEvents(rng: Rng, plan: EpisodePlan): TelemetryEvent[] {
  const motion = simulateMotion(rng, plan);
  const sampleAt = (t: number): MotionSample =>
    motion[clamp(Math.floor(t / SIM_DT), 0, motion.length - 1)]!;

  const missing = new Set(
    plan.faults.filter((f) => f.kind === 'SENSOR_MISSING' && f.sensor).map((f) => f.sensor!),
  );
  const dropouts = plan.faults.filter((f) => f.kind === 'SENSOR_DROPOUT');
  const packetLoss = plan.faults.filter((f) => f.kind === 'PACKET_LOSS');
  const drifts = plan.faults.filter((f) => f.kind === 'CLOCK_DRIFT');
  const invalids = plan.faults.filter((f) => f.kind === 'INVALID_VALUES');
  const degradations = plan.faults.filter((f) => f.kind === 'CAMERA_DEGRADATION');
  const spikes = plan.faults.filter((f) => f.kind === 'VELOCITY_SPIKE');
  const lateBursts = plan.faults.filter((f) => f.kind === 'LATE_DELIVERY');
  const duplicateWindows = plan.faults.filter((f) => f.kind === 'DUPLICATE_PUBLISH');

  // Every sensor sits on its own clock, a few ms away from the reference.
  const clockOffsets: Partial<Record<Sensor, number>> = {};
  for (const sensor of plan.ctx.sensors) {
    clockOffsets[sensor] = rng.normal(0, 0.0018);
  }

  const drafts: DraftEvent[] = [];
  let frameId = rng.int(10_000, 90_000);

  for (const sensor of plan.ctx.sensors) {
    if (missing.has(sensor)) continue;
    const rate = SIM_RATES_HZ[sensor];
    const interval = 1 / rate;
    const count = Math.floor(plan.duration_s * rate);

    for (let i = 0; i < count; i++) {
      const trueT = i * interval;

      // Dropout: the sensor simply does not publish during the window.
      const dropped = dropouts.some(
        (f) => f.sensor === sensor && trueT >= f.start_s && trueT < f.start_s + f.duration_s,
      );
      if (dropped) continue;

      // Packet loss: individual samples vanish, scattered rather than contiguous.
      const lossRate = packetLoss.find(
        (f) => f.sensor === sensor && trueT >= f.start_s && trueT < f.start_s + f.duration_s,
      )?.magnitude;
      if (lossRate !== undefined && rng.bool(lossRate)) continue;

      // Reported timestamp = true time + constant clock offset + jitter + drift.
      let offset = clockOffsets[sensor] ?? 0;
      for (const drift of drifts) {
        if (drift.sensor === sensor && trueT > drift.start_s) {
          offset += ((trueT - drift.start_s) * drift.magnitude) / 1000;
        }
      }
      const timestamp = plan.ctx.start_ts + trueT + offset + rng.normal(0, 0.0012);

      // Transport latency, plus late bursts that reorder the stream on arrival.
      let latency = plan.base_latency_s + Math.abs(rng.normal(0, 0.003));
      for (const burst of lateBursts) {
        if (trueT >= burst.start_s && trueT < burst.start_s + burst.duration_s && rng.bool(0.55)) {
          latency += rng.float(burst.magnitude * 0.4, burst.magnitude * 2.2);
        }
      }

      const state = sampleAt(trueT);
      const corruptionRate =
        invalids.find(
          (f) => f.sensor === sensor && trueT >= f.start_s && trueT < f.start_s + f.duration_s,
        )?.magnitude ?? 0;
      const corrupt = corruptionRate > 0 && rng.bool(corruptionRate);

      const payload = buildPayload(rng, sensor, state, {
        corrupt,
        frameId: sensor === 'camera' ? frameId++ : 0,
        blurPenalty: degradations.find(
          (f) => trueT >= f.start_s && trueT < f.start_s + f.duration_s,
        )?.magnitude,
        velocityMultiplier: spikes.find(
          (f) => trueT >= f.start_s && trueT < f.start_s + f.duration_s,
        )?.magnitude,
      });

      // The collector stamps arrival on its own clock, which knows nothing about
      // the sensor's clock error — so ingest is true time + latency, NOT the
      // reported (possibly drifting) timestamp + latency. Getting this wrong
      // makes clock drift mathematically invisible to the sync stage.
      const ingest = plan.ctx.start_ts + trueT + latency;

      drafts.push({ sensor, timestamp, ingest_timestamp: ingest, payload });
    }
  }

  // Sequence IDs are assigned at the robot, in capture order.
  drafts.sort((a, b) => a.timestamp - b.timestamp);
  const events: TelemetryEvent[] = drafts.map(
    (draft, index) =>
      ({
        robot_id: plan.ctx.robot_id,
        episode_id: plan.ctx.episode_id,
        sensor: draft.sensor,
        sequence_id: plan.sequence_base + index,
        timestamp: round(draft.timestamp, 4),
        ingest_timestamp: round(draft.ingest_timestamp, 4),
        payload: draft.payload,
      }) as TelemetryEvent,
  );

  // Arrival order is ingest order — out-of-order delivery falls out of latency.
  const arrivals = [...events].sort((a, b) => a.ingest_timestamp - b.ingest_timestamp);

  // At-least-once delivery: the publisher re-emits some events it already sent.
  const withDuplicates: TelemetryEvent[] = [];
  for (const event of arrivals) {
    withDuplicates.push(event);
    const offsetS = event.timestamp - plan.ctx.start_ts;
    const window = duplicateWindows.find(
      (f) => offsetS >= f.start_s && offsetS < f.start_s + f.duration_s,
    );
    if (window && rng.bool(window.magnitude)) {
      withDuplicates.push({ ...event, ingest_timestamp: round(event.ingest_timestamp + rng.float(0.002, 0.05), 4) });
    }
  }

  return withDuplicates;
}

interface PayloadOptions {
  corrupt: boolean;
  frameId: number;
  blurPenalty?: number;
  velocityMultiplier?: number;
}

function buildPayload(
  rng: Rng,
  sensor: Sensor,
  state: MotionSample,
  options: PayloadOptions,
): TelemetryEvent['payload'] {
  switch (sensor) {
    case 'camera': {
      // Motion softens frames, but a healthy camera stays well clear of the
      // 0.35 usability floor — degradation below it comes from injected faults,
      // not from the robot simply walking.
      const motionBlur = clamp(0.88 - (Math.abs(state.v) * 0.12 + Math.abs(state.omega) * 0.14), 0.52, 0.95);
      let blur = clamp(motionBlur + rng.normal(0, 0.05), 0.05, 1);
      if (options.blurPenalty) blur = clamp(blur * (1 - options.blurPenalty), 0.02, 1);
      let exposure = clamp(0.86 + rng.normal(0, 0.06), 0.05, 1);
      if (options.blurPenalty) exposure = clamp(exposure - options.blurPenalty * 0.6, 0.02, 1);
      return {
        frame_id: options.frameId,
        width: 1280,
        height: 720,
        blur_score: options.corrupt && rng.bool(0.5) ? Number.NaN : round(blur, 3),
        exposure_score: round(exposure, 3),
      };
    }

    case 'lidar': {
      const points = Math.round(rng.float(16_000, 21_000));
      const invalid = Math.round(points * clamp(rng.normal(0.006, 0.004), 0, 0.05));
      if (options.corrupt) {
        const mode = rng.int(0, 2);
        return {
          points,
          range_min: mode === 0 ? round(-rng.float(0.1, 2), 3) : 0.21,
          range_max: mode === 1 ? round(rng.float(35, 120), 2) : round(rng.float(8, 22), 2),
          invalid_points: mode === 2 ? Math.round(points * rng.float(0.3, 0.7)) : invalid,
        };
      }
      return {
        points,
        range_min: round(clamp(rng.normal(0.22, 0.03), 0.05, 1), 3),
        range_max: round(rng.float(8, 22), 2),
        invalid_points: invalid,
      };
    }

    case 'imu': {
      if (options.corrupt) {
        const mode = rng.int(0, 2);
        return {
          ax: mode === 0 ? Number.NaN : round(rng.float(60, 240), 3),
          ay: mode === 1 ? Number.POSITIVE_INFINITY : round(rng.normal(0, 0.3), 3),
          az: round(9.81 + rng.normal(0, 0.2), 3),
          gx: round(rng.normal(0, 0.02), 4),
          gy: round(rng.normal(0, 0.02), 4),
          gz: mode === 2 ? round(rng.float(15, 40), 4) : round(state.omega + rng.normal(0, 0.01), 4),
        };
      }
      return {
        ax: round(state.ax + rng.normal(0, 0.12), 3),
        ay: round(state.ay + rng.normal(0, 0.12), 3),
        az: round(9.81 + rng.normal(0, 0.09), 3),
        gx: round(rng.normal(0, 0.012), 4),
        gy: round(rng.normal(0, 0.012), 4),
        gz: round(state.omega + rng.normal(0, 0.008), 4),
      };
    }

    case 'odometry': {
      if (options.corrupt) {
        return { x: Number.NaN, y: round(state.y, 3), theta: round(state.theta, 4) };
      }
      return {
        x: round(state.x + rng.normal(0, 0.004), 3),
        y: round(state.y + rng.normal(0, 0.004), 3),
        theta: round(state.theta, 4),
      };
    }

    case 'action': {
      const multiplier = options.velocityMultiplier ?? 1;
      return {
        action: state.action,
        linear_velocity: round(state.v * multiplier + rng.normal(0, 0.01), 3),
        angular_velocity: round(state.omega * multiplier + rng.normal(0, 0.01), 3),
      };
    }

    case 'battery': {
      return {
        percent: round(state.battery, 2),
        voltage: round(46 + (state.battery / 100) * 12 + rng.normal(0, 0.15), 2),
        current: round(clamp(6 + Math.abs(state.v) * 9 + rng.normal(0, 0.6), 0, 40), 2),
        temperature_c: round(31 + Math.abs(state.v) * 4 + rng.normal(0, 0.5), 2),
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* One-shot helper                                                     */
/* ------------------------------------------------------------------ */

/** Plan → generate → run the full pipeline. Used by the seed job and the tests. */
export function simulateEpisode(
  seed: string,
  robot: RobotProfile,
  episodeNumber: number,
  startTs: number,
): { episode: Episode; plan: EpisodePlan; events: TelemetryEvent[] } {
  const rng = new Rng(seed);
  const plan = planEpisode(rng, robot, episodeNumber, startTs);
  const events = generateEvents(rng, plan);
  const episode = buildEpisode(events, plan.ctx);
  return { episode, plan, events };
}
