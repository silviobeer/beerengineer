"use client";

import { useMemo, useState } from "react";
import { StatusChip } from "@/components/StatusChip";
import type {
  AppConfigPatchResult,
  GitIdentityDefault,
  GitIdentityValidationError,
  GitIdentityValidationResponse,
  GitIdentityValue,
  GitReadiness,
  WorkspaceGitReadiness,
  WorkspaceGitRepairResponse,
} from "@/lib/setup/types";
import { GitIdentityForm } from "./GitIdentityForm";

interface GitIdentityPanelProps {
  readonly initialReadiness: GitReadiness | null;
  readonly workspace?: { id: string; key?: string; name?: string } | null;
  readonly error?: string | null;
}

function sourceLabel(source: string | undefined): string {
  switch (source) {
    case "repo-local":
      return "Repo-local identity";
    case "global":
      return "Global Git identity";
    case "app-default":
      return "beerengineer_ default";
    default:
      return "Not ready";
  }
}

function identityText(identity: GitIdentityValue | GitIdentityDefault | undefined): string {
  const name = "displayName" in (identity ?? {}) ? (identity as GitIdentityDefault).displayName : (identity as GitIdentityValue | undefined)?.name;
  const email = identity?.email;
  if (name && email) return `${name} <${email}>`;
  if (name) return `${name} (email missing)`;
  if (email) return `${email} (name missing)`;
  return "Not configured";
}

function statusFor(readiness: GitReadiness | null): string {
  if (!readiness) return "unknown";
  if (!readiness.git.installed) return "missing";
  if (readiness.workflowBlocked) return "blocked";
  return "ok";
}

function initialFormIdentity(readiness: GitReadiness | null): Partial<GitIdentityDefault> {
  if (!readiness) return {};
  if (readiness.appDefaultIdentity) return readiness.appDefaultIdentity;
  if (readiness.globalIdentity.name || readiness.globalIdentity.email) {
    return {
      displayName: readiness.globalIdentity.name ?? "",
      email: readiness.globalIdentity.email ?? "",
    };
  }
  return {};
}

