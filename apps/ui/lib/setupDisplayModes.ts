import type { AppConfigView, GitReadiness, SetupDisplayFact, SetupDisplayMode } from "@/lib/setup/types";

export type SetupDisplayPanel = "git_identity" | "workspace_presence" | "secrets_stub";

type SetupDisplayModeTelemetry = {
  git_identity: number;
  workspace_presence: number;
  secrets_stub: number;
  fallbackEvents: Array<{ panel: SetupDisplayPanel }>;
  invalidEvents: Array<{ panel: SetupDisplayPanel; mode: string }>;
};

const telemetry: SetupDisplayModeTelemetry = {
  git_identity: 0,
  workspace_presence: 0,
  secrets_stub: 0,
  fallbackEvents: [],
  invalidEvents: [],
};

function recordFallback(panel: SetupDisplayPanel): void {
  telemetry[panel] += 1;
  telemetry.fallbackEvents.push({ panel });
}

function recordInvalid(panel: SetupDisplayPanel, mode: string): void {
  telemetry.invalidEvents.push({ panel, mode });
}

export function readSetupDisplayModeTelemetry(): SetupDisplayModeTelemetry {
  return {
    git_identity: telemetry.git_identity,
    workspace_presence: telemetry.workspace_presence,
    secrets_stub: telemetry.secrets_stub,
    fallbackEvents: [...telemetry.fallbackEvents],
    invalidEvents: [...telemetry.invalidEvents],
  };
}

export function resetSetupDisplayModeTelemetry(): void {
  telemetry.git_identity = 0;
  telemetry.workspace_presence = 0;
  telemetry.secrets_stub = 0;
  telemetry.fallbackEvents = [];
  telemetry.invalidEvents = [];
}

export function isSetupDisplayMode(value: unknown): value is SetupDisplayMode {
  return value === "ready" || value === "action-required" || value === "informational";
}

export function resolveSetupDisplayFact(
  panel: SetupDisplayPanel,
  fact: SetupDisplayFact | undefined,
  fallbackFactory: () => SetupDisplayFact,
): SetupDisplayFact | null {
  if (!fact) {
    recordFallback(panel);
    return fallbackFactory();
  }
  if (!isSetupDisplayMode(fact.mode)) {
    recordInvalid(panel, String(fact.mode));
    return null;
  }
  return fact;
}

export function fallbackGitIdentityDisplayFact(readiness: GitReadiness | null): SetupDisplayFact {
  if (!readiness) {
    return {
      mode: "informational",
      detail: "Git readiness is unavailable.",
      freshness: {
        strategy: "per_request",
        invalidatedBy: ["setup_recheck", "workspace_changed"],
      },
    };
  }
  return {
    mode: readiness.git.installed && !readiness.workflowBlocked ? "ready" : "action-required",
    detail: readiness.blocker?.message ?? "Git identity is ready.",
    freshness: {
      strategy: "per_request",
      invalidatedBy: ["setup_recheck", "workspace_changed", "git_identity_saved", "workspace_git_identity_repaired"],
    },
  };
}

export function fallbackWorkspacePresenceDisplayFact(configView: AppConfigView | null | undefined): SetupDisplayFact {
  if (!configView?.workspace?.id) {
    return {
      mode: "informational",
      detail: "No workspace is selected yet. Setup can continue with app-level defaults until a workspace is opened.",
      freshness: {
        strategy: "per_request",
        invalidatedBy: ["setup_recheck", "workspace_changed"],
      },
    };
  }
  return {
    mode: "action-required",
    detail: `Workspace ${configView.workspace.key} needs a fresh engine check before repo-local readiness can run.`,
    freshness: {
      strategy: "per_request",
      invalidatedBy: ["setup_recheck", "workspace_changed"],
    },
  };
}

export function fallbackSecretsStubDisplayFact(configView: AppConfigView | null | undefined): SetupDisplayFact {
  const apiKeyRef = configView?.config.llm.apiKey.ref ?? "ANTHROPIC_API_KEY";
  const setupState = configView?.setupState ?? "uninitialized";
  if (setupState === "uninitialized") {
    return {
      mode: "informational",
      detail: "Initialize app state before managing workflow secrets.",
      freshness: {
        strategy: "per_request",
        invalidatedBy: ["setup_recheck", "secret_metadata_changed"],
      },
    };
  }
  return {
    mode: configView?.config.llm.apiKey.present ? "ready" : "action-required",
    detail: configView?.config.llm.apiKey.present
      ? `${apiKeyRef} is already available for workflow runs.`
      : `Add ${apiKeyRef} before starting workflow runs.`,
    freshness: {
      strategy: "per_request",
      invalidatedBy: ["setup_recheck", "secret_metadata_changed"],
    },
  };
}

export function workspaceScopedGitReadinessId(configView: AppConfigView | null | undefined): string | undefined {
  const mode = configView?.setupDisplayModes?.workspacePresence?.mode;
  if (mode === "ready") return configView?.workspace?.id;
  if (isSetupDisplayMode(mode)) return undefined;
  return configView?.workspace?.id;
}

type WorkspaceLookup = {
  rootPath?: string | null;
  root_path?: string | null;
};

function usableRootPath(workspace: WorkspaceLookup | null): boolean {
  const rootPath = workspace?.rootPath ?? workspace?.root_path;
  return typeof rootPath === "string" && rootPath.trim().length > 0;
}

export async function resolveWorkspaceScopedGitReadinessId(
  configView: AppConfigView | null | undefined,
  readWorkspace?: (workspaceKey: string) => Promise<WorkspaceLookup | null>,
): Promise<string | undefined> {
  const mode = configView?.setupDisplayModes?.workspacePresence?.mode;
  if (mode === "ready") return configView?.workspace?.id;
  if (isSetupDisplayMode(mode)) return undefined;
  if (!configView?.workspace?.id || !configView.workspace.key || !readWorkspace) return configView?.workspace?.id;
  const workspace = await readWorkspace(configView.workspace.key);
  return usableRootPath(workspace) ? configView.workspace.id : undefined;
}
