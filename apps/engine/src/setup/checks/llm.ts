import type { AppConfig, CheckResult } from "../types.js"
import { initDatabase } from "../../db/connection.js"
import { Repos } from "../../db/repositories.js"
import {
  type CodexSandboxCapability,
  type CodexSandboxStatus,
  type CodexSandboxCapabilitySnapshot,
  markCodexSandboxCapabilitySupported,
  markCodexSandboxCapabilityUnknown,
  markCodexSandboxCapabilityUnsupported,
  parseCodexSandboxBypassOverride,
  projectCodexSandboxStatus,
  readCodexSandboxCapabilitySnapshot,
  recheckCodexSandboxCapability,
} from "../../llm/hosted/providers/codexSandboxPolicy.js"
import { resolveConfiguredDbPath } from "../config.js"
import { createCheck, probeCommand, remedyForTool } from "./shared.js"

type RunLlmChecksOptions = {
  freshCodexSandboxCapabilityCheck?: boolean
  codexSandboxStatus?: ResolvedCodexSandboxStatus
}

type ResolvedCodexSandboxStatus = {
  snapshot: CodexSandboxCapabilitySnapshot
  status: CodexSandboxStatus
}

export function getActiveLlmGroup(config: AppConfig | null): string | null {
  return config ? `llm.${config.llm.provider}` : null
}

export async function runLlmChecks(
  provider: AppConfig["llm"]["provider"],
  config: AppConfig,
  options: RunLlmChecksOptions = {},
): Promise<CheckResult[]> {
  const defs = {
    anthropic: {
      cliId: "llm.anthropic.cli",
      authId: "llm.anthropic.auth",
      label: "Anthropic / Claude Code",
      command: "claude",
      apiKeyRef: config.llm.apiKeyRef || "ANTHROPIC_API_KEY",
    },
    openai: {
      cliId: "llm.openai.cli",
      authId: "llm.openai.auth",
      label: "OpenAI / Codex",
      command: "codex",
      apiKeyRef: config.llm.apiKeyRef || "OPENAI_API_KEY",
    },
    opencode: {
      cliId: "llm.opencode.cli",
      authId: "llm.opencode.auth",
      label: "OpenCode",
      command: "opencode",
      apiKeyRef: config.llm.apiKeyRef || "OPENCODE_API_KEY",
    },
  } as const
  const def = defs[provider]
  const cli = await probeCommand(def.command, ["--version"])
  const cliCheck = createCheck(def.cliId, `${def.label} CLI`, cli.ok ? "ok" : "missing", cli.version ?? cli.detail, {
    remedy: cli.ok ? undefined : remedyForTool(def.command),
  })
  if (!cli.ok) {
    return [
      cliCheck,
      createCheck(def.authId, `${def.label} auth`, "skipped", `${def.command} CLI is not available`),
      ...(provider === "openai"
        ? [await runCodexSandboxCheck(config, options)]
        : []),
    ]
  }
  if (provider === "anthropic") return runClaudeChecks(def.apiKeyRef, cliCheck)
  if (provider === "openai") return runCodexChecks(def.apiKeyRef, cliCheck, config, options)

  const present = Boolean(process.env[def.apiKeyRef])
  return [
    cliCheck,
    createCheck(
      def.authId,
      `${def.label} auth`,
      present ? "ok" : "missing",
      present ? `${def.apiKeyRef} is set` : `${def.apiKeyRef} is not set`,
      present ? {} : { remedy: { hint: `Export ${def.apiKeyRef} before running beerengineer_.` } },
    ),
  ]
}

async function runCodexChecks(
  apiKeyRef: string,
  cliCheck: CheckResult,
  config: AppConfig,
  options: RunLlmChecksOptions,
): Promise<CheckResult[]> {
  const sandboxCheck = await runCodexSandboxCheck(config, options)
  if (process.env[apiKeyRef]) {
    return [cliCheck, createCheck("llm.openai.auth", "OpenAI / Codex auth", "ok", `${apiKeyRef} is set`), sandboxCheck]
  }

  const auth = await probeCommand("codex", ["login", "status"])
  if (auth.ok) {
    const detail = (auth.stdout ?? auth.version ?? "Codex auth available").split(/\r?\n/)[0]
    return [cliCheck, createCheck("llm.openai.auth", "OpenAI / Codex auth", "ok", detail), sandboxCheck]
  }
  return [
    cliCheck,
    createCheck(
      "llm.openai.auth",
      "OpenAI / Codex auth",
      "missing",
      "Codex is not logged in and OPENAI_API_KEY is not set",
      { remedy: { hint: "Run `codex login`, or export OPENAI_API_KEY before running beerengineer_." } },
    ),
    sandboxCheck,
  ]
}

