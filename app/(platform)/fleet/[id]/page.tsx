import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import {
  Badge,
  Field,
  MetricBar,
  Note,
  PageHeader,
  Panel,
  ScoreValue,
  StatTile,
  StatusBadge,
} from '@/components/ui/primitives';
import { fmtDate, fmtDateTime, fmtDuration, fmtNumber } from '@/lib/format';
import { getEpisodeSummaries, getFleetStats, getRobot, getRobots } from '@/lib/server/catalog';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: getRobot(id)?.name ?? id };
}

export function generateStaticParams() {
  return getRobots().map((robot) => ({ id: robot.robot_id }));
}

export default async function RobotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const robot = getRobot(id);
  const stats = getFleetStats(id);
  if (!robot || !stats) notFound();

  const episodes = getEpisodeSummaries({ robotId: id, limit: 25 });
  const rejectRate = stats.episodes > 0 ? (stats.rejected / stats.episodes) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/fleet" className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
          <ArrowLeft size={13} />
          Fleet
        </Link>
        <div className="mt-3">
          <PageHeader
            eyebrow={robot.fleet_group}
            title={`${robot.robot_id} · ${robot.name}`}
            description={`${robot.model} operating at ${robot.site} — ${robot.environment}.`}
            actions={
              <Badge tone={stats.status === 'ONLINE' ? 'good' : 'warn'}>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${stats.status === 'ONLINE' ? 'bg-good' : 'bg-warn'}`}
                  aria-hidden
                />
                {stats.status}
              </Badge>
            }
          />
        </div>
      </div>

      {robot.known_issue && (
        <Note tone="warn" title="Known issue on this unit">
          {robot.known_issue}
        </Note>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatTile label="Episodes" value={fmtNumber(stats.episodes)} hint={`${fmtNumber(stats.training_ready)} training ready`} />
        <StatTile
          label="Avg quality"
          value={stats.avg_quality.toFixed(1)}
          tone={stats.avg_quality >= 90 ? 'good' : stats.avg_quality >= 78 ? 'warn' : 'bad'}
        />
        <StatTile
          label="Rejection rate"
          value={`${rejectRate.toFixed(0)}%`}
          tone={rejectRate > 25 ? 'bad' : 'good'}
          hint={`${fmtNumber(stats.rejected)} rejected · ${fmtNumber(stats.flagged)} flagged`}
        />
        <StatTile label="Uptime" value={`${stats.uptime_pct.toFixed(1)}%`} hint="Collection availability" />
        <StatTile
          label="Data throughput"
          value={fmtNumber(stats.events_per_second)}
          unit="ev/s"
          hint={`${fmtNumber(stats.total_events)} events total`}
        />
        <StatTile
          label="Anomalies"
          value={fmtNumber(stats.anomalies)}
          tone={stats.anomalies > stats.episodes ? 'warn' : 'neutral'}
          hint={`over ${fmtDuration(stats.total_duration_s)} collected`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Hardware" className="lg:col-span-1">
          <dl className="space-y-3">
            <Field label="Model">{robot.model}</Field>
            <Field label="Firmware">{robot.firmware}</Field>
            <Field label="Commissioned">{fmtDate(robot.commissioned)}</Field>
            <Field label="Last episode">{fmtDateTime(stats.last_episode_at)}</Field>
            <Field label="Sensors">{robot.sensors.join(', ')}</Field>
          </dl>
        </Panel>

        <Panel title="Sensor health" subtitle="Averaged across every episode this robot produced.">
          <div className="space-y-3">
            {stats.sensor_health.map((entry) => (
              <MetricBar key={entry.sensor} label={entry.sensor} value={entry.score} />
            ))}
          </div>
        </Panel>

        <Panel title="Most frequent anomalies" bodyClassName="p-0">
          {stats.top_anomaly_kinds.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-dim">No anomalies recorded.</p>
          ) : (
            <ul className="divide-y divide-line">
              {stats.top_anomaly_kinds.map((entry) => (
                <li key={entry.kind} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="font-mono text-[12px] text-ink-muted">{entry.kind}</span>
                  <span className="tnum text-ink">{fmtNumber(entry.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent episodes"
        subtitle={`${fmtNumber(stats.episodes)} total — showing the 25 most recent`}
        actions={
          <Link href={`/episodes?q=${robot.robot_id}`} className="text-xs text-accent hover:underline">
            View all
          </Link>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-4 py-2.5 font-medium">Episode</th>
                <th className="px-4 py-2.5 font-medium">Task</th>
                <th className="px-4 py-2.5 text-right font-medium">Duration</th>
                <th className="px-4 py-2.5 text-right font-medium">Anomalies</th>
                <th className="px-4 py-2.5 text-right font-medium">Quality</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((episode) => (
                <tr key={episode.episode_id} className="border-b border-line/60 last:border-0 hover:bg-elevated/60">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/episodes/${episode.episode_id}`}
                      className="font-mono text-[12px] text-accent hover:underline"
                    >
                      {episode.episode_id}
                    </Link>
                    <div className="text-[11px] text-ink-dim">{fmtDateTime(episode.started_at)}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="max-w-[240px] truncate text-ink-muted">{episode.task_label}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right tnum text-ink-muted">{fmtDuration(episode.duration_s)}</td>
                  <td className="px-4 py-2.5 text-right tnum text-ink-muted">{episode.anomaly_count}</td>
                  <td className="px-4 py-2.5 text-right">
                    <ScoreValue score={episode.score} />
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={episode.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
