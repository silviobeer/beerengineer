"use client";

import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function Topbar() {
  return (
    <header
      data-testid="topbar"
      className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 py-2 max-w-full"
    >
      <div className="flex items-center gap-2 min-w-0 max-w-full">
        <WorkspaceSwitcher />
      </div>
    </header>
  );
}
