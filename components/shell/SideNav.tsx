'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Boxes,
  Cpu,
  FlaskConical,
  ListChecks,
  Network,
  type LucideIcon,
} from 'lucide-react';

import { cx } from '@/components/ui/primitives';

const NAV: Array<{ href: string; label: string; icon: LucideIcon; hint: string }> = [
  { href: '/simulator', label: 'Live Simulator', icon: Activity, hint: 'Streaming ingest + pipeline' },
  { href: '/episodes', label: 'Episodes', icon: ListChecks, hint: 'Scored, explainable episodes' },
  { href: '/datasets', label: 'Datasets', icon: Boxes, hint: 'Versions, policies, manifests' },
  { href: '/fleet', label: 'Fleet', icon: Cpu, hint: 'Per-robot data health' },
  { href: '/experiments', label: 'Experiments', icon: FlaskConical, hint: 'Runs linked to versions' },
  { href: '/architecture', label: 'Architecture', icon: Network, hint: 'POC vs production' },
];

export function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Platform sections">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'group flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              active
                ? 'bg-accent/10 text-ink'
                : 'text-ink-muted hover:bg-elevated hover:text-ink',
            )}
          >
            <Icon
              size={16}
              className={cx('mt-0.5 shrink-0', active ? 'text-accent' : 'text-ink-dim')}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.label}</span>
              <span className="block truncate text-[11px] text-ink-dim">{item.hint}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
