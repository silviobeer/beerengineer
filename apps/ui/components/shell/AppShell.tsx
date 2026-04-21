"use client";

import type { ReactNode } from "react";
import type { ShellViewModel } from "@/lib/view-models";
import { PrimaryNav } from "@/components/shell/PrimaryNav";

type AppShellProps = {
  shell: ShellViewModel;
  activeHref: string;
  children: ReactNode;
  onWorkspaceChange?: (workspaceKey: string) => void;
};

export function AppShell({ shell, activeHref, children }: AppShellProps) {
  return (
    <div className="page-shell">
      <header className="shell-header">
        <div className="shell-topbar">
          <PrimaryNav items={shell.navItems} activeHref={activeHref} />
        </div>
      </header>
      <main className="shell-main">{children}</main>
    </div>
  );
}
