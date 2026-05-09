import type { AppConfigView, SetupDisplayFact } from "@/lib/setup/types";
import {
  fallbackSecretsStubDisplayFact,
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

export function SecretsStubPanel({ configView }: Readonly<{ configView?: AppConfigView | null }>) {
  const displayMode = resolveSetupDisplayFact(
    "secrets_stub",
    configView?.setupDisplayModes?.secretsStub,
    () => fallbackSecretsStubDisplayFact(configView),
  );

  if (!displayMode) {
    return (
      <section
        className="space-y-3 border p-5"
        data-testid="secrets-stub-panel"
        style={{ borderColor: "var(--color-coral)", backgroundColor: "var(--color-zinc-900)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase" style={{ color: "var(--color-zinc-400)" }}>Secrets</p>
            <h2 className="font-display text-xl" style={{ color: "var(--color-zinc-100)" }}>Workflow secrets</h2>
          </div>
          <StatusChip state="invalid" />
        </div>
        <p role="alert" className="text-sm" style={{ color: "var(--color-coral)" }}>Secrets mode data is invalid.</p>
      </section>
    );
  }

  return (
    <section
      className="space-y-3 border p-5"
      data-testid="secrets-stub-panel"
      data-mode={displayMode.mode}
      style={{ borderColor: "var(--color-zinc-800)", backgroundColor: "var(--color-zinc-900)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase" style={{ color: "var(--color-zinc-400)" }}>Secrets</p>
          <h2 className="font-display text-xl" style={{ color: "var(--color-zinc-100)" }}>Workflow secrets</h2>
          <p className="text-sm" style={{ color: "var(--color-zinc-300)" }}>{displayMode.detail}</p>
          <p className="font-mono text-[11px] uppercase" data-testid="secrets-stub-freshness" style={{ color: "var(--color-zinc-500)" }}>
            {freshnessText(displayMode)}
          </p>
        </div>
        <StatusChip state={statusForDisplayMode(displayMode)} />
      </div>
      {displayMode.mode === "action-required" ? (
        <a
          href="/settings#secrets"
          className="inline-flex border px-3 py-2 text-sm font-medium"
          style={{ borderColor: "var(--color-amber-500)", color: "var(--color-amber-300)" }}
        >
          Open secrets settings
        </a>
      ) : null}
      {displayMode.mode === "informational" ? (
        <p className="text-sm" style={{ color: "var(--color-zinc-400)" }}>
          Secret controls become actionable after app initialization completes.
        </p>
      ) : null}
    </section>
  );
}
