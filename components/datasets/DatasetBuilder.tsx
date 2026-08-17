'use client';

import { useState } from 'react';
import { Download, Hammer, Loader2 } from 'lucide-react';

import { Badge, Note, Panel, cx } from '@/components/ui/primitives';
import { fmtBytes, fmtNumber } from '@/lib/format';
import type { DatasetVersion, ManifestEntry } from '@/lib/pipeline/dataset';
import type { ExportFormat } from '@/lib/pipeline/export';
import type { Sensor } from '@/lib/pipeline/types';

interface BuildResponse {
  version: DatasetVersion;
  manifest_preview: ManifestEntry[];
  manifest_total: number;
  excluded_preview: Array<{ episode_id: string; reason: string; score: number }>;
  excluded_total: number;
}

const CORE_SENSORS: Sensor[] = ['camera', 'lidar', 'imu', 'odometry'];
const FORMATS: ExportFormat[] = ['json', 'jsonl', 'csv'];

const STEPS = [
  'Load candidate episodes',
  'Apply quality gates',
  'Apply build policy',
  'Assign version + compute statistics',
  'Generate manifest',
];

export function DatasetBuilder({ scopes }: { scopes: Array<{ id: string; description: string }> }) {
  const [dataset, setDataset] = useState(scopes[0]?.id ?? 'hospital-navigation');
  const [version, setVersion] = useState('v0.4');
  const [minScore, setMinScore] = useState(88);
  const [minDuration, setMinDuration] = useState(10);
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [requireSensors, setRequireSensors] = useState<Sensor[]>([...CORE_SENSORS]);

  const [building, setBuilding] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildResponse | null>(null);

  const policyBody = () => ({
    dataset,
    version,
    min_quality_score: minScore,
    min_duration_s: minDuration,
    include_flagged: includeFlagged,
    require_sensors: requireSensors,
  });

  async function build() {
    setBuilding(true);
    setError(null);
    try {
      const response = await fetch('/api/datasets/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policyBody()),
      });
      if (!response.ok) throw new Error(`Build failed with status ${response.status}`);
      setResult((await response.json()) as BuildResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Build failed.');
      setResult(null);
    } finally {
      setBuilding(false);
    }
  }

  async function download(format: ExportFormat) {
    setExporting(format);
    setError(null);
    try {
      const response = await fetch('/api/datasets/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...policyBody(), format }),
      });
      if (!response.ok) throw new Error(`Export failed with status ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${dataset}-${version}-manifest.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed.');
    } finally {
      setExporting(null);
    }
  }

  function toggleSensor(sensor: Sensor) {
    setRequireSensors((current) =>
      current.includes(sensor) ? current.filter((item) => item !== sensor) : [...current, sensor],
    );
  }

  const stats = result?.version.stats;

  return (
    <Panel
      title="Build a dataset version"
      subtitle="Set a policy, cut a version, download the manifest. The build runs server-side over the full episode catalog."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* Policy form */}
        <div className="space-y-4">
          <div>
            <label htmlFor="build-scope" className="text-xs font-medium text-ink-muted">
              Dataset
            </label>
            <select
              id="build-scope"
              value={dataset}
              onChange={(event) => setDataset(event.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-base px-2.5 py-2 text-sm text-ink"
            >
              {scopes.map((scope) => (
                <option key={scope.id} value={scope.id}>
                  {scope.id}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-dim">
              {scopes.find((scope) => scope.id === dataset)?.description}
            </p>
          </div>

          <div>
            <label htmlFor="build-version" className="text-xs font-medium text-ink-muted">
              Version tag
            </label>
            <input
              id="build-version"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="v0.4"
              className="mt-1 w-full rounded-md border border-line bg-base px-2.5 py-2 font-mono text-sm text-ink"
            />
          </div>

          <div>
            <label htmlFor="build-score" className="flex items-baseline justify-between text-xs font-medium text-ink-muted">
              Minimum quality score
              <span className="tnum text-ink">{minScore}</span>
            </label>
            <input
              id="build-score"
              type="range"
              min={0}
              max={100}
              step={1}
              value={minScore}
              onChange={(event) => setMinScore(Number(event.target.value))}
              className="mt-2 w-full accent-[var(--color-accent)]"
            />
          </div>

          <div>
            <label htmlFor="build-duration" className="flex items-baseline justify-between text-xs font-medium text-ink-muted">
              Minimum duration
              <span className="tnum text-ink">{minDuration}s</span>
            </label>
            <input
              id="build-duration"
              type="range"
              min={0}
              max={60}
              step={1}
              value={minDuration}
              onChange={(event) => setMinDuration(Number(event.target.value))}
              className="mt-2 w-full accent-[var(--color-accent)]"
            />
          </div>

          <div>
            <span className="text-xs font-medium text-ink-muted">Required sensors</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CORE_SENSORS.map((sensor) => {
                const active = requireSensors.includes(sensor);
                return (
                  <button
                    key={sensor}
                    type="button"
                    onClick={() => toggleSensor(sensor)}
                    aria-pressed={active}
                    className={cx(
                      'rounded-md border px-2 py-1 text-xs transition-colors',
                      active
                        ? 'border-accent/40 bg-accent/10 text-ink'
                        : 'border-line bg-base text-ink-dim hover:text-ink',
                    )}
                  >
                    {sensor}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={includeFlagged}
              onChange={(event) => setIncludeFlagged(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            Include FLAGGED episodes
          </label>

          <button
            type="button"
            onClick={build}
            disabled={building}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2.5 text-sm font-medium text-base transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {building ? <Loader2 size={15} className="animate-spin" /> : <Hammer size={15} />}
            {building ? 'Building…' : 'Build Dataset'}
          </button>

          {error && (
            <p role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad">
              {error}
            </p>
          )}
        </div>

        {/* Result */}
        <div className="min-w-0">
          {building && (
            <ol className="space-y-2 text-sm text-ink-muted">
              {STEPS.map((step) => (
                <li key={step} className="flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin text-accent" />
                  {step}
                </li>
              ))}
            </ol>
          )}

          {!building && !result && (
            <div className="flex h-full min-h-[260px] items-center justify-center rounded-lg border border-dashed border-line-strong px-6 text-center">
              <p className="max-w-sm text-sm text-ink-dim">
                No build yet. Adjust the policy and press <strong className="text-ink-muted">Build Dataset</strong> —
                the result shows exactly which episodes were admitted and which rule excluded the rest.
              </p>
            </div>
          )}

          {!building && result && stats && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-ink">{result.version.full_name}</span>
                <Badge tone="accent">session build · not persisted</Badge>
                {result.version.parent && (
                  <span className="text-[11px] text-ink-dim">parent: {result.version.parent}</span>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Candidates', value: fmtNumber(stats.candidates) },
                  { label: 'Included', value: fmtNumber(stats.included), tone: 'text-good' },
                  { label: 'Excluded', value: fmtNumber(result.excluded_total), tone: 'text-bad' },
                  { label: 'Avg quality', value: stats.avg_quality.toFixed(1) },
                ].map((item) => (
                  <div key={item.label} className="rounded-md border border-line bg-base px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-wider text-ink-dim">{item.label}</dt>
                    <dd className={cx('tnum mt-0.5 text-lg font-semibold', item.tone ?? 'text-ink')}>
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="grid gap-2 text-xs text-ink-muted sm:grid-cols-3">
                <div>
                  Total duration <span className="tnum text-ink">{(stats.total_duration_s / 60).toFixed(1)} min</span>
                </div>
                <div>
                  Events <span className="tnum text-ink">{fmtNumber(stats.total_events)}</span>
                </div>
                <div>
                  Est. raw size <span className="tnum text-ink">{fmtBytes(stats.estimated_size_bytes)}</span>
                </div>
              </div>

              {stats.exclusions.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wider text-ink-dim">
                    Why episodes were excluded
                  </h4>
                  <ul className="mt-2 space-y-1">
                    {stats.exclusions.map((exclusion) => (
                      <li
                        key={exclusion.reason}
                        className="flex items-center justify-between gap-3 rounded border border-line bg-base px-2.5 py-1.5 text-xs"
                      >
                        <span className="min-w-0 truncate text-ink-muted">{exclusion.reason}</span>
                        <span className="tnum shrink-0 text-ink">{exclusion.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h4 className="text-xs font-medium uppercase tracking-wider text-ink-dim">
                  Manifest preview ({fmtNumber(result.manifest_total)} entries)
                </h4>
                <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-line bg-base p-3 font-mono text-[11px] leading-relaxed text-ink-muted">
                  {result.manifest_preview
                    .slice(0, 6)
                    .map((entry) => JSON.stringify(entry))
                    .join('\n') || 'No episodes matched this policy.'}
                </pre>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <span className="text-xs text-ink-dim">Download manifest:</span>
                {FORMATS.map((format) => (
                  <button
                    key={format}
                    type="button"
                    onClick={() => download(format)}
                    disabled={exporting !== null || result.manifest_total === 0}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-base px-2.5 py-1.5 text-xs text-ink transition-colors hover:border-accent/40 disabled:opacity-50"
                  >
                    {exporting === format ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    .{format}
                  </button>
                ))}
              </div>

              <Note>
                This version exists for your session only. Builds are a pure function of
                (episodes, scope, policy), so nothing is written server-side — in production this
                step would insert a row into a dataset registry and write the manifest to object
                storage.
              </Note>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
