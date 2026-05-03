import type { AppConfigView, SetupReport } from "@/lib/setup/types";

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
    config: {
      allowedRoots: ["/work"],
      enginePort: 4100,
      publicBaseUrl: "http://127.0.0.1:4100",
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

export function uninitializedConfigView(): AppConfigView {
  const view = configView();
  return {
    ...view,
    setupState: "uninitialized",
    configFile: { kind: "missing", path: view.configPath },
  };
}
