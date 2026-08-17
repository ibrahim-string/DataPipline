import Link from 'next/link';
import type { ReactNode } from 'react';

import { MobileNav } from '@/components/shell/MobileNav';
import { SideNav } from '@/components/shell/SideNav';
import { getStats } from '@/lib/server/catalog';
import { fmtNumber } from '@/lib/format';

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const stats = getStats();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-base/95 backdrop-blur">
        <div className="relative mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold text-ink">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-accent/15 text-[11px] font-bold text-accent">
              EL
            </span>
            <span className="hidden sm:inline">Omakase ELA Lab</span>
          </Link>

          <span className="hidden rounded border border-line-strong px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-dim md:inline">
            Independent POC · synthetic data
          </span>

          <div className="ml-auto flex items-center gap-4">
            <dl className="hidden items-center gap-4 text-xs text-ink-dim xl:flex">
              <div className="flex items-center gap-1.5">
                <dt>Episodes</dt>
                <dd className="tnum text-ink">{fmtNumber(stats.episodes)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>Events processed</dt>
                <dd className="tnum text-ink">{fmtNumber(stats.events_processed)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>Avg quality</dt>
                <dd className="tnum text-ink">{stats.avg_quality.toFixed(1)}</dd>
              </div>
            </dl>
            <MobileNav />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-6 px-4 py-6">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20">
            <SideNav />
            <div className="mt-6 rounded-md border border-line bg-surface px-3 py-2.5 text-[11px] leading-relaxed text-ink-dim">
              Synthetic telemetry only. No robot, vendor or operator data is used
              anywhere in this project.
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <footer className="border-t border-line px-4 py-5">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 text-[11px] text-ink-dim">
          <p>
            Independent portfolio project inspired by publicly available robotics
            data-engineering challenges. Not affiliated with Omakase Robotics.
          </p>
          <p>
            Built by Ibrahim ·{' '}
            <a
              className="text-ink-muted underline decoration-line-strong underline-offset-2 hover:text-accent"
              href="https://github.com/ibrahim-string"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
