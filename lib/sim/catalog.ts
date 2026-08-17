import type { Sensor } from '../pipeline/types';

/**
 * The simulated fleet.
 *
 * Everything here is invented for this POC. Robot platform names refer to
 * publicly known hardware only to make the scenario legible; no vendor or
 * operator data of any kind is used, and every robot ID carries a `-sim` suffix.
 */

export interface RobotProfile {
  robot_id: string;
  name: string;
  model: string;
  site: string;
  environment: string;
  fleet_group: string;
  commissioned: string;
  firmware: string;
  sensors: Sensor[];
  /** 0..1 — higher means fewer injected faults. Drives the fleet quality spread. */
  reliability: number;
  /** Robots with a known hardware issue produce a recognisable failure signature. */
  known_issue?: string;
}

const FULL_STACK: Sensor[] = ['camera', 'lidar', 'imu', 'odometry', 'action', 'battery'];
const NO_LIDAR: Sensor[] = ['camera', 'imu', 'odometry', 'action', 'battery'];

export const ROBOTS: RobotProfile[] = [
  {
    robot_id: 'robot-001',
    name: 'G1-Sim-01',
    model: 'Humanoid G1 class (sim)',
    site: 'Kita General Hospital',
    environment: 'Ward 2 Corridor',
    fleet_group: 'hospital-alpha',
    commissioned: '2026-01-14',
    firmware: '2.4.1',
    sensors: FULL_STACK,
    reliability: 0.92,
  },
  {
    robot_id: 'robot-002',
    name: 'G1-Sim-02',
    model: 'Humanoid G1 class (sim)',
    site: 'Kita General Hospital',
    environment: 'Main Reception',
    fleet_group: 'hospital-alpha',
    commissioned: '2026-01-14',
    firmware: '2.4.1',
    sensors: FULL_STACK,
    reliability: 0.95,
  },
  {
    robot_id: 'robot-003',
    name: 'G1-Sim-03',
    model: 'Humanoid G1 class (sim)',
    site: 'Kita General Hospital',
    environment: 'Room 204 Wing',
    fleet_group: 'hospital-alpha',
    commissioned: '2026-02-02',
    firmware: '2.3.8',
    sensors: FULL_STACK,
    reliability: 0.61,
    known_issue: 'LiDAR harness intermittently disconnects under vibration',
  },
  {
    robot_id: 'robot-004',
    name: 'G1-Sim-04',
    model: 'Humanoid G1 class (sim)',
    site: 'Kita General Hospital',
    environment: 'Elevator Lobby',
    fleet_group: 'hospital-alpha',
    commissioned: '2026-02-19',
    firmware: '2.4.1',
    sensors: FULL_STACK,
    reliability: 0.88,
  },
  {
    robot_id: 'robot-005',
    name: 'Quad-Sim-01',
    model: 'Quadruped Go class (sim)',
    site: 'Tsukuba Test Facility',
    environment: 'Mixed-Surface Course',
    fleet_group: 'research',
    commissioned: '2025-11-30',
    firmware: '2.5.0-rc2',
    sensors: FULL_STACK,
    reliability: 0.74,
    known_issue: 'Release-candidate firmware: IMU timestamps drift against the camera clock',
  },
  {
    robot_id: 'robot-006',
    name: 'Quad-Sim-02',
    model: 'Quadruped Go class (sim)',
    site: 'Tsukuba Test Facility',
    environment: 'Outdoor Ramp',
    fleet_group: 'research',
    commissioned: '2025-11-30',
    firmware: '2.4.1',
    sensors: FULL_STACK,
    reliability: 0.83,
  },
  {
    robot_id: 'robot-007',
    name: 'Wheel-Sim-01',
    model: 'Wheeled service base (sim)',
    site: 'Sakura Grand Hotel',
    environment: 'Lobby & Lift Core',
    fleet_group: 'hospitality',
    commissioned: '2026-03-08',
    firmware: '2.4.0',
    sensors: FULL_STACK,
    reliability: 0.9,
  },
  {
    robot_id: 'robot-008',
    name: 'Wheel-Sim-02',
    model: 'Wheeled service base (sim)',
    site: 'Sakura Grand Hotel',
    environment: 'Guest Floor 7',
    fleet_group: 'hospitality',
    commissioned: '2026-03-08',
    firmware: '2.4.0',
    sensors: NO_LIDAR,
    reliability: 0.86,
    known_issue: 'Camera-only variant — no LiDAR fitted, so LiDAR completeness is always 0',
  },
  {
    robot_id: 'robot-009',
    name: 'Wheel-Sim-03',
    model: 'Wheeled service base (sim)',
    site: 'Minato Retail Store',
    environment: 'Aisle Network',
    fleet_group: 'retail',
    commissioned: '2026-04-21',
    firmware: '2.4.1',
    sensors: FULL_STACK,
    reliability: 0.79,
  },
  {
    robot_id: 'robot-010',
    name: 'Wheel-Sim-04',
    model: 'Wheeled service base (sim)',
    site: 'Minato Retail Store',
    environment: 'Stockroom Dock',
    fleet_group: 'retail',
    commissioned: '2026-05-06',
    firmware: '2.4.1',
    sensors: FULL_STACK,
    reliability: 0.68,
    known_issue: 'Wi-Fi roaming at the dock causes bursts of late, out-of-order events',
  },
];

