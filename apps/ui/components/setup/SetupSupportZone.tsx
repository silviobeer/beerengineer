import { currentSetupGroup, type SetupReport } from "@/lib/setup/types";
import { InstallationOptionCard } from "./InstallationOptionCard";

export function SetupSupportZone({ report }: Readonly<{ report: SetupReport | null }>) {
  const group = currentSetupGroup(report);
  const checks = group?.checks.filter((check) => check.status !== "ok") ?? [];
  return (
    <section data-testid="setup-support-zone" className="space-y-3">
      <div className="border-t border-zinc-800 pt-5">
        <h2 className="font-display text-lg text-zinc-100">Installation options</h2>
        <p className="text-sm text-zinc-400">
          These are manual remedies from the engine. The UI never installs external tools automatically.
        </p>
      </div>
      <div className="grid gap-3">
        {(checks.length > 0 ? checks : [{ id: "empty", label: "No blocker", status: "ok" as const }]).map((check) => (
          <InstallationOptionCard key={check.id} check={check} />
        ))}
      </div>
    </section>
  );
}
