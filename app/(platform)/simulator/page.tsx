import type { Metadata } from 'next';

import { LiveDashboard } from '@/components/simulator/LiveDashboard';
import { PageHeader } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Live Simulator' };

export default function SimulatorPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Stage 1 → 6 · live"
        title="Live robot simulator"
        description="A simulated robot publishes camera, LiDAR, IMU, odometry, action and battery telemetry over a real event stream. The server plays the robot; the browser runs the pipeline. Nothing here is a mock-up of a dashboard — every number is computed from the events as they land."
      />
      <LiveDashboard />
    </div>
  );
}
