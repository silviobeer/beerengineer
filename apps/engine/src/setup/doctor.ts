import { KNOWN_GROUP_IDS, readConfigFile, resolveConfigPath, resolveMergedConfig, resolveOverrides } from "./config.js"
import { runBrowserChecks } from "./checks/browser.js"
import { runCoreChecks } from "./checks/core.js"
import { runGitHubChecks } from "./checks/github.js"
import { gitIdentitySetupChecks } from "./gitIdentity.js"
import { getActiveLlmGroup, runLlmChecks } from "./checks/llm.js"
import { runNotificationChecks } from "./checks/notifications.js"
import { runReviewChecks } from "./checks/review.js"
import { statusIsOk } from "./checks/shared.js"
import { doctorExitCode, printDoctorReport, summarizeOverall } from "./doctorOutput.js"
import { runSetupFlow, type SetupRunOptions } from "./setupFlow.js"
import type { AppConfig, GroupResult, SetupOverrides, SetupReport } from "./types.js"

export type DoctorOptions = {
  group?: string
  overrides?: SetupOverrides
  allLlmGroups?: boolean
}

export type SetupRecheckResult =
  | {
      ok: true
      report: SetupReport
      requiredGate: {
        blocked: boolean
        canProceed: boolean
        blockingGroups: string[]
      }
    }
  | {
      ok: false
      error: "unknown_group"
      group: string
      requiredGate: {
        blocked: true
        canProceed: false
        blockingGroups: string[]
      }
    }

type GroupDefinition = {
  id: (typeof KNOWN_GROUP_IDS)[number]
  label: string
  level: GroupResult["level"]
  minOk: number
  idealOk?: number
  active: boolean
  run: () => Promise<GroupResult["checks"]>
}

export async function generateSetupReport(options: DoctorOptions = {}): Promise<SetupReport> {
  const overrides = resolveOverrides(options.overrides)
  const configPath = resolveConfigPath(overrides)
  const configState = readConfigFile(configPath)
  const config = resolveMergedConfig(configState, overrides)
  const llmGroup = getActiveLlmGroup(config)
  const telegramEnabled = config?.notifications?.telegram?.enabled === true
  const llmGate = (id: "llm.anthropic" | "llm.openai" | "llm.opencode"): Pick<GroupDefinition, "level" | "minOk" | "idealOk"> =>
    options.allLlmGroups === true && id !== llmGroup
      ? { level: "optional", minOk: 0, idealOk: 2 }
      : { level: "required", minOk: 2 }

  const groupDefs: GroupDefinition[] = [
    { id: "core", label: "Core app checks", level: "required", minOk: 6, active: true, run: () => runCoreChecks(configPath, configState, config) },
    { id: "git", label: "Git readiness", level: "required", minOk: 1, idealOk: 2, active: true, run: () => Promise.resolve(gitIdentitySetupChecks(config)) },
    { id: "notifications", label: "Notification delivery", level: "optional", minOk: 0, idealOk: telegramEnabled ? 4 : 0, active: true, run: () => runNotificationChecks(config) },
    { id: "vcs.github", label: "GitHub workflows", level: "optional", minOk: 0, idealOk: config?.vcs?.github?.enabled ? 2 : 0, active: true, run: () => runGitHubChecks(Boolean(config?.vcs?.github?.enabled)) },
    { id: "llm.anthropic", label: "Anthropic capability", ...llmGate("llm.anthropic"), active: Boolean(config) && (options.allLlmGroups === true || llmGroup === "llm.anthropic"), run: () => runLlmChecks("anthropic", config as AppConfig) },
    { id: "llm.openai", label: "OpenAI capability", ...llmGate("llm.openai"), active: Boolean(config) && (options.allLlmGroups === true || llmGroup === "llm.openai"), run: () => runLlmChecks("openai", config as AppConfig) },
    { id: "llm.opencode", label: "OpenCode capability", ...llmGate("llm.opencode"), active: Boolean(config) && (options.allLlmGroups === true || llmGroup === "llm.opencode"), run: () => runLlmChecks("opencode", config as AppConfig) },
    { id: "browser-agent", label: "Browser agent capability", level: "optional", minOk: 0, idealOk: config?.browser?.enabled ? 2 : 0, active: true, run: () => runBrowserChecks(Boolean(config?.browser?.enabled)) },
    { id: "supabase", label: "Supabase readiness setup", level: "optional", minOk: 0, idealOk: 0, active: true, run: async () => [] },
    { id: "review", label: "Review tool recommendations", level: "recommended", minOk: 0, idealOk: 3, active: true, run: () => runReviewChecks() },
  ]

  const groups = await Promise.all(
    groupDefs
      .filter(group => group.active && (!options.group || group.id === options.group))
      .map(async group => {
        const checks = await group.run()
        const passed = checks.filter(check => statusIsOk(check.status)).length
        return {
          id: group.id,
          label: group.label,
          level: group.level,
          minOk: group.minOk,
          idealOk: group.idealOk,
          passed,
          satisfied: passed >= group.minOk,
          ideal: passed >= (group.idealOk ?? group.minOk),
          checks,
        } satisfies GroupResult
      }),
  )

  return { reportVersion: 1, overall: summarizeOverall(groups), groups, generatedAt: Date.now() }
}

export async function runDoctorCommand(options: DoctorOptions = {}): Promise<number> {
  const report = await generateSetupReport(options)
  printDoctorReport(report, { installHints: false })
  return doctorExitCode(report)
}

export async function runSetupRecheck(options: DoctorOptions = {}): Promise<SetupRecheckResult> {
  if (options.group && !(KNOWN_GROUP_IDS as readonly string[]).includes(options.group)) {
    return {
      ok: false,
      error: "unknown_group",
      group: options.group,
      requiredGate: { blocked: true, canProceed: false, blockingGroups: [] },
    }
  }
  const report = await generateSetupReport(options)
  const blockingGroups = report.groups
    .filter(group => group.level === "required" && !group.satisfied)
    .map(group => group.id)
  const blocked = blockingGroups.length > 0
  return {
    ok: true,
    report,
    requiredGate: {
      blocked,
      canProceed: !blocked,
      blockingGroups,
    },
  }
}

export async function runSetupCommand(options: SetupRunOptions = {}): Promise<number> {
  return runSetupFlow(options)
}
