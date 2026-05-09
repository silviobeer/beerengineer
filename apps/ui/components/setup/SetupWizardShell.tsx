"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { SetupGateBox } from "./SetupGateBox";
import { GitIdentityPanel } from "./GitIdentityPanel";
import { SetupProgressStepper } from "./SetupProgressStepper";
import { SetupSupportZone } from "./SetupSupportZone";
import type { AppConfigView, GitReadiness, SetupReport } from "@/lib/setup/types";
import { resolveWorkspaceScopedGitReadinessId } from "@/lib/setupDisplayModes";
import { WorkspacePresencePanel } from "./WorkspacePresencePanel";
import { SecretsStubPanel } from "./SecretsStubPanel";

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return await res.json() as T;
  } catch {
    return null;
  }
}

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
  const [reportState, setReportState] = useState(report);
  const [configViewState, setConfigViewState] = useState(configView ?? null);
  const [gitReadinessState, setGitReadinessState] = useState(gitReadiness ?? null);
  const [gitErrorState, setGitErrorState] = useState(gitError ?? null);

  useEffect(() => {
    setReportState(report);
  }, [report]);

  useEffect(() => {
    setConfigViewState(configView ?? null);
  }, [configView]);

  useEffect(() => {
    setGitReadinessState(gitReadiness ?? null);
  }, [gitReadiness]);

  useEffect(() => {
    setGitErrorState(gitError ?? null);
  }, [gitError]);

  async function refreshSetupPanels(nextReport?: SetupReport | null) {
    try {
      const configRes = await fetch("/api/setup/config", { cache: "no-store" });
      const nextConfigView = configRes.ok ? await readJson<AppConfigView>(configRes) : null;
      setConfigViewState(nextConfigView);
      setReportState(nextReport ?? reportState);

      const workspaceId = await resolveWorkspaceScopedGitReadinessId(
        nextConfigView,
        async (workspaceKey) => {
          const workspaceRes = await fetch(`/api/workspaces/${encodeURIComponent(workspaceKey)}`, { cache: "no-store" });
          return workspaceRes.ok ? await readJson<{ rootPath?: string | null; root_path?: string | null }>(workspaceRes) : null;
        },
      );
      const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
      const gitRes = await fetch(`/api/setup/git-readiness${query}`, { cache: "no-store" });
      const nextGitReadiness = gitRes.ok ? await readJson<GitReadiness>(gitRes) : null;
      setGitReadinessState(nextGitReadiness);
      setGitErrorState(gitRes.ok ? null : "Git readiness could not be refreshed.");
    } catch {
      setGitErrorState("Git readiness could not be refreshed.");
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <Topbar />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase text-zinc-500">/setup</p>
          <h2 className="font-display text-3xl">Setup wizard</h2>
        </div>
        <SetupProgressStepper report={reportState} checking={checking} />
        <GitIdentityPanel
          initialReadiness={gitReadinessState}
          workspace={configViewState?.workspace ?? null}
          error={gitErrorState}
        />
        <div className="grid gap-6 md:grid-cols-2">
          <WorkspacePresencePanel configView={configViewState} />
          <SecretsStubPanel configView={configViewState} />
        </div>
        <SetupGateBox
          initialReport={reportState}
          initialConfigView={configViewState}
          initialError={error}
          onCheckingChange={setChecking}
          onRechecked={refreshSetupPanels}
        />
        <SetupSupportZone report={reportState} configView={configViewState} />
      </div>
    </main>
  );
}
