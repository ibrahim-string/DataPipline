import Link from 'next/link';
import type { Metadata } from 'next';
import { Search } from 'lucide-react';

import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  ScoreValue,
  StatTile,
  StatusBadge,
  cx,
} from '@/components/ui/primitives';
import { fmtDateTime, fmtDuration, fmtNumber } from '@/lib/format';
import type { EpisodeStatus } from '@/lib/pipeline/types';
import { getEpisodeSummaries, getStats, getTasks } from '@/lib/server/catalog';

export const metadata: Metadata = { title: 'Episodes' };

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'TRAINING_READY', label: 'Training ready' },
  { value: 'FLAGGED', label: 'Flagged' },
  { value: 'REJECTED', label: 'Rejected' },
];

const PAGE_SIZE = 60;

function isStatus(value: string): value is EpisodeStatus {
  return value === 'TRAINING_READY' || value === 'FLAGGED' || value === 'REJECTED';
}

export default async function EpisodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const read = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };

  const status = read('status');
  const task = read('task');
  const search = read('q');

  const all = getEpisodeSummaries({
    ...(isStatus(status) ? { status } : {}),
    ...(task ? { task } : {}),
    ...(search ? { search } : {}),
  });
  const visible = all.slice(0, PAGE_SIZE);
  const stats = getStats();
  const tasks = getTasks();

  const buildHref = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    const merged = { status, task, q: search, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    const query = next.toString();
    return query ? `/episodes?${query}` : '/episodes';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Episode explorer"
        title="Episodes"
        description="One episode is one task attempt by one robot — the unit a VLA model trains on, and therefore the unit the pipeline accepts or rejects. Every verdict here is explainable: open a row to see which check produced it."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Episodes collected" value={fmtNumber(stats.episodes)} hint={`${fmtNumber(stats.events_processed)} telemetry events processed`} />
        <StatTile label="Training ready" value={fmtNumber(stats.training_ready)} tone="good" hint={`${((stats.training_ready / stats.episodes) * 100).toFixed(0)}% of all episodes`} />
        <StatTile label="Flagged for review" value={fmtNumber(stats.flagged)} tone="warn" hint="Passed gates, blocked by a high-severity anomaly" />
        <StatTile label="Rejected" value={fmtNumber(stats.rejected)} tone="bad" hint={`${fmtNumber(stats.anomalies)} anomalies detected in total`} />
      </div>

      <Panel
        title={`${fmtNumber(all.length)} matching episodes`}
        subtitle={all.length > PAGE_SIZE ? `Showing the ${PAGE_SIZE} most recent` : 'Sorted newest first'}
        bodyClassName="p-0"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((filter) => (
              <Link
                key={filter.value || 'all'}
                href={buildHref({ status: filter.value })}
                className={cx(
                  'rounded-md border px-2.5 py-1 text-xs transition-colors',
                  status === filter.value
                    ? 'border-accent/40 bg-accent/10 text-ink'
                    : 'border-line bg-surface text-ink-muted hover:text-ink',
                )}
              >
                {filter.label}
              </Link>
            ))}
          </div>

          <form action="/episodes" className="ml-auto flex items-center gap-2">
            {status && <input type="hidden" name="status" value={status} />}
            <select
              name="task"
              defaultValue={task}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-muted"
              aria-label="Filter by task"
            >
              <option value="">All tasks</option>
              {tasks.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim"
                aria-hidden
              />
              <input
                type="search"
                name="q"
                defaultValue={search}
                placeholder="episode, robot, site…"
                aria-label="Search episodes"
                className="w-44 rounded-md border border-line bg-surface py-1.5 pl-7 pr-2 text-xs text-ink placeholder:text-ink-dim"
              />
            </div>
            <button
              type="submit"
              className="rounded-md border border-line-strong bg-elevated px-2.5 py-1.5 text-xs text-ink hover:border-accent/40"
            >
              Apply
            </button>
          </form>
        </div>

        {visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No episodes match these filters"
              description="Try clearing the search box or selecting a different status."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                  <th className="px-4 py-2.5 font-medium">Episode</th>
                  <th className="px-4 py-2.5 font-medium">Task</th>
                  <th className="px-4 py-2.5 font-medium">Robot</th>
                  <th className="px-4 py-2.5 text-right font-medium">Duration</th>
                  <th className="px-4 py-2.5 text-right font-medium">Events</th>
                  <th className="px-4 py-2.5 text-right font-medium">Quality</th>
                  <th className="px-4 py-2.5 font-medium">Sensors</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((episode) => (
                  <tr
                    key={episode.episode_id}
                    className="border-b border-line/60 transition-colors last:border-0 hover:bg-elevated/60"
                  >
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
                      <div className="max-w-[220px] truncate text-ink">{episode.task_label}</div>
                      <div className="truncate text-[11px] text-ink-dim">{episode.site}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ink-muted">{episode.robot_id}</td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-muted">{fmtDuration(episode.duration_s)}</td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-muted">{fmtNumber(episode.events_total)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <ScoreValue score={episode.score} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {episode.sensors
                          .filter((sensor) => sensor !== 'action' && sensor !== 'battery')
                          .map((sensor) => (
                            <Badge key={sensor}>{sensor}</Badge>
                          ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={episode.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
