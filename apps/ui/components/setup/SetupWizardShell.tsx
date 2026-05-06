"use client";

import { useState } from "react";
import { Topbar } from "@/components/Topbar";
import { SetupGateBox } from "./SetupGateBox";
import { GitIdentityPanel } from "./GitIdentityPanel";
import { SetupProgressStepper } from "./SetupProgressStepper";
import { SetupSupportZone } from "./SetupSupportZone";
import type { AppConfigView, GitReadiness, SetupReport } from "@/lib/setup/types";

export function SetupWizardShell({
  report,
  configView,
  gitReadiness,
  gitError,
  error,
}: Readonly<{
  report: SetupReport | null;
  configView?: AppConfigView | null;
  gitReadiness?: GitReadiness | null;
  gitError?: string | null;
  error?: string | null;
}>) {
  const [checking, setChecking] = useState(false);
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <Topbar />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase text-zinc-500">/setup</p>
          <h2 className="font-display text-3xl">Setup wizard</h2>
        </div>
        <SetupProgressStepper report={report} checking={checking} />
        <GitIdentityPanel
          initialReadiness={gitReadiness ?? null}
          workspace={configView?.workspace ?? null}
          error={gitError}
        />
        <SetupGateBox initialReport={report} initialConfigView={configView ?? null} initialError={error} onCheckingChange={setChecking} />
        <SetupSupportZone report={report} configView={configView ?? null} />
      </div>
    </main>
  );
}
