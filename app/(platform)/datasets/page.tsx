import Link from 'next/link';
import type { Metadata } from 'next';
import { Download } from 'lucide-react';

import { DatasetBuilder } from '@/components/datasets/DatasetBuilder';
import {
  EmptyState,
  Note,
  PageHeader,
  Panel,
  ScoreValue,
  StatTile,
  StatusBadge,
  cx,
} from '@/components/ui/primitives';
import { fmtBytes, fmtDate, fmtDuration, fmtNumber } from '@/lib/format';
import { getDataset, getDatasetFamilies, getEpisodeSummary } from '@/lib/server/catalog';
import { DATASET_SCOPES } from '@/lib/server/datasets';

export const metadata: Metadata = { title: 'Datasets' };

const EPISODE_PREVIEW = 40;

export default async function DatasetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.v) ? params.v[0] : params.v;

  const families = getDatasetFamilies();
  const fallback = families[0]?.versions[families[0].versions.length - 1]?.full_name;
  const selected = getDataset(requested ?? fallback ?? '') ?? getDataset(fallback ?? '');

  const scopes = Object.entries(DATASET_SCOPES).map(([id, scope]) => ({
    id,
    description: scope.description,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dataset registry"
        title="Dataset versions"
        description="A version is a policy, a member list and a set of statistics. Every episode that did not make it in carries the rule that excluded it — a build with no exclusion report is just a number you have to trust."
      />

      {/* Version registry */}
      <div className="space-y-4">
        {families.map((family) => (
          <Panel
            key={family.dataset}
            title={family.dataset}
            subtitle={`${family.versions.length} version${family.versions.length === 1 ? '' : 's'}`}
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                    <th className="px-4 py-2.5 font-medium">Version</th>
                    <th className="px-4 py-2.5 text-right font-medium">Candidates</th>
                    <th className="px-4 py-2.5 text-right font-medium">Included</th>
                    <th className="px-4 py-2.5 text-right font-medium">Excluded</th>
                    <th className="px-4 py-2.5 text-right font-medium">Avg quality</th>
                    <th className="px-4 py-2.5 text-right font-medium">Score floor</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {family.versions.map((version) => {
                    const isSelected = selected?.full_name === version.full_name;
                    const excluded = version.stats.candidates - version.stats.included;
                    return (
                      <tr
                        key={version.full_name}
                        className={cx(
                          'border-b border-line/60 last:border-0 transition-colors',
                          isSelected ? 'bg-accent/5' : 'hover:bg-elevated/60',
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/datasets?v=${version.full_name}`}
                            className="font-mono text-[12px] text-accent hover:underline"
                          >
                            {version.version}
                          </Link>
                          {version.parent && (
                            <div className="text-[11px] text-ink-dim">from {version.parent}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tnum text-ink-muted">
                          {fmtNumber(version.stats.candidates)}
                        </td>
                        <td className="px-4 py-2.5 text-right tnum text-good">
                          {fmtNumber(version.stats.included)}
                        </td>
                        <td className="px-4 py-2.5 text-right tnum text-ink-muted">{fmtNumber(excluded)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <ScoreValue score={version.stats.avg_quality} />
                        </td>
                        <td className="px-4 py-2.5 text-right tnum text-ink-muted">
                          {version.policy.min_quality_score}
                          {version.policy.include_flagged && (
                            <span className="ml-1.5 text-[11px] text-warn">+flagged</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">{fmtDate(version.created_at)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            href={`/datasets?v=${version.full_name}`}
                            className="text-xs text-ink-dim hover:text-accent"
                          >
                            Inspect →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}
      </div>

      {/* Selected version */}
      {selected ? (
        <Panel
          title={<span className="font-mono">{selected.full_name}</span>}
          subtitle={selected.notes}
          actions={
            <div className="flex items-center gap-1.5">
              {(['json', 'jsonl', 'csv'] as const).map((format) => (
                <a
                  key={format}
                  href={`/api/datasets/export?version=${encodeURIComponent(selected.full_name)}&format=${format}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-elevated px-2.5 py-1.5 text-xs text-ink transition-colors hover:border-accent/40"
                >
                  <Download size={12} />.{format}
                </a>
              ))}
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <StatTile label="Episodes" value={fmtNumber(selected.stats.included)} tone="good" />
            <StatTile label="Avg quality" value={selected.stats.avg_quality.toFixed(1)} hint={`floor ${selected.stats.min_quality.toFixed(1)}`} />
            <StatTile label="Robots" value={fmtNumber(selected.stats.robots)} />
            <StatTile label="Total duration" value={fmtDuration(selected.stats.total_duration_s)} />
            <StatTile label="Events" value={fmtNumber(selected.stats.total_events)} />
            <StatTile label="Est. raw size" value={fmtBytes(selected.stats.estimated_size_bytes)} hint="if sensor data were materialised" />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-ink-dim">Build policy</h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Min quality score</dt>
                  <dd className="tnum text-ink">{selected.policy.min_quality_score}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Min duration</dt>
                  <dd className="tnum text-ink">{selected.policy.min_duration_s}s</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Flagged episodes</dt>
                  <dd className="text-ink">{selected.policy.include_flagged ? 'included' : 'excluded'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Required sensors</dt>
                  <dd className="text-right text-ink">{selected.policy.require_sensors.join(', ')}</dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-ink-dim">Task mix</h3>
              <ul className="mt-2 space-y-1.5">
                {selected.stats.tasks.slice(0, 6).map((task) => (
                  <li key={task.task} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-mono text-[12px] text-ink-muted">{task.task}</span>
                    {/* Units on both figures — without them "13" and "96.9" read as one number. */}
                    <span className="shrink-0 whitespace-nowrap text-xs tnum text-ink-dim">
                      <span className="text-ink">{task.episodes}</span> ep
                      <span className="px-1.5">·</span>
                      <span className="text-ink">{task.avg_quality.toFixed(1)}</span> avg
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-ink-dim">Exclusions</h3>
              {selected.stats.exclusions.length === 0 ? (
                <p className="mt-2 text-sm text-ink-dim">Every candidate was admitted.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {selected.stats.exclusions.map((exclusion) => (
                    <li key={exclusion.reason} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink-muted">{exclusion.reason}</span>
                      <span className="tnum shrink-0 text-bad">{exclusion.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="mt-5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-dim">
              Member episodes ({fmtNumber(selected.episode_ids.length)})
            </h3>
            <div className="mt-2 overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                    <th className="px-3 py-2 font-medium">Episode</th>
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">Robot</th>
                    <th className="px-3 py-2 text-right font-medium">Duration</th>
                    <th className="px-3 py-2 text-right font-medium">Quality</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.episode_ids.slice(0, EPISODE_PREVIEW).map((episodeId) => {
                    const summary = getEpisodeSummary(episodeId);
                    if (!summary) return null;
                    return (
                      <tr key={episodeId} className="border-b border-line/60 last:border-0 hover:bg-elevated/60">
                        <td className="px-3 py-2">
                          <Link
                            href={`/episodes/${episodeId}`}
                            className="font-mono text-[12px] text-accent hover:underline"
                          >
                            {episodeId}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <span className="block max-w-[220px] truncate text-ink-muted">{summary.task_label}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[12px] text-ink-muted">{summary.robot_id}</td>
                        <td className="px-3 py-2 text-right tnum text-ink-muted">{fmtDuration(summary.duration_s)}</td>
                        <td className="px-3 py-2 text-right">
                          <ScoreValue score={summary.score} />
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={summary.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {selected.episode_ids.length > EPISODE_PREVIEW && (
              <p className="mt-2 text-xs text-ink-dim">
                Showing {EPISODE_PREVIEW} of {fmtNumber(selected.episode_ids.length)} — download the
                manifest for the full list.
              </p>
            )}
          </div>
        </Panel>
      ) : (
        <EmptyState title="No dataset version selected" />
      )}

      <DatasetBuilder scopes={scopes} />

      <Note tone="accent" title="Why versions get stricter, not looser">
        The registry above tells a story worth reading in order: v0.1 was permissive to get volume,
        the <Link href="/experiments" className="text-accent hover:underline">data-quality ablation</Link>{' '}
        showed FLAGGED episodes hurt evaluation, and v0.2 removed them. v0.3 raised the floor again.
        Being able to say <em>which</em> data a model saw — and to rebuild it exactly — is the reason
        the registry exists at all.
      </Note>
    </div>
  );
}
