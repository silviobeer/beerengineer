"use client";

import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function Topbar() {
  return (
    <header
      data-testid="topbar"
      className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm px-3 py-2 max-w-full"
    >
      <div className="flex items-center gap-3 min-w-0 max-w-full">
        <span
          aria-hidden="true"
          className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400 select-none"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          beerengineer
        </span>
        <WorkspaceSwitcher />
      </div>
    </header>
  );
}
