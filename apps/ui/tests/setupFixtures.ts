import type { AppConfigView, GitReadiness, SetupDisplayFact, SetupDisplayMode, SetupReport, WorkspaceGitReadiness } from "@/lib/setup/types";

function displayFact(mode: SetupDisplayMode, detail: string, invalidatedBy: string[]): SetupDisplayFact {
  return {
    mode,
    detail,
    freshness: {
      strategy: "per_request",
      invalidatedBy,
    },
  };
}

export function blockedReport(): SetupReport {
  return {
    reportVersion: 1,
    overall: "blocked",
    generatedAt: Date.now(),
    groups: [
      {
        id: "core",
        label: "Core tools",
        level: "required",
        minOk: 1,
        idealOk: 1,
        passed: 1,
        satisfied: true,
        ideal: true,
        checks: [{ id: "node", label: "Node.js", status: "ok" }],
      },
      {
        id: "git",
        label: "Git",
        level: "required",
        minOk: 1,
        idealOk: 1,
        passed: 0,
        satisfied: false,
        ideal: false,
        checks: [
          {
            id: "git",
            label: "Git binary",
            status: "missing",
            detail: "Git is required for real worktrees.",
            remedy: { hint: "Install Git manually.", command: "brew install git", url: "https://git-scm.com" },
          },
        ],
      },
      {
        id: "telegram",
        label: "Telegram",
        level: "optional",
        minOk: 0,
        idealOk: 1,
        passed: 0,
        satisfied: true,
        ideal: false,
        checks: [{ id: "telegram-token", label: "Telegram token", status: "skipped" }],
      },
    ],
  };
}

export function readyReport(): SetupReport {
  const report = blockedReport();
  return {
    ...report,
    overall: "ok",
    groups: report.groups.map((group) => ({
      ...group,
      passed: group.minOk,
      satisfied: true,
      ideal: true,
      checks: group.checks.map((check) => ({ ...check, status: "ok" })),
    })),
  };
}

export function recommendedReport(): SetupReport {
  const report = readyReport();
  return {
    ...report,
    overall: "warning",
    groups: [
      ...report.groups,
      {
        id: "review",
        label: "Review tool recommendations",
        level: "recommended",
        minOk: 0,
        idealOk: 1,
        passed: 0,
        satisfied: true,
        ideal: false,
        checks: [{ id: "coderabbit", label: "CodeRabbit", status: "missing", detail: "CodeRabbit CLI is not installed." }],
      },
    ],
  };
}

export function idealRecommendedReport(): SetupReport {
  const report = recommendedReport();
  return {
    ...report,
    groups: report.groups.map((group) =>
      group.id === "review"
        ? {
            ...group,
            ideal: true,
            idealOk: 3,
            passed: 3,
            checks: [
              { id: "review.coderabbit", label: "CodeRabbit CLI", status: "ok", detail: "0.4.4" },
              { id: "review.sonar-scanner", label: "sonar-scanner", status: "ok", detail: "4.3.6" },
              { id: "review.sonarqube-cli", label: "sonarqube-cli", status: "ok", detail: "0.9.0" },
              { id: "review.sonar-token", label: "SONAR_TOKEN", status: "missing", detail: "Missing SONAR_TOKEN." },
              { id: "review.sonar-plan", label: "Sonar branch-analysis plan tier", status: "unknown", detail: "Branch analysis requires a paid plan." },
            ],
          }
        : group,
    ),
  };
}

export function optionalReport(): SetupReport {
  const report = readyReport();
  return {
    ...report,
    overall: "warning",
    groups: report.groups.map((group) =>
      group.id === "telegram"
        ? {
            ...group,
            level: "optional",
            ideal: false,
            checks: [{ id: "telegram-token", label: "Telegram token", status: "skipped" }],
          }
        : group,
    ),
  };
}

