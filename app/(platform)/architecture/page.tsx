import type { Metadata } from 'next';

import { Badge, Note, PageHeader, Panel } from '@/components/ui/primitives';
import {
  DROPOUT_GAP_MULTIPLIER,
  GRADE_BANDS,
  NOMINAL_RATES_HZ,
  QUALITY_GATES,
  QUALITY_WEIGHTS,
  SIM_RATES_HZ,
} from '@/lib/pipeline/config';

export const metadata: Metadata = { title: 'Architecture' };

interface Stage {
  id: string;
  name: string;
  module: string;
  what: string;
  why: string;
  production: string;
}

const STAGES: Stage[] = [
  {
    id: '01',
    name: 'Robot sensors',
    module: 'lib/sim/generator.ts',
    what: 'Simulates a kinematic robot and emits camera, LiDAR, IMU, odometry, action and battery streams, each on its own clock and rate, with faults deliberately injected.',
    why: 'A quality engine tested only on clean data proves nothing. The generator exists to produce the exact failure modes the pipeline claims to catch — dropouts, drift, packet loss, duplicates, NaN, mislabelled actions.',
    production: 'Replaced entirely by real robots publishing over ROS 2, recorded to MCAP. The rest of the pipeline does not change: it already consumes an envelope with capture time, ingest time, sensor, sequence ID and payload.',
  },
  {
    id: '02',
    name: 'Telemetry ingestion',
    module: 'app/api/stream/route.ts',
    what: 'Streams events to the browser over Server-Sent Events in wall-clock order, stamping each with the collector\'s ingest time on arrival.',
    why: 'The ingest timestamp is not bookkeeping — it is the shared reference that makes clock skew measurable at all. Capture time comes from the sensor and cannot be trusted; ingest time comes from one clock.',
    production: 'Kafka or Google Pub/Sub, with the robot as producer and a consumer group per pipeline stage. Partition by robot_id so one robot\'s events stay ordered relative to each other.',
  },
  {
    id: '03',
    name: 'Validation',
    module: 'lib/pipeline/validate.ts',
    what: 'Per-record schema and plausibility checks: NaN and Infinity, negative LiDAR ranges, accelerations beyond what a robot can physically experience, velocities past the safety limit, actions outside the vocabulary.',
    why: 'Stateless and per-record on purpose — it needs no neighbours, so it parallelises trivially and can run at the edge, on the robot, before bad data ever costs bandwidth.',
    production: 'The same function as the map step of a Beam/Spark job or inside the Kafka consumer. Schemas registered in a schema registry so producers cannot silently change payload shape.',
  },
  {
    id: '04',
    name: 'Synchronization',
    module: 'lib/pipeline/sync.ts',
    what: 'Measures each sensor\'s clock against the camera reference by comparing apparent latency (ingest − capture) at matching moments, then separates persistent offset from jitter.',
    why: 'Multimodal data is worthless if you cannot say what the camera saw at the moment the IMU reported that reading. The obvious method — nearest-neighbour timestamp matching — aliases constant offset away entirely; this one does not.',
    production: 'PTP-disciplined clocks or a hardware trigger line shared by the sensors, giving a true reference instead of an inferred one. The metric stays; its input gets better.',
  },
  {
    id: '05',
    name: 'Quality engine',
    module: 'lib/pipeline/quality.ts',
    what: 'Six weighted subscores produce a 0–100 ranking; eight hard gates reject outright; any high-severity anomaly blocks automatic inclusion.',
    why: 'A score alone is unsafe because averaging hides catastrophic single dimensions — an episode with a 1.4 s LiDAR hole can still score 94. Gates catch what averages hide, and every verdict carries its reasons.',
    production: 'Thresholds become a versioned config artifact attached to every dataset build, so a dataset can always be reproduced under the rules in force when it was cut.',
  },
  {
    id: '06',
    name: 'Episode builder',
    module: 'lib/pipeline/episode.ts',
    what: 'Segments the stream into task episodes, detects stream-level faults (duplicates, reordering, dropouts), rolls up per-second timelines, then discards the raw events except a small anomaly-biased sample.',
    why: 'The episode is the unit a VLA model trains on, so it must also be the unit of acceptance. Keeping metrics hot and dropping raw is what real pipelines do — the raw stream belongs in object storage, not in the query path.',
    production: 'Raw streams land in GCS/S3 as MCAP or Parquet shards; the episode row keeps metrics plus a pointer. Segmentation triggers on task-boundary events from the robot rather than a fixed window.',
  },
  {
    id: '07',
    name: 'Dataset registry',
    module: 'lib/pipeline/dataset.ts',
    what: 'Applies a build policy to the episode catalog, producing an immutable version: policy, member list, statistics and a per-episode exclusion report.',
    why: 'Reproducibility. A training run has to be traceable to exactly the episodes it saw, and a build with no exclusion report is a number you have to take on faith.',
    production: 'A registry table (BigQuery/Postgres) plus lakeFS or DVC over the object store, so a version tag resolves to immutable data, not just a list of IDs.',
  },
  {
    id: '08',
    name: 'Training & experiments',
    module: 'app/(platform)/experiments',
    what: 'Links each simulated training run to the dataset version it consumed, alongside the version\'s episode count and average quality.',
    why: 'This join is the whole argument for the pipeline: it lets you answer "did tightening the data bar actually help?" with an experiment instead of an opinion.',
    production: 'MLflow or Weights & Biases, with the dataset version recorded as a run parameter so the lineage survives outside this app.',
  },
];