function validationErrors(body: unknown): GitIdentityValidationError[] {
  const parsed = body as Partial<GitIdentityValidationResponse> | Partial<WorkspaceGitRepairResponse>;
  if (Array.isArray((parsed as GitIdentityValidationResponse).errors)) return (parsed as GitIdentityValidationResponse).errors;
  const repair = parsed as Partial<WorkspaceGitRepairResponse>;
  if (repair.validation && Array.isArray(repair.validation.errors)) return repair.validation.errors;
  return [];
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function GitIdentityPanel({ initialReadiness, workspace = null, error: initialError = null }: Readonly<GitIdentityPanelProps>) {
  const [readiness, setReadiness] = useState(initialReadiness);
  const [busy, setBusy] = useState(false);
  const [repairConfirmed, setRepairConfirmed] = useState(false);
  const [errors, setErrors] = useState<GitIdentityValidationError[]>([]);
  const [message, setMessage] = useState<string | null>(initialError);

  const formIdentity = useMemo(() => initialFormIdentity(readiness), [readiness]);
  const isWorkspace = readiness?.mode === "workspace";
  const canRepairWorkspace = isWorkspace
    && readiness.git.installed
    && readiness.availableActions.includes("repair_workspace_identity")
    && readiness.effectiveIdentity?.source !== "repo-local";
  const hasRepoLocalIdentity = readiness?.mode === "workspace" && readiness.effectiveIdentity?.source === "repo-local";

  async function recheck() {
    setBusy(true);
    setErrors([]);
    setMessage(null);
    try {
      const query = workspace?.id ? `?workspaceId=${encodeURIComponent(workspace.id)}` : "";
      const res = await fetch(`/api/setup/git-readiness${query}`, { cache: "no-store" });
      const body = await readJson(res);
      if (!res.ok || !body || typeof body !== "object") {
        setMessage("Git readiness could not be refreshed.");
        return;
      }
      setReadiness(body as GitReadiness);
      setRepairConfirmed(false);
    } catch {
      setMessage("Git readiness could not be refreshed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAppIdentity(identity: { displayName: string; email: string }) {
    setBusy(true);
    setErrors([]);
    setMessage(null);
    try {
      const res = await fetch("/api/setup/git-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity }),
      });
      const body = await readJson(res);
      if (!res.ok) {
        const nextErrors = validationErrors(body);
        setErrors(nextErrors);
        setMessage(nextErrors.length > 0 ? "Fix the highlighted Git identity fields." : "Git identity could not be saved.");
        return;
      }
      const result = body as Partial<AppConfigPatchResult>;
      if (result.ok === false) {
        setMessage(result.rejected?.[0]?.error ?? "Git identity could not be saved.");
        return;
      }
      setMessage("beerengineer_ Git identity saved.");
      await recheck();
    } catch {
      setMessage("Git identity could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function repairWorkspace(identity: { displayName: string; email: string }) {
    if (!workspace?.id || !repairConfirmed) return;
    setBusy(true);
    setErrors([]);
    setMessage(null);
    try {
      const res = await fetch("/api/setup/git-identity/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          workspaceKey: workspace.key,
          identity,
        }),
      });
      const body = await readJson(res) as WorkspaceGitRepairResponse | null;
      if (body?.readiness) setReadiness(body.readiness);
      if (!res.ok || body?.ok === false) {
        const nextErrors = validationErrors(body);
        setErrors(nextErrors);
        setMessage(body?.error === "repair_partial_failure"
          ? "Workspace Git identity partially applied. Fresh state is shown below."
          : body?.message ?? "Workspace Git identity repair failed.");
        return;
      }
      setMessage("Workspace Git identity repaired.");
      await recheck();
    } catch {
      setMessage("Workspace Git identity repair failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!readiness) {
    return (
      <section className="space-y-3 border border-zinc-800 bg-zinc-900 p-5" data-testid="git-identity-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase text-zinc-400">Git step</p>
            <h2 className="font-display text-xl text-zinc-100">Git identity readiness</h2>
          </div>
          <StatusChip state="unknown" />
        </div>
        <p className="text-sm text-zinc-400">{message ?? "Git readiness is unavailable."}</p>
        <button type="button" onClick={recheck} className="border border-amber-500 bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950">
          Re-check Git
        </button>
      </section>
    );
  }

  const effective = readiness.effectiveIdentity;

  return (
    <section className="space-y-5 border border-zinc-800 bg-zinc-900 p-5" data-testid="git-identity-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-xs uppercase text-zinc-400">Git step</p>
          <h2 className="font-display text-xl text-zinc-100">Git identity readiness</h2>
          <p className="max-w-3xl text-sm text-zinc-300">
            beerengineer_ uses local Git commit checkpoints so workflows can recover cleanly. This setup does not create GitHub remotes, push branches, or open pull requests.
          </p>
        </div>
        <StatusChip state={statusFor(readiness)} />
      </div>

      {!readiness.git.installed ? (
        <div className="space-y-3 border border-zinc-800 bg-zinc-950/40 p-4" data-testid="git-missing-stub">
          <h3 className="font-display text-lg text-zinc-100">Git is not configured</h3>
          <p className="text-sm text-zinc-400">{readiness.blocker?.message ?? "Install Git before configuring an identity."}</p>
          <p className="text-sm text-zinc-400">Install Git, then re-check this setup step.</p>
          <button
            type="button"
            onClick={recheck}
            disabled={busy}
            className="border border-amber-500 bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
          >
            {busy ? "Checking" : "Re-check Git"}
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2" data-testid="git-source-rows">
            <IdentityRow label="Effective source" value={effective ? `${sourceLabel(effective.source)}: ${effective.name} <${effective.email}>` : readiness.blocker?.message ?? "Blocked"} />
            {readiness.mode === "workspace" ? <IdentityRow label="Repo-local" value={identityText(readiness.repoLocalIdentity)} /> : null}
            <IdentityRow label="Global Git" value={identityText(readiness.globalIdentity)} />
            <IdentityRow label="beerengineer_ default" value={identityText(readiness.appDefaultIdentity)} />
          </div>
          {hasRepoLocalIdentity ? (
            <p className="text-sm text-emerald-300">Repo-local identity is respected and remains authoritative for this workspace.</p>
          ) : null}
          {effective?.source === "global" ? (
            <p className="text-sm text-emerald-300">Global Git identity is ready for workflows when no repo-local identity is set.</p>
          ) : null}
          {message ? <p role={message.includes("failed") || message.includes("Fix") || message.includes("partially") ? "alert" : "status"} className="text-sm text-amber-200">{message}</p> : null}
          <GitIdentityForm
            title="beerengineer_ default identity"
            description="Save this in beerengineer_ config only. Global Git config is not changed."
            submitLabel="Save app identity"
            initialIdentity={formIdentity}
            busy={busy}
            errors={errors}
            onSubmit={saveAppIdentity}
          />
          {canRepairWorkspace ? (
            <div className="space-y-3 border border-zinc-800 bg-zinc-950/40 p-4" data-testid="git-workspace-repair">
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={repairConfirmed}
                  onChange={(event) => setRepairConfirmed(event.target.checked)}
                />
                <span>Confirm writing this identity as repo-local Git config for {workspace?.name ?? workspace?.key ?? "this workspace"}.</span>
              </label>
              <GitIdentityForm
                title="Workspace-local repair"
                description="The browser sends only the workspace identifier and identity values. The engine resolves the path from server-side state."
                submitLabel="Apply to this workspace"
                initialIdentity={formIdentity}
                busy={busy}
                disabled={!repairConfirmed}
                errors={errors}
                onSubmit={repairWorkspace}
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function IdentityRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0 border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="font-mono text-xs uppercase text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-200" style={{ overflowWrap: "anywhere" }}>{value}</p>
    </div>
  );
}
