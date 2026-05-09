import type { AppConfigView, SetupDisplayFact } from "@/lib/setup/types";
import {
  fallbackWorkspacePresenceDisplayFact,
  resolveSetupDisplayFact,
} from "@/lib/setupDisplayModes";
import { StatusChip } from "@/components/StatusChip";

function statusForDisplayMode(displayMode: SetupDisplayFact): string {
  switch (displayMode.mode) {
    case "ready":
      return "ready";
    case "action-required":
      return "blocked";
    case "informational":
      return "idle";
    default:
      return "unknown";
  }
}

function freshnessText(displayMode: SetupDisplayFact): string {
  return `Refreshes on ${displayMode.freshness.invalidatedBy.join(", ")}.`;
}

export function WorkspacePresencePanel({ configView }: Readonly<{ configView?: AppConfigView | null }>) {
  const displayMode = resolveSetupDisplayFact(
    "workspace_presence",
    configView?.setupDisplayModes?.workspacePresence,
    () => fallbackWorkspacePresenceDisplayFact(configView),
  );

  if (!displayMode) {
    return (
      <section
        className="space-y-3 border p-5"
        data-testid="workspace-presence-panel"
        style={{ borderColor: "var(--color-coral)", backgroundColor: "var(--color-zinc-900)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase" style={{ color: "var(--color-zinc-400)" }}>Workspace</p>
            <h2 className="font-display text-xl" style={{ color: "var(--color-zinc-100)" }}>Workspace presence</h2>
          </div>
          <StatusChip state="invalid" />
        </div>
        <p role="alert" className="text-sm" style={{ color: "var(--color-coral)" }}>Workspace presence mode data is invalid.</p>
      </section>
    );
  }

  return (
    <section
      className="space-y-3 border p-5"
      data-testid="workspace-presence-panel"
      data-mode={displayMode.mode}
      style={{ borderColor: "var(--color-zinc-800)", backgroundColor: "var(--color-zinc-900)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase" style={{ color: "var(--color-zinc-400)" }}>Workspace</p>
          <h2 className="font-display text-xl" style={{ color: "var(--color-zinc-100)" }}>Workspace presence</h2>
          <p className="text-sm" style={{ color: "var(--color-zinc-300)" }}>{displayMode.detail}</p>
          <p className="font-mono text-[11px] uppercase" data-testid="workspace-presence-freshness" style={{ color: "var(--color-zinc-500)" }}>
            {freshnessText(displayMode)}
          </p>
        </div>
        <StatusChip state={statusForDisplayMode(displayMode)} />
      </div>
      {displayMode.mode === "action-required" ? (
        <p className="text-sm" style={{ color: "var(--color-amber-300)" }}>
          Open or repair the active workspace, then run a setup re-check.
        </p>
      ) : null}
      {displayMode.mode === "informational" ? (
        <p className="text-sm" style={{ color: "var(--color-zinc-400)" }}>
          Repo-local checks will stay at the app/global scope until a workspace is available.
        </p>
      ) : null}
    </section>
  );
}