const PRODUCTIONIZATION = [
  { layer: 'Streaming', poc: 'Server-Sent Events from a simulated robot', production: 'Kafka / Google Pub/Sub, partitioned by robot_id' },
  { layer: 'Storage', poc: 'Committed JSON snapshot (data/catalog.json)', production: 'GCS / S3 with Parquet + MCAP shards' },
  { layer: 'Warehouse', poc: 'In-process reads over that snapshot', production: 'BigQuery or Snowflake; episodes and metrics as tables' },
  { layer: 'Orchestration', poc: 'A single seed script (npm run seed)', production: 'Airflow or Dagster; one DAG per stage, backfillable' },
  { layer: 'Dataset versioning', poc: 'Deterministic manifests, rebuilt on demand', production: 'lakeFS / DVC + a dataset registry table' },
  { layer: 'Experiment tracking', poc: 'Simulated runs in the catalog', production: 'MLflow / Weights & Biases with dataset version as a run param' },
  { layer: 'Monitoring', poc: 'Live dashboard + alert panel', production: 'Prometheus + Grafana; alerts routed to on-call' },
  { layer: 'Robot integration', poc: 'Synthetic telemetry generator', production: 'ROS 2 bridge, MCAP recording, vendor robot SDKs' },
  { layer: 'Data formats', poc: 'Typed TypeScript envelopes', production: 'RLDS / LeRobot episode formats for VLA training' },
];

