import Link from "next/link";
import type { ShellViewModel } from "@/lib/view-models";
import { MonoLabel } from "@/components/primitives/MonoLabel";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";

export function TopControlBar({ shell }: { shell: ShellViewModel }) {
  return (
    <div className="header-top">
      <div className="brand">
        <div className="brand-mark" />
        <div>
          <MonoLabel>Beerengineer</MonoLabel>
          <strong>Control Panel</strong>
        </div>
      </div>

      <WorkspaceSwitcher workspace={shell.activeWorkspace} />

      <div className="title-block">
        <MonoLabel>Board / Workspace scope</MonoLabel>
        <h1>{shell.title}</h1>
        <p>{shell.subtitle}</p>
      </div>

      <div className="header-actions">
        {shell.actions.map((action) => (
          <Link key={action.label} href={action.href} className={action.primary ? "header-link primary" : "header-link"}>
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