export interface TaskTemplate {
  task: string;
  label: string;
  /** Typical episode length in seconds. */
  duration: [min: number, max: number];
  environments: string[];
}

export const TASKS: TaskTemplate[] = [
  {
    task: 'navigate_to_room',
    label: 'Navigate to Room 204',
    duration: [24, 62],
    environments: ['Ward 2 Corridor', 'Room 204 Wing', 'Guest Floor 7'],
  },
  {
    task: 'deliver_supplies',
    label: 'Deliver supply tray to nurse station',
    duration: [30, 75],
    environments: ['Ward 2 Corridor', 'Room 204 Wing'],
  },
  {
    task: 'follow_person',
    label: 'Follow staff member to destination',
    duration: [18, 48],
    environments: ['Main Reception', 'Lobby & Lift Core', 'Aisle Network'],
  },
  {
    task: 'patrol_corridor',
    label: 'Patrol corridor and log obstacles',
    duration: [40, 90],
    environments: ['Ward 2 Corridor', 'Guest Floor 7', 'Aisle Network'],
  },
  {
    task: 'elevator_transit',
    label: 'Board elevator and transit floors',
    duration: [22, 50],
    environments: ['Elevator Lobby', 'Lobby & Lift Core'],
  },
  {
    task: 'greet_visitor',
    label: 'Greet visitor and give directions',
    duration: [14, 34],
    environments: ['Main Reception', 'Lobby & Lift Core'],
  },
  {
    task: 'dock_and_charge',
    label: 'Return to dock and charge',
    duration: [16, 40],
    environments: ['Stockroom Dock', 'Elevator Lobby', 'Mixed-Surface Course'],
  },
  {
    task: 'inventory_scan',
    label: 'Scan shelf inventory',
    duration: [35, 80],
    environments: ['Aisle Network', 'Stockroom Dock'],
  },
  {
    task: 'traverse_uneven_ground',
    label: 'Traverse uneven ground segment',
    duration: [20, 55],
    environments: ['Mixed-Surface Course', 'Outdoor Ramp'],
  },
];

export function tasksForEnvironment(environment: string): TaskTemplate[] {
  const matches = TASKS.filter((t) => t.environments.includes(environment));
  return matches.length > 0 ? matches : TASKS;
}

export function robotById(robotId: string): RobotProfile | undefined {
  return ROBOTS.find((r) => r.robot_id === robotId);
}
