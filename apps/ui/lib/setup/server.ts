import type { AppConfigView, GitReadiness, SetupReport } from "./types";
import { engineBaseUrl } from "@/lib/engine/baseUrl";
import { resolveWorkspaceScopedGitReadinessId } from "@/lib/setupDisplayModes";

async function readJson<T>(path: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${engineBaseUrl()}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return { data: null, error: `engine responded ${res.status}` };
    return { data: (await res.json()) as T, error: null };
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { data: null, error: "Engine setup request timed out. Confirm the local engine is responsive and reload this page." };
    }
    return { data: null, error: "Engine is unreachable. Start the local engine and reload this page." };
  }
}

export function fetchSetupReport(): Promise<{ data: SetupReport | null; error: string | null }> {
  return readJson<SetupReport>("/setup/status");
}

export function fetchAppConfigView(): Promise<{ data: AppConfigView | null; error: string | null }> {
  return readJson<AppConfigView>("/setup/config");
}

export function fetchGitReadiness(workspaceId?: string): Promise<{ data: GitReadiness | null; error: string | null }> {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  return readJson<GitReadiness>(`/setup/git-readiness${query}`);
}

type WorkspaceLookup = {
  id?: string;
  key?: string;
  rootPath?: string | null;
  root_path?: string | null;
};

export async function resolveSetupGitReadinessWorkspaceId(configView: AppConfigView | null): Promise<string | undefined> {
  return resolveWorkspaceScopedGitReadinessId(
    configView,
    async (workspaceKey) => (await readJson<WorkspaceLookup>(`/workspaces/${encodeURIComponent(workspaceKey)}`)).data,
  );
}
