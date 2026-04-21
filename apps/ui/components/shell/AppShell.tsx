import type { ReactNode } from "react";
import type { ShellViewModel } from "@/lib/view-models";
import { GlobalSignals } from "@/components/shell/GlobalSignals";
import { PrimaryNav } from "@/components/shell/PrimaryNav";
import { TopControlBar } from "@/components/shell/TopControlBar";

type AppShellProps = {
  shell: ShellViewModel;
  activeHref: string;
  children: ReactNode;
};

export function AppShell({ shell, activeHref, children }: AppShellProps) {
  return (
    <div className="page-shell">
      <header className="shell-header">
        <TopControlBar shell={shell} />
        <div className="header-nav">
          <PrimaryNav items={shell.navItems} activeHref={activeHref} />
          <GlobalSignals signals={shell.globalSignals} />
        </div>
      </header>
      <main className="shell-main">{children}</main>
    </div>
  );
}
