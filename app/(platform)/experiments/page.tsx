import Link from 'next/link';
import type { Metadata } from 'next';

import { ExperimentChart } from '@/components/charts/ExperimentChart';
import { Badge, Note, PageHeader, Panel, ScoreValue, StatTile } from '@/components/ui/primitives';
import { fmtDate, fmtNumber } from '@/lib/format';
import type { ExperimentRun } from '@/lib/data/types';
import { getExperiments } from '@/lib/server/catalog';

export const metadata: Metadata = { title: 'Experiments' };

function statusTone(status: ExperimentRun['status']) {
  return status === 'completed' ? 'good' : status === 'running' ? 'accent' : 'bad';
}

export default function ExperimentsPage() {
  const experiments = getExperiments();
  const runs = experiments.flatMap((experiment) => experiment.runs);
  const completed = runs.filter((run) => run.status === 'completed');

  const best = completed.reduce<ExperimentRun | null>(
    (top, run) => (!top || run.success_rate > top.success_rate ? run : top),
    null,
  );

  // Correlation between the quality of the data a run saw and how it scored.
  const correlation = pearson(
    completed.map((run) => run.dataset_avg_quality),
    completed.map((run) => run.success_rate),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Experiment tracking"
        title="Runs, linked to the data they trained on"
        description="The point of this page is not the metrics — it is the join. Every run points at a dataset version this pipeline actually produced, so “which data did this model see?” has an exact, reproducible answer."
      />

      <Note tone="warn" title="These evaluation metrics are simulated">
        No model was trained and no robot was evaluated. Success rates, collision rates and losses
        below are generated numbers, deliberately made to increase with dataset quality — that
        relationship is the hypothesis an ELA pipeline exists to test, not evidence produced here.
        What is real is the linkage: run → dataset version → member episodes → quality gates.
      </Note>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Experiments" value={fmtNumber(experiments.length)} />
        <StatTile label="Runs" value={fmtNumber(runs.length)} hint={`${completed.length} completed`} />
        <StatTile
          label="Best success rate"
          value={best ? `${best.success_rate.toFixed(1)}%` : '—'}
          tone="good"
          hint={best?.dataset_version}
        />
        <StatTile
          label="Quality ↔ success correlation"
          value={correlation.toFixed(2)}
          tone="accent"
          hint="Pearson r across completed runs (simulated)"
        />
      </div>

      <div className="space-y-6">
        {experiments.map((experiment) => (
          <Panel
            key={experiment.experiment_id}
            title={experiment.name}
            subtitle={experiment.objective}
            actions={
              <div className="flex items-center gap-2 text-[11px] text-ink-dim">
                <span className="font-mono">{experiment.experiment_id}</span>
                <span>·</span>
                <span>{experiment.owner}</span>
                <span>·</span>
                <span>{fmtDate(experiment.created_at)}</span>
              </div>
            }
          >
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-dim">
                      <th className="px-2 py-2 font-medium">Run</th>
                      <th className="px-2 py-2 font-medium">Dataset version</th>
                      <th className="px-2 py-2 text-right font-medium">Episodes</th>
                      <th className="px-2 py-2 text-right font-medium">Data quality</th>
                      <th className="px-2 py-2 text-right font-medium">Success</th>
                      <th className="px-2 py-2 text-right font-medium">Collisions</th>
                      <th className="px-2 py-2 text-right font-medium">Val loss</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {experiment.runs.map((run) => (
                      <tr key={run.run_id} className="border-b border-line/60 last:border-0">
                        <td className="px-2 py-2">
                          <div className="font-mono text-[12px] text-ink">{run.run_id}</div>
                          <div className="max-w-[220px] truncate text-[11px] text-ink-dim" title={run.notes}>
                            {run.model}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <Link
                            href={`/datasets?v=${run.dataset_version}`}
                            className="font-mono text-[12px] text-accent hover:underline"
                          >
                            {run.dataset_version}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-right tnum text-ink-muted">{fmtNumber(run.episodes)}</td>
                        <td className="px-2 py-2 text-right">
                          <ScoreValue score={run.dataset_avg_quality} />
                        </td>
                        <td className="px-2 py-2 text-right tnum text-ink">{run.success_rate.toFixed(1)}%</td>
                        <td className="px-2 py-2 text-right tnum text-ink-muted">{run.collision_rate.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right tnum text-ink-muted">{run.val_loss.toFixed(3)}</td>
                        <td className="px-2 py-2">
                          <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <ul className="mt-3 space-y-1 text-xs text-ink-dim">
                  {experiment.runs.map((run) => (
                    <li key={`${run.run_id}-note`}>
                      <span className="font-mono text-ink-muted">{run.run_id}</span> — {run.notes}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="min-w-0">
                <div className="mb-1 text-xs text-ink-muted">Success rate by run (simulated)</div>
                <ExperimentChart runs={experiment.runs} />
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

/** Pearson correlation coefficient. Returns 0 for degenerate inputs. */
function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = (xs[i] ?? 0) - meanX;
    const b = (ys[i] ?? 0) - meanY;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}