function syncCodexSandboxCapability(capability: CodexSandboxCapability): void {
  if (capability === "supported") {
    markCodexSandboxCapabilitySupported()
    return
  }
  if (capability === "unsupported") {
    markCodexSandboxCapabilityUnsupported()
    return
  }
  markCodexSandboxCapabilityUnknown()
}

function buildCodexSandboxCheck(
  input: ResolvedCodexSandboxStatus,
): CheckResult {
  const { snapshot, status } = input
  const override = parseCodexSandboxBypassOverride(process.env)
  if (override !== null) {
    const stored = snapshot.state === "known" ? snapshot.capability : snapshot.state
    return createCheck(
      "llm.openai.sandbox",
      "OpenAI / Codex sandbox",
      "ok",
      `${override ? "Bypass forced on" : "Bypass forced off"} via BEERENGINEER_CODEX_SANDBOX_BYPASS; stored capability is ${stored}.`,
    )
  }

  if (snapshot.state === "known") {
    if (status.state === "supported_using_bwrap") {
      return createCheck("llm.openai.sandbox", "OpenAI / Codex sandbox", "ok", "Bubblewrap sandbox supported for Codex tool runs.")
    }
    if (status.state === "unsupported_bypassing") {
      return createCheck("llm.openai.sandbox", "OpenAI / Codex sandbox", "missing", "Bubblewrap sandbox unsupported on this host; Codex tool runs will bypass sandboxing until rechecked.")
    }
    return createCheck("llm.openai.sandbox", "OpenAI / Codex sandbox", "unknown", "Bubblewrap sandbox capability is inconclusive; Codex tool runs will bypass sandboxing until rechecked.")
  }

  if (snapshot.state === "invalid") {
    return createCheck("llm.openai.sandbox", "OpenAI / Codex sandbox", "unknown", "Stored Codex sandbox capability state is invalid; the next Codex tool run will safely re-evaluate it.")
  }

  return createCheck("llm.openai.sandbox", "OpenAI / Codex sandbox", "unknown", "Codex sandbox capability has not been detected yet.")
}

export async function resolveCodexSandboxStatus(
  config: AppConfig,
  options: RunLlmChecksOptions = {},
): Promise<ResolvedCodexSandboxStatus> {
  const db = initDatabase(resolveConfiguredDbPath(config))
  const repos = new Repos(db)
  const store = {
    load: () => repos.getCodexSandboxCapabilitySnapshot()?.capability ?? null,
    persist: (capability: "supported" | "unsupported" | "unknown") => {
      repos.setCodexSandboxCapabilitySnapshot(capability)
    },
  }

  try {
    const capability = options.freshCodexSandboxCapabilityCheck
      ? await recheckCodexSandboxCapability(store)
      : undefined
    const snapshot: CodexSandboxCapabilitySnapshot = capability === undefined
      ? readCodexSandboxCapabilitySnapshot(store)
      : { state: "known", capability }

    if (snapshot.state === "known") {
      syncCodexSandboxCapability(snapshot.capability)
    }
    return {
      snapshot,
      status: projectCodexSandboxStatus(snapshot),
    }
  } finally {
    db.close()
  }
}

async function runCodexSandboxCheck(
  config: AppConfig,
  options: RunLlmChecksOptions,
): Promise<CheckResult> {
  const state = options.codexSandboxStatus ?? await resolveCodexSandboxStatus(config, options)
  return buildCodexSandboxCheck(state)
}

async function runClaudeChecks(apiKeyRef: string, cliCheck: CheckResult): Promise<CheckResult[]> {
  if (process.env[apiKeyRef]) {
    return [cliCheck, createCheck("llm.anthropic.auth", "Anthropic / Claude Code auth", "ok", `${apiKeyRef} is set`)]
  }

  const auth = await probeCommand("claude", ["auth", "status"])
  if (!auth.ok) {
    return [
      cliCheck,
      createCheck(
        "llm.anthropic.auth",
        "Anthropic / Claude Code auth",
        "missing",
        "Claude Code is not logged in and ANTHROPIC_API_KEY is not set",
        { remedy: { hint: "Run `claude`, complete `/login`, or export ANTHROPIC_API_KEY before running beerengineer_." } },
      ),
    ]
  }

  try {
    const parsed = JSON.parse(auth.stdout ?? auth.version ?? "{}") as {
      loggedIn?: boolean
      authMethod?: string
      subscriptionType?: string
    }
    if (parsed.loggedIn) {
      const via = parsed.authMethod ? ` via ${parsed.authMethod}` : ""
      const plan = parsed.subscriptionType ? ` (${parsed.subscriptionType})` : ""
      return [cliCheck, createCheck("llm.anthropic.auth", "Anthropic / Claude Code auth", "ok", `Logged in${via}${plan}`)]
    }
  } catch {
    // Fall through to a generic success detail when the CLI output is not JSON.
  }

  return [cliCheck, createCheck("llm.anthropic.auth", "Anthropic / Claude Code auth", "ok", auth.version ?? "Claude Code auth available")]
}
