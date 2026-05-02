import { Topbar } from "@/components/Topbar";
import { SetupGateBox } from "./SetupGateBox";
import { SetupProgressStepper } from "./SetupProgressStepper";
import { SetupSupportZone } from "./SetupSupportZone";
import type { SetupReport } from "@/lib/setup/types";

export function SetupWizardShell({
  report,
  error,
}: Readonly<{ report: SetupReport | null; error?: string | null }>) {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <Topbar />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase text-zinc-500">/setup</p>
          <h1 className="font-display text-3xl">Setup wizard</h1>
        </div>
        <SetupProgressStepper report={report} />
        <SetupGateBox initialReport={report} initialError={error} />
        <SetupSupportZone report={report} />
      </div>
    </main>
  );
}
