import { currentSetupGroup, type AppConfigView, type SetupReport } from "@/lib/setup/types";
import { InstallationOptionCard } from "./InstallationOptionCard";
import { SonarSetupCard } from "./SonarSetupCard";
import { SupabaseSetupCard } from "./SupabaseSetupCard";

function hasSonarChecks(report: SetupReport | null): boolean {
  return report?.groups.some((group) =>
    group.id.includes("sonar")
    || group.checks.some((check) => check.id.includes("sonar") || check.label.toLowerCase().includes("sonar")),
  ) ?? false;
}

export function SetupSupportZone({ report, configView }: Readonly<{ report: SetupReport | null; configView?: AppConfigView | null }>) {
  const group = currentSetupGroup(report);
  const checks = group?.checks.filter((check) => check.status !== "ok") ?? [];
  const showSonarConfig = hasSonarChecks(report) || configView?.config.llm.defaultSonarOrganization !== undefined;
  const workspaceId = configView?.workspace?.id ?? "default";
  return (
    <section data-testid="setup-support-zone" className="space-y-3">
      <div className="border-t border-zinc-800 pt-5">
        <h2 className="font-display text-lg text-zinc-100">Installation options</h2>
        <p className="text-sm text-zinc-400">
          These are manual remedies from the engine. The UI never installs external tools automatically.
        </p>
      </div>
      <div className="grid gap-3">
        {showSonarConfig ? <SonarSetupCard defaultOrganization={configView?.config.llm.defaultSonarOrganization} /> : null}
        <SupabaseSetupCard workspaceId={workspaceId} supabase={configView?.supabase} />
        {(checks.length > 0 ? checks : [{ id: "empty", label: "No blocker", status: "ok" as const }]).map((check) => (
          <InstallationOptionCard key={check.id} check={check} />
        ))}
      </div>
    </section>
  );
}