export default function ArchitecturePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Architecture"
        title="How the pipeline is put together"
        description="Eight stages, each a separate module with its own tests. This page states plainly what each stage does in this POC and what would replace it with real robots — the boundary between the two is the part worth being honest about."
      />

      {/* Flow diagram */}
      <Panel title="Pipeline" subtitle="Data flows top to bottom. Every stage is framework-free TypeScript, shared by the batch job and the live stream.">
        <div className="relative">
          <div className="grid-backdrop pointer-events-none absolute inset-0 rounded opacity-20" aria-hidden />
          <ol className="relative space-y-1">
            {STAGES.map((stage, index) => (
              <li key={stage.id}>
                <div className="flex items-center gap-3 rounded-md border border-line bg-base px-3 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent/10 font-mono text-[11px] font-semibold text-accent">
                    {stage.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{stage.name}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-dim">{stage.module}</span>
                  </span>
                </div>
                {index < STAGES.length - 1 && (
                  <div className="ml-[26px] h-3 w-px bg-line-strong" aria-hidden />
                )}
              </li>
            ))}
          </ol>
        </div>
      </Panel>

      {/* Stage cards */}
      <div className="grid gap-4 xl:grid-cols-2">
        {STAGES.map((stage) => (
          <Panel
            key={stage.id}
            title={
              <span className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-accent">{stage.id}</span>
                {stage.name}
              </span>
            }
            subtitle={stage.module}
          >
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-dim">
                  What it does
                </dt>
                <dd className="mt-1 leading-relaxed text-ink-muted">{stage.what}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-dim">
                  Why it exists
                </dt>
                <dd className="mt-1 leading-relaxed text-ink-muted">{stage.why}</dd>
              </div>
              <div className="rounded-md border border-accent/20 bg-accent/5 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-accent">
                  What would change in production
                </dt>
                <dd className="mt-1 leading-relaxed text-ink-muted">{stage.production}</dd>
              </div>
            </dl>
          </Panel>
        ))}
      </div>

      {/* Productionization table */}
      <Panel
        title="How I would productionize this"
        subtitle="Proposed extensions. None of these technologies are used in the POC — the right-hand column is a plan, not a claim."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-4 py-2.5 font-medium">Layer</th>
                <th className="px-4 py-2.5 font-medium">This POC</th>
                <th className="px-4 py-2.5 font-medium">Production</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTIONIZATION.map((row) => (
                <tr key={row.layer} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{row.layer}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{row.poc}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{row.production}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Configuration */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Quality gates" subtitle="Any single failure rejects the episode, regardless of score.">
          <ul className="space-y-1.5 text-sm">
            {[
              ['Overall completeness', `≥ ${QUALITY_GATES.min_completeness_pct}%`],
              ['Per-sensor completeness', `≥ ${QUALITY_GATES.min_sensor_completeness_pct}%`],
              ['Record validity', `≥ ${QUALITY_GATES.min_validity_pct}%`],
              ['Sync deviation p95', `≤ ${QUALITY_GATES.max_sync_p95_ms} ms`],
              ['Longest sensor dropout', `≤ ${QUALITY_GATES.max_dropout_ms} ms`],
              ['Duplicate events', `≤ ${QUALITY_GATES.max_duplication_pct}%`],
              ['Out-of-order events', `≤ ${QUALITY_GATES.max_out_of_order_pct}%`],
              ['Episode duration', `≥ ${QUALITY_GATES.min_duration_s}s`],
            ].map(([label, threshold]) => (
              <li key={label} className="flex items-center justify-between gap-3 border-b border-line/50 pb-1.5 last:border-0">
                <span className="text-ink-muted">{label}</span>
                <span className="tnum font-mono text-[12px] text-ink">{threshold}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-ink-dim">
            A gap counts as a dropout once it exceeds {DROPOUT_GAP_MULTIPLIER}× the sensor&rsquo;s
            nominal sampling interval, so a slow stream is not mistaken for a broken one.
          </p>
        </Panel>

        <Panel title="Score weights and bands">
          <ul className="space-y-1.5 text-sm">
            {Object.entries(QUALITY_WEIGHTS).map(([key, weight]) => (
              <li key={key} className="flex items-center justify-between gap-3 border-b border-line/50 pb-1.5 last:border-0">
                <span className="text-ink-muted">{key.replace('_', ' ')}</span>
                <span className="tnum font-mono text-[12px] text-ink">{(weight * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="good">GOOD ≥ {GRADE_BANDS.good}</Badge>
            <Badge tone="warn">
              WARNING {GRADE_BANDS.warning}–{GRADE_BANDS.good}
            </Badge>
            <Badge tone="bad">REJECTED &lt; {GRADE_BANDS.warning}</Badge>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-dim">
            The band between WARNING and GOOD is the human-review band: good enough that discarding
            it would be wasteful, not good enough to train on unreviewed.
          </p>
        </Panel>
      </div>

      <Panel title="Sensor rates" subtitle="What a real deployment publishes, and what the simulator runs at.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="py-2 font-medium">Sensor</th>
                <th className="py-2 text-right font-medium">Production rate</th>
                <th className="py-2 text-right font-medium">Simulator rate</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(NOMINAL_RATES_HZ).map(([sensor, rate]) => (
                <tr key={sensor} className="border-b border-line/50 last:border-0">
                  <td className="py-2 text-ink-muted">{sensor}</td>
                  <td className="py-2 text-right tnum text-ink-dim">{rate} Hz</td>
                  <td className="py-2 text-right tnum text-ink">
                    {SIM_RATES_HZ[sensor as keyof typeof SIM_RATES_HZ]} Hz
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note className="mt-4">
          The simulator runs every stream at half its production rate so a browser can hold a live
          multimodal session without dropping frames. Completeness is measured against the simulator
          rate, so the metric stays correct — but it does mean the LiDAR↔camera sync pair resolves
          drift down to about 33 ms rather than 17 ms.
        </Note>
      </Panel>
    </div>
  );
}
