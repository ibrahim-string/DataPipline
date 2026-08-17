'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';

import { SideNav } from './SideNav';

/** Drawer nav for narrow screens. Desktop keeps the persistent sidebar. */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-ink-muted hover:text-ink"
      >
        {open ? <X size={16} /> : <Menu size={16} />}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 border-b border-line bg-surface p-3 shadow-xl">
          <SideNav onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