export function configView(): AppConfigView {
  return {
    setupState: "complete",
    configPath: "/tmp/beerengineer/config.json",
    configFile: { kind: "ok", path: "/tmp/beerengineer/config.json" },
    workspace: { id: "ws-1", key: "demo", name: "Demo" },
    setupDisplayModes: {
      workspacePresence: displayFact("ready", "Workspace demo is available for repo-local readiness checks.", ["setup_recheck", "workspace_changed"]),
      secretsStub: displayFact("ready", "ANTHROPIC_API_KEY is already available for workflow runs.", ["setup_recheck", "secret_metadata_changed"]),
    },
    supabase: {
      workspaceId: "ws-1",
      projectRef: "proj_1",
      region: "eu",
      dbMode: "branching",
      persistentTestBranchName: "beerengineer-demo-persistent-test",
      persistentTestBranchRef: "br_test",
      persistentTestBranchStatus: "ACTIVE_HEALTHY",
      lastCheckedAt: 1_777_777_777_000,
      tokenPresent: true,
      branchGranularity: "wave",
      cleanupPolicy: "on-success-immediate",
      productionMigrationProtection: "off",
      settingsVersion: 1,
      costRisk: { retainedBranchCount: 0, planLimitRatio: 0 },
    },
    config: {
      allowedRoots: ["/work"],
      enginePort: 4100,
      publicBaseUrl: "http://127.0.0.1:4100",
      gitIdentityDefault: undefined,
      llm: {
        provider: "anthropic",
        model: "claude-sonnet",
        defaultHarnessProfile: { mode: "claude-first" },
        defaultSonarOrganization: "beer",
        apiKey: { ref: "ANTHROPIC_API_KEY", present: true },
      },
      vcs: { github: { enabled: true } },
      browser: { enabled: true },
      notifications: {
        telegram: {
          enabled: false,
          level: 2,
          botToken: { ref: "TELEGRAM_BOT_TOKEN", present: false },
          inbound: { enabled: false },
        },
      },
    },
  };
}

export function globalGitReadiness(overrides: Partial<GitReadiness> = {}): GitReadiness {
  const readiness: GitReadiness = {
    mode: "global",
    displayMode: displayFact("action-required", "Git identity is missing.", ["setup_recheck", "workspace_changed", "git_identity_saved"]),
    git: { installed: true, version: "git version 2.47.0" },
    globalIdentity: {},
    appDefaultIdentity: undefined,
    effectiveIdentity: undefined,
    setupBlocked: false,
    workflowBlocked: true,
    availableActions: ["save_app_default"],
    blocker: { error: "identity_missing", message: "Git identity is missing." },
    ...overrides,
  } as GitReadiness;
  if (!("displayMode" in overrides)) {
    readiness.displayMode = displayFact(
      readiness.git.installed && !readiness.workflowBlocked ? "ready" : "action-required",
      readiness.blocker?.message ?? "Git identity is ready.",
      ["setup_recheck", "workspace_changed", "git_identity_saved"],
    );
  }
  return readiness;
}

export function missingGitReadiness(): GitReadiness {
  return globalGitReadiness({
    displayMode: displayFact("action-required", "Git is not installed or not available on PATH.", ["setup_recheck", "workspace_changed", "git_identity_saved"]),
    git: { installed: false },
    setupBlocked: true,
    workflowBlocked: true,
    blocker: { error: "git_not_installed", message: "Git is not installed or not available on PATH." },
  });
}

export function workspaceGitReadiness(overrides: Partial<WorkspaceGitReadiness> = {}): WorkspaceGitReadiness {
  const readiness: WorkspaceGitReadiness = {
    mode: "workspace",
    displayMode: displayFact("action-required", "Git identity is missing for this workspace.", ["setup_recheck", "workspace_changed", "workspace_git_identity_repaired"]),
    workspace: { id: "ws-1", key: "demo" },
    git: { installed: true, version: "git version 2.47.0" },
    isGitRepo: true,
    repoLocalIdentity: {},
    globalIdentity: {},
    appDefaultIdentity: { displayName: "Beer Engineer", email: "beer@local.beerengineer", localOnly: true },
    effectiveIdentity: undefined,
    ready: false,
    setupBlocked: false,
    workflowBlocked: true,
    availableActions: ["repair_workspace_identity"],
    blocker: { error: "identity_missing", message: "Git identity is missing for this workspace." },
    ...overrides,
  };
  if (!("displayMode" in overrides)) {
    readiness.displayMode = displayFact(
      readiness.git.installed && !readiness.workflowBlocked ? "ready" : "action-required",
      readiness.blocker?.message ?? "Git identity is ready.",
      ["setup_recheck", "workspace_changed", "workspace_git_identity_repaired"],
    );
  }
  return readiness;
}

export function uninitializedConfigView(): AppConfigView {
  const view = configView();
  return {
    ...view,
    setupState: "uninitialized",
    configFile: { kind: "missing", path: view.configPath },
  };
}
