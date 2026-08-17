import Link from 'next/link';
import type { Metadata } from 'next';

import { Badge, Note, PageHeader, Panel, ScoreValue, StatTile } from '@/components/ui/primitives';
import { fmtDateTime, fmtDuration, fmtNumber } from '@/lib/format';
import { getFleet, getRobots, getStats } from '@/lib/server/catalog';

export const metadata: Metadata = { title: 'Fleet' };

export default function FleetPage() {
  const robots = getRobots();
  const fleet = getFleet();
  const stats = getStats();

  const online = fleet.filter((entry) => entry.status === 'ONLINE').length;
  const warning = fleet.filter((entry) => entry.status === 'WARNING').length;
  const throughput = fleet.reduce((sum, entry) => sum + entry.events_per_second, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fleet"
        title="Robot fleet data health"
        description="Fleet monitoring from the data side: not whether a robot is moving, but whether the data it produces is worth training on. A robot can be perfectly operational and still be the worst data source you have."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Robots" value={fmtNumber(robots.length)} hint={`${online} online · ${warning} warning`} />
        <StatTile
          label="Fleet avg quality"
          value={stats.avg_quality.toFixed(1)}
          tone={stats.avg_quality >= 90 ? 'good' : 'warn'}
          hint="Mean episode score across all robots"
        />
        <StatTile
          label="Aggregate throughput"
          value={fmtNumber(throughput)}
          unit="ev/s"
          hint="Combined, while collecting"
        />
        <StatTile
          label="Collection window"
          value="45 days"
          hint={`${fmtDateTime(stats.window_start)} → ${fmtDateTime(stats.window_end)}`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {robots.map((robot) => {
          const entry = fleet.find((item) => item.robot_id === robot.robot_id);
          if (!entry) return null;
          const rejectRate = entry.episodes > 0 ? (entry.rejected / entry.episodes) * 100 : 0;

          return (
            <Link
              key={robot.robot_id}
              href={`/fleet/${robot.robot_id}`}
              className="group rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-ink">{robot.robot_id}</span>
                    <Badge tone={entry.status === 'ONLINE' ? 'good' : 'warn'}>
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${entry.status === 'ONLINE' ? 'bg-good' : 'bg-warn'}`}
                        aria-hidden
                      />
                      {entry.status}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-muted">{robot.name} · {robot.model}</p>
                  <p className="truncate text-xs text-ink-dim">
                    {robot.site} — {robot.environment}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wider text-ink-dim">Quality</div>
                  <ScoreValue score={entry.avg_quality} className="text-lg" />
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
                <div>
                  <dt className="text-ink-dim">Episodes</dt>
                  <dd className="tnum text-ink">{fmtNumber(entry.episodes)}</dd>
                </div>
                <div>
                  <dt className="text-ink-dim">Training ready</dt>
                  <dd className="tnum text-good">{fmtNumber(entry.training_ready)}</dd>
                </div>
                <div>
                  <dt className="text-ink-dim">Rejected</dt>
                  <dd className={`tnum ${rejectRate > 25 ? 'text-bad' : 'text-ink-muted'}`}>
                    {fmtNumber(entry.rejected)} ({rejectRate.toFixed(0)}%)
                  </dd>
                </div>
              </dl>

              {robot.known_issue && (
                <p className="mt-3 rounded border border-warn/25 bg-warn/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-warn">
                  {robot.known_issue}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      <Panel title="Fleet comparison" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-4 py-2.5 font-medium">Robot</th>
                <th className="px-4 py-2.5 font-medium">Group</th>
                <th className="px-4 py-2.5 text-right font-medium">Episodes</th>
                <th className="px-4 py-2.5 text-right font-medium">Collected</th>
                <th className="px-4 py-2.5 text-right font-medium">Events</th>
                <th className="px-4 py-2.5 text-right font-medium">Anomalies</th>
                <th className="px-4 py-2.5 text-right font-medium">Uptime</th>
                <th className="px-4 py-2.5 text-right font-medium">Avg quality</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((entry) => {
                const robot = robots.find((item) => item.robot_id === entry.robot_id);
                return (
                  <tr key={entry.robot_id} className="border-b border-line/60 last:border-0 hover:bg-elevated/60">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/fleet/${entry.robot_id}`}
                        className="font-mono text-[12px] text-accent hover:underline"
                      >
                        {entry.robot_id}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{robot?.fleet_group ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-muted">{fmtNumber(entry.episodes)}</td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-muted">
                      {fmtDuration(entry.total_duration_s)}
                    </td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-muted">{fmtNumber(entry.total_events)}</td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-muted">{fmtNumber(entry.anomalies)}</td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-muted">{entry.uptime_pct.toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-right">
                      <ScoreValue score={entry.avg_quality} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Note tone="accent" title="Why this view exists">
        Two of these robots have known hardware or firmware faults, and both show up here as data
        problems before anyone would notice them as operational problems: a loose LiDAR harness
        becomes a dropout-driven rejection rate, and a release-candidate firmware becomes clock
        drift. Fleet data health is an early-warning system for maintenance.
      </Note>
    </div>
  );
}
