"use client";

import type { ReactNode } from "react";
import type { ShellViewModel } from "@/lib/view-models";
import { GlobalSignals } from "@/components/shell/GlobalSignals";
import { PrimaryNav } from "@/components/shell/PrimaryNav";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";

type AppShellProps = {
  shell: ShellViewModel;
  activeHref: string;
  children: ReactNode;
  workspaceHrefBase?: string;
};

export function AppShell({ shell, activeHref, children, workspaceHrefBase = "/" }: AppShellProps) {
  return (
    <div className="page-shell">
      <header className="shell-header">
        <div className="shell-topbar">
          <WorkspaceSwitcher
            workspace={shell.activeWorkspace}
            workspaces={shell.availableWorkspaces}
            hrefBase={workspaceHrefBase}
          />
          <PrimaryNav items={shell.navItems} activeHref={activeHref} />
          <GlobalSignals signals={shell.globalSignals} entries={shell.signalEntries} />
        </div>
      </header>
      <main className="shell-main">{children}</main>
    </div>
  );
}
