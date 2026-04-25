"use client";

import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function Topbar() {
  return (
    <header
      data-testid="topbar"
      className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <WorkspaceSwitcher />
      </div>
    </header>
  );
}
