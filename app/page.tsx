import Link from 'next/link';
import { ArrowRight, ExternalLink, Network } from 'lucide-react';

import { fmtNumber } from '@/lib/format';
import { getStats } from '@/lib/server/catalog';

const PIPELINE = [
  'Raw sensors',
  'Ingestion',
  'Validation',
  'Synchronization',
  'Quality engine',
  'Episodes',
  'Dataset versions',
  'Training / experiments',
];

const HIGHLIGHTS = [
  {
    title: 'It finds real problems, not decorative ones',
    body: 'Dropouts, clock drift, duplicate sequence IDs, out-of-order delivery, NaN and Infinity, impossible accelerations, and action labels that contradict the odometry — each detected by a specific check with a specific threshold.',
  },
  {
    title: 'Every accept or reject is explained',
    body: 'A weighted score ranks episodes; hard gates reject them. An episode scoring 94 with a 1.4 s LiDAR hole is still rejected, and the rejection names the sensor, the duration and the threshold it broke.',
  },
  {
    title: 'Datasets are reproducible selections',
    body: 'A version is a policy plus a member list plus statistics. Change the policy and you get a different version, not a different answer to the same question — and every excluded episode carries its reason.',
  },
];

export default function LandingPage() {
  const stats = getStats();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-accent/15 text-[11px] font-bold text-accent">
              EL
            </span>
            ELA Lab
          </div>
          <nav className="flex items-center gap-4 text-sm text-ink-muted">
            <Link href="/architecture" className="hover:text-ink">
              Architecture
            </Link>
            <Link
              href="/simulator"
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-base hover:bg-accent/90"
            >
              Open simulator
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-line">
          <div className="grid-backdrop absolute inset-0 opacity-40" aria-hidden />
          <div
            className="absolute inset-0 bg-gradient-to-b from-transparent via-base/60 to-base"
            aria-hidden
          />
          <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
            <div className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-dim">
              Embodied Learning from Action · an independent build for Omakase Robotics
            </div>

            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
              From robot experience to training-ready data.
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted">
              An end-to-end robotics data pipeline for collecting, validating,
              synchronizing, scoring and versioning multimodal robot experience —
              built to show how raw telemetry becomes a dataset a model can
              actually be trained on, and how bad data gets caught before it gets
              there.
            </p>

            <p className="mt-4 max-w-2xl border-l-2 border-accent/30 pl-4 text-sm leading-relaxed text-ink-muted">
              I read the public Robotics Data Engineer role at Omakase Robotics, and
              rather than claim I could learn the domain, I spent a few days building
              a small version of the problem. This is that build —{' '}
              <span className="text-ink-dim">
                a personal project, made independently, with no affiliation to the
                company.
              </span>
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/simulator"
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-base transition-colors hover:bg-accent/90"
              >
                Open Live Simulator
                <ArrowRight size={15} />
              </Link>
              <Link
                href="/architecture"
                className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-accent/40"
              >
                <Network size={15} />
                View Architecture
              </Link>
            </div>

            <dl className="mt-12 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
              {[
                { label: 'Simulated robots', value: fmtNumber(stats.robots) },
                { label: 'Episodes scored', value: fmtNumber(stats.episodes) },
                { label: 'Telemetry events processed', value: fmtNumber(stats.events_processed) },
                { label: 'Episodes rejected', value: fmtNumber(stats.rejected) },
              ].map((item) => (
                <div key={item.label}>
                  <dd className="tnum text-2xl font-semibold text-ink">{item.value}</dd>
                  <dt className="mt-1 text-xs leading-snug text-ink-dim">{item.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Pipeline strip */}
        <section className="border-b border-line bg-surface/40">
          <div className="mx-auto max-w-6xl overflow-x-auto px-4 py-6">
            <ol className="flex min-w-max items-center gap-2 text-xs">
              {PIPELINE.map((stage, index) => (
                <li key={stage} className="flex items-center gap-2">
                  <span className="rounded border border-line bg-surface px-2.5 py-1.5 text-ink-muted">
                    <span className="mr-1.5 text-ink-dim tnum">{index + 1}</span>
                    {stage}
                  </span>
                  {index < PIPELINE.length - 1 && (
                    <span className="text-ink-dim" aria-hidden>
                      →
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Highlights */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-6 md:grid-cols-3">
            {HIGHLIGHTS.map((item) => (
              <article key={item.title} className="rounded-lg border border-line bg-surface p-5">
                <h2 className="text-sm font-medium text-ink">{item.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Honesty block */}
        <section className="border-y border-line bg-surface/40">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-2">
            <div>
              <h2 className="text-sm font-medium text-ink">What this is</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                A working system: a simulated fleet produces multimodal telemetry
                with realistic faults injected, and the same pipeline code runs in
                the offline batch job and against the live stream. The quality
                engine, the episode builder and the dataset registry are covered
                by 96 tests.
              </p>
            </div>
            <div>
              <h2 className="text-sm font-medium text-ink">What this is not</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                There is no physical robot, no ROS 2 stream, no real camera or
                LiDAR data, and no model was trained — the experiment metrics are
                simulated and labelled as such throughout. The{' '}
                <Link href="/architecture" className="text-accent hover:underline">
                  architecture page
                </Link>{' '}
                sets out, layer by layer, what would have to change for real
                robots.
              </p>
            </div>
          </div>
        </section>

        {/* Author */}
        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-ink">Built independently by Ibrahim</p>
              <p className="mt-1 text-sm text-ink-muted">AI/ML Engineer · Japan</p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/ibrahim-string"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
              >
                GitHub
                <ExternalLink size={13} />
              </a>
              <a
                href="https://www.linkedin.com/in/ibrahimonmars/"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
              >
                LinkedIn
                <ExternalLink size={13} />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-4 py-6">
        <p className="mx-auto max-w-6xl text-[11px] leading-relaxed text-ink-dim">
          An independent project built by Ibrahim, inspired by publicly available
          robotics data-engineering challenges. Not affiliated with, endorsed by, or
          produced for Omakase Robotics in any official capacity. No proprietary data,
          APIs, branding or confidential information is used — all telemetry, robots,
          sites and metrics on this site are synthetic.
        </p>
      </footer>
    </div>
  );
}
