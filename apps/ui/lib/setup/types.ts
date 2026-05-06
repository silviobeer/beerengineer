export type SetupStatus =
  | "ok"
  | "missing"
  | "misconfigured"
  | "skipped"
  | "unknown"
  | "uninitialized"
  | "checking";

export type SetupLevel = "required" | "recommended" | "optional";

export interface SetupRemedy {
  hint?: string;
  command?: string;
  url?: string;
}

export interface SetupCheck {
  id: string;
  label: string;
  status: SetupStatus;
  version?: string;
  detail?: string;
  remedy?: SetupRemedy;
}

export interface SetupGroup {
  id: string;
  label: string;
  level: SetupLevel;
  minOk: number;
  idealOk?: number;
  passed: number;
  satisfied: boolean;
  ideal: boolean;
  checks: SetupCheck[];
}

export interface SetupReport {
  reportVersion: 1;
  overall: "ok" | "warning" | "blocked";
  groups: SetupGroup[];
  generatedAt: number;
}

export interface GitIdentityDefault {
  displayName: string;
  email: string;
  localOnly: boolean;
}

export interface GitIdentityValue {
  name?: string;
  email?: string;
}

export interface EffectiveGitIdentity {
  source: "repo-local" | "global" | "app-default";
  name: string;
  email: string;
  localOnly?: boolean;
}

export interface GitIdentityBlocker {
  error: string;
  message: string;
}

export interface GlobalGitReadiness {
  mode: "global";
  git: {
    installed: boolean;
    version?: string;
  };
  globalIdentity: GitIdentityValue;
  appDefaultIdentity?: GitIdentityDefault;
  effectiveIdentity?: EffectiveGitIdentity;
  setupBlocked: boolean;
  workflowBlocked: boolean;
  availableActions: Array<"save_app_default">;
  blocker?: GitIdentityBlocker;
}

export interface WorkspaceGitReadiness {
  mode: "workspace";
  workspace: {
    id: string;
    key?: string;
  };
  git: GlobalGitReadiness["git"];
  isGitRepo: boolean;
  repoLocalIdentity: GitIdentityValue;
  globalIdentity: GitIdentityValue;
  appDefaultIdentity?: GitIdentityDefault;
  effectiveIdentity?: EffectiveGitIdentity;
  ready: boolean;
  setupBlocked: boolean;
  workflowBlocked: boolean;
  availableActions: Array<"repair_workspace_identity">;
  blocker?: GitIdentityBlocker;
}

export type GitReadiness = GlobalGitReadiness | WorkspaceGitReadiness;

export interface GitIdentityValidationError {
  field: "displayName" | "email";
  message: string;
}

export interface GitIdentityValidationResponse {
  ok: false;
  error: "identity_invalid";
  errors: GitIdentityValidationError[];
}

export interface WorkspaceGitRepairResponse {
  ok: boolean;
  error?: string;
  message?: string;
  validation?: GitIdentityValidationResponse;
  actions?: string[];
  readiness?: WorkspaceGitReadiness;
}

export interface SecretRefView {
  ref: string;
  present: boolean;
}

export interface AppConfigView {
  setupState: "uninitialized" | "partial" | "complete";
  configPath: string;
  configFile: { kind: "ok" | "missing" | "invalid"; path: string; error?: string };
  workspace?: { id: string; key: string; name: string } | null;
  supabase: {
    workspaceId?: string;
    projectRef?: string;
    region?: string;
    persistentTestBranchName?: string;
    persistentTestBranchRef?: string;
    persistentTestBranchStatus?: string;
    lastCheckedAt?: number;
    tokenPresent: boolean;
    branchGranularity: "wave";
    cleanupPolicy: "on-success-immediate" | "ttl-after-success" | "manual";
    cleanupTtlHours?: number;
    productionMigrationProtection: "off" | "on";
    settingsVersion: number;
    costRisk: {
      retainedBranchCount: number;
      planLimitRatio: number;
    };
  };
  config: {
    allowedRoots: string[];
    enginePort: number;
    publicBaseUrl?: string;
    gitIdentityDefault?: GitIdentityDefault;
    llm: {
      provider: "anthropic" | "openai" | "opencode";
      model: string;
      defaultHarnessProfile: { mode?: string; [key: string]: unknown };
      defaultSonarOrganization?: string;
      apiKey: SecretRefView;
    };
    vcs: { github: { enabled: boolean } };
    browser: { enabled: boolean };
    notifications: {
      telegram: {
        enabled: boolean;
        level: 0 | 1 | 2;
        defaultChatId?: string;
        botToken?: SecretRefView;
        inbound: {
          enabled: boolean;
          webhookSecret?: SecretRefView;
        };
      };
    };
  };
}

export type SupabaseReadinessSetupAction =
  | "Store management token"
  | "Connect Supabase project"
  | "Create persistent test branch"
  | "Rotate management token"
  | "Re-authorize project access";

export interface SupabaseReadinessSnapshot {
  status: "ready" | "blocked" | "checking" | "error";
  missingSetupActions: SupabaseReadinessSetupAction[];
  retry: { available: boolean; runId?: string };
  workspace: {
    id?: string;
    key?: string;
    projectRef?: string;
    persistentTestBranchRef?: string;
    persistentTestBranchName?: string;
  };
  branch?: {
    ref?: string;
    status: "active_healthy" | "missing" | "timeout" | "provider_error" | "unauthorized" | "degraded" | "unknown";
    providerStatus?: string;
  };
  message?: string;
}

export interface AppConfigPatchResult {
  ok: boolean;
  saved: string[];
  rejected: Array<{ field: string; error: string }>;
  config: Record<string, unknown>;
}

export interface SecretMetadata {
  ref: string;
  status: "missing" | "active" | "disabled" | "invalid" | "suspicious" | "unknown";
  present: boolean;
  active: boolean;
  updatedAt?: number;
  lastTestedAt?: number;
  source?: string;
}

export const SETUP_STEP_LABELS = ["Core", "LLM", "Git", "Optional services", "Finish"] as const;

export type WizardStepState = "done" | "current" | "blocked" | "checking" | "locked" | "finished";

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    ok: "done",
    missing: "blocked",
    misconfigured: "blocked",
    skipped: "skipped",
    unknown: "unknown",
    uninitialized: "blocked",
    checking: "checking",
    recommended: "recommended",
    active: "configured",
    disabled: "disabled",
    invalid: "invalid",
    suspicious: "suspicious",
  };
  return labels[status] ?? status;
}

export function firstBlockingGroup(report: SetupReport | null): SetupGroup | null {
  if (!report) return null;
  return report.groups.find((group) => group.level === "required" && !group.satisfied) ?? null;
}

export function currentSetupGroup(report: SetupReport | null): SetupGroup | null {
  if (!report) return null;
  return firstBlockingGroup(report) ?? report.groups.find((group) => !group.ideal) ?? report.groups.at(-1) ?? null;
}

export function deriveCurrentStep(report: SetupReport | null): number {
  if (!report) return 1;
  const group = currentSetupGroup(report);
  if (!group) return SETUP_STEP_LABELS.length;
  if (group.id.includes("llm")) return 2;
  if (group.id.includes("git") || group.id.includes("vcs")) return 3;
  if (group.level === "optional" || group.id.includes("telegram") || group.id.includes("sonar")) return 4;
  if (report.overall === "ok") return 5;
  return 1;
}

export function groupPrimaryCheck(group: SetupGroup | null): SetupCheck | null {
  if (!group) return null;
  return group.checks.find((check) => check.status !== "ok" && check.status !== "skipped") ?? group.checks[0] ?? null;
}
