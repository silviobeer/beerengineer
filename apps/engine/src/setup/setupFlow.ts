import { createInterface, type Interface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import {
  normalizePublicBaseUrl,
  readConfigFile,
  resolveConfigPath,
  resolveMergedConfig,
  resolveOverrides,
  writeConfigFile,
} from "./config.js"
import { doctorExitCode, printDoctorReport } from "./doctorOutput.js"
import { generateSetupReport } from "./doctor.js"
import { initializeAppState } from "./appState.js"
import type { AppConfig, SetupOverrides, SetupReport } from "./types.js"
import { launchSetupExperience, type SetupLaunchResult } from "../cli/ui.js"
import { readGlobalGitReadiness, validateGitIdentityInput, type GitCommandOptions, type GitIdentityValidationResult } from "./gitIdentity.js"

export type SetupRunOptions = {
  group?: string
  overrides?: SetupOverrides
  allLlmGroups?: boolean
  noInteractive?: boolean
  deps?: SetupFlowDeps
}

export type SetupQuestioner = {
  question(prompt: string): Promise<string>
  close(): void
}

export type SetupFlowDeps = {
  isInteractive?: () => boolean
  launchSetup?: (config: AppConfig) => Promise<SetupLaunchResult>
  createQuestioner?: () => SetupQuestioner
  gitCommandOptions?: GitCommandOptions
}

export function needsInitialization(report: SetupReport): boolean {
  return report.groups.some(group => group.id === "core" && group.checks.some(check => check.status === "uninitialized"))
}

export async function runSetupFlow(options: SetupRunOptions = {}): Promise<number> {
  const resolved = resolveOverrides(options.overrides)
  const configPath = resolveConfigPath(resolved)
  let report = await refreshSetupReport(options)

  if (needsInitialization(report)) {
    const initialized = initializeProvisionedState(options.overrides)
    if (!initialized.ok) return 1
    console.log("  App setup initialized config, data dir, and database.")
    report = await refreshSetupReport(options)
  }

  const interactive = !options.noInteractive && (options.deps?.isInteractive?.() ?? Boolean(process.stdin.isTTY && process.stdout.isTTY))
  let launch: SetupLaunchResult | undefined
  const provisionedConfig = interactive ? tryBuildProvisionedConfig(resolved) : null
  if (interactive && provisionedConfig) {
    const config = provisionedConfig
    launch = await launchInteractiveSetup(config, options.deps)
  }

  if (interactive && provisionedConfig && shouldOfferGitIdentityPrompt(options, launch)) {
    await maybeConfigureGitIdentityInteractive(configPath, provisionedConfig, options.deps)
    report = await refreshSetupReport(options)
  }

  if (interactive && provisionedConfig && options.group === "notifications") {
    await maybeConfigureTelegramInteractive(configPath, provisionedConfig)
    report = await refreshSetupReport(options)
  }

  while (interactive && report.overall === "blocked") {
    const requiredSatisfied = report.groups.filter(group => group.level === "required").every(group => group.satisfied)
    const action = await promptRetryAction(requiredSatisfied)
    if (action === "quit") return doctorExitCode(report)
    if (action === "skip") break
    const next = await generateSetupReport(options)
    diffPrint(report, next)
    report = next
  }

  if (report.overall !== "blocked") console.log("  Next: beerengineer workspace add <path>")
  return doctorExitCode(report)
}

async function launchInteractiveSetup(config: AppConfig, deps: SetupFlowDeps | undefined): Promise<SetupLaunchResult> {
  const launch = await (deps?.launchSetup ?? launchSetupExperience)(config)
  console.log("")
  console.log(`  Engine API: ${formatServiceStatus(launch.engine.status)} at ${launch.engine.url}`)
  if (launch.engine.detail) console.log(`    hint: ${launch.engine.detail}`)
  console.log(`  Setup UI: ${formatServiceStatus(launch.ui.status)} at ${launch.ui.url}`)
  if (launch.ui.detail) console.log(`    hint: ${launch.ui.detail}`)
  if (launch.browser.status === "opened") {
    console.log(`  Opened setup UI: ${launch.setupUrl}`)
  } else {
    console.log(`  Setup UI URL: ${launch.setupUrl}`)
    if (launch.browser.detail) console.log(`    hint: ${launch.browser.detail}`)
  }
  console.log("")
  return launch
}

function formatServiceStatus(status: SetupLaunchResult["engine"]["status"]): string {
  switch (status) {
    case "running":
      return "already running"
    case "started":
      return "started"
    case "unavailable":
      return "unavailable"
  }
}

function shouldOfferGitIdentityPrompt(options: SetupRunOptions, launch: SetupLaunchResult | undefined): boolean {
  if (options.group === "git") return true
  if (options.group) return false
  return launch?.browser.status === "printed"
}

function buildProvisionedConfig(overrides: SetupOverrides = {}): AppConfig {
  const resolved = resolveOverrides(overrides)
  const state = readConfigFile(resolveConfigPath(resolved))
  if (state.kind === "invalid") throw new Error(`config at ${state.path} is invalid: ${state.error}`)
  return resolveMergedConfig(state, resolved) as AppConfig
}

function tryBuildProvisionedConfig(overrides: SetupOverrides = {}): AppConfig | null {
  try {
    return buildProvisionedConfig(overrides)
  } catch (err) {
    console.error(`  Setup launch skipped: ${(err as Error).message}`)
    return null
  }
}

function initializeProvisionedState(overrides: SetupOverrides | undefined): { ok: true } | { ok: false } {
  const result = initializeAppState(overrides)
  if (!result.ok) {
    console.error(`  Refusing to overwrite invalid config at ${result.configPath}: ${result.error}`)
    console.error("  Fix the file by hand or remove it, then re-run `beerengineer setup`.")
    return { ok: false }
  }
  return { ok: true }
}

async function refreshSetupReport(options: SetupRunOptions): Promise<SetupReport> {
  const report = await generateSetupReport(options)
  printDoctorReport(report, { installHints: true })
  return report
}

async function promptRetryAction(requiredSatisfied: boolean): Promise<"retry-failed" | "retry-all" | "skip" | "quit"> {
  const rl = createInterface({ input, output })
  try {
    const answer = (await rl.question("  [r] retry failed  [a] retry all  [s] skip & continue  [q] quit: ")).trim().toLowerCase()
    if (answer === "r") return "retry-failed"
    if (answer === "a") return "retry-all"
    if (answer === "q") return "quit"
    if (answer === "s" && !requiredSatisfied) {
      const confirm = (await rl.question("  You haven't met a required minimum. Continue anyway? [y/N] ")).trim().toLowerCase()
      return confirm === "y" ? "skip" : "retry-failed"
    }
    return "skip"
  } finally {
    rl.close()
  }
}

export async function maybeConfigureGitIdentityInteractive(configPath: string, config: AppConfig, deps: SetupFlowDeps = {}): Promise<AppConfig> {
  const readiness = readGlobalGitReadiness(config, deps.gitCommandOptions)
  const questioner = deps.createQuestioner?.() ?? createInterface({ input, output })
  try {
    const existing = config.gitIdentityDefault
    const defaults = {
      displayName: existing?.displayName ?? readiness.globalIdentity.name ?? "",
      email: existing?.email ?? readiness.globalIdentity.email ?? "",
    }
    console.log("")
    console.log("  Git identity lets beerengineer_ create local workflow checkpoints.")
    console.log("  Existing repo-local or global Git identity remains unchanged.")
    const defaultChoice = existing ? "n" : "y"
    const configure = (await questioner.question(`  Save beerengineer_ app-level Git identity? [${existing ? "y/N" : "Y/n"}] `)).trim().toLowerCase()
    if (configure === "n" || configure === "no" || (configure === "" && defaultChoice === "n")) return config

    while (true) {
      const displayName = (await questioner.question(`  Display name [${defaults.displayName}]: `)).trim() || defaults.displayName
      const email = (await questioner.question(`  Email [${defaults.email}]: `)).trim() || defaults.email
      const validation = validateGitIdentityInput({ displayName, email })
      if (!validation.ok) {
        printGitIdentityValidation(validation)
        const again = (await questioner.question("  Try again? [Y/n] ")).trim().toLowerCase()
        if (again === "n" || again === "no") return config
        continue
      }

      const next: AppConfig = {
        ...config,
        gitIdentityDefault: {
          displayName: validation.identity.displayName,
          email: validation.identity.email,
          localOnly: validation.identity.localOnly,
        },
      }
      writeConfigFile(configPath, next)
      const saved = readConfigFile(configPath)
      if (saved.kind === "ok") {
        console.log("  Saved beerengineer_ Git identity default.")
        return saved.config
      }
      console.log("  Saved beerengineer_ Git identity default.")
      return next
    }
  } finally {
    questioner.close()
  }
}

function printGitIdentityValidation(validation: Extract<GitIdentityValidationResult, { ok: false }>): void {
  for (const error of validation.errors) {
    console.log(`  ${error.field}: ${error.message}`)
  }
}

function diffPrint(previous: SetupReport, next: SetupReport): void {
  const previousStatuses = new Map(previous.groups.flatMap(group => group.checks.map(check => [check.id, check.status] as const)))
  for (const group of next.groups) {
    for (const check of group.checks) {
      const before = previousStatuses.get(check.id)
      if (before && before !== "ok" && check.status === "ok") console.log(`  + ${check.id} now ok`)
    }
  }
}

async function maybeConfigureTelegramInteractive(configPath: string, config: AppConfig): Promise<AppConfig> {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) return config

  const rl = createInterface({ input, output })
  try {
    console.log("")
    console.log("  Telegram can deliver outbound notifications and optional inbound prompt replies.")
    console.log("  Outbound runs on messaging levels: L2 milestones, L1 operational detail, L0 debug detail.")
    console.log("  Inbound is limited to replying to beerengineer_ prompts when enabled.")
    console.log("")
    console.log("  Setup steps:")
    console.log("    1. Open Telegram and talk to @BotFather.")
    console.log("    2. Create a bot and copy its token.")
    console.log("    3. Put that token in an environment variable.")
    console.log("    4. Start a chat with the bot or add it to a group, then send one message.")
    console.log("    5. Find the target chat id.")
    console.log("    6. Set publicBaseUrl to the Tailscale-reachable UI address, never localhost.")
    console.log("")

    const enabled = ["y", "yes"].includes((await rl.question("  Enable Telegram notifications? [y/N] ")).trim().toLowerCase())
    const next: AppConfig = {
      ...config,
      notifications: {
        telegram: {
          enabled,
          botTokenEnv: config.notifications?.telegram?.botTokenEnv,
          defaultChatId: config.notifications?.telegram?.defaultChatId,
          level: config.notifications?.telegram?.level ?? 2,
          inbound: {
            enabled: config.notifications?.telegram?.inbound?.enabled ?? false,
            webhookSecretEnv: config.notifications?.telegram?.inbound?.webhookSecretEnv,
          },
        },
      },
    }
    const telegram = next.notifications!.telegram!
    if (!enabled) {
      writeConfigFile(configPath, next)
      return next
    }

    next.publicBaseUrl = await promptTelegramPublicBaseUrl(rl, next.publicBaseUrl)
    const tokenEnvAnswer = (await rl.question(`  Telegram bot token env var [${telegram.botTokenEnv ?? "TELEGRAM_BOT_TOKEN"}]: `)).trim()
    next.notifications!.telegram = {
      ...telegram,
      enabled: true,
      botTokenEnv: tokenEnvAnswer || telegram.botTokenEnv || "TELEGRAM_BOT_TOKEN",
    }
    await promptTelegramLevel(rl, next)
    await promptTelegramChatId(rl, next)

    const configuredTelegram = next.notifications?.telegram
    if (!configuredTelegram) throw new Error("Telegram config missing during interactive setup")
    configuredTelegram.inbound = {
      ...configuredTelegram.inbound,
      enabled: await promptTelegramInboundEnabled(rl, configuredTelegram),
    }

    if (configuredTelegram.inbound.enabled) {
      const secretEnvAnswer =
        (await rl.question(`  Telegram webhook secret env var [${configuredTelegram.inbound?.webhookSecretEnv ?? "TELEGRAM_WEBHOOK_SECRET"}]: `)).trim()
      if (!configuredTelegram.inbound) throw new Error("Telegram inbound config missing during interactive setup")
      configuredTelegram.inbound.webhookSecretEnv = secretEnvAnswer || configuredTelegram.inbound.webhookSecretEnv || "TELEGRAM_WEBHOOK_SECRET"
    }

    writeConfigFile(configPath, next)
    console.log("")
    console.log("  Next steps:")
    console.log(`    export ${configuredTelegram.botTokenEnv ?? "TELEGRAM_BOT_TOKEN"}=<telegram-bot-token>`)
    if (configuredTelegram.inbound?.enabled && configuredTelegram.inbound?.webhookSecretEnv) {
      console.log(`    export ${configuredTelegram.inbound.webhookSecretEnv}=<telegram-webhook-secret>`)
    }
    console.log(`    publicBaseUrl is set to ${next.publicBaseUrl}`)
    console.log(`    Telegram level is L${configuredTelegram.level ?? 2}`)
    console.log("    Start the UI on the same host/port so Telegram links stay reachable over Tailscale.")
    console.log("")
    return next
  } finally {
    rl.close()
  }
}

async function promptTelegramPublicBaseUrl(rl: Interface, current: string | undefined): Promise<string> {
  while (true) {
    const defaultUrl = current ?? "https://100.x.y.z:3100"
    const candidate = (await rl.question(`  Public base URL [${defaultUrl}]: `)).trim() || current || defaultUrl
    try {
      return normalizePublicBaseUrl(candidate)
    } catch (err) {
      console.log(`  ${String((err as Error).message)}`)
    }
  }
}

async function promptTelegramLevel(rl: Interface, config: AppConfig): Promise<void> {
  while (true) {
    const configuredTelegram = config.notifications?.telegram
    if (!configuredTelegram) throw new Error("Telegram config missing during interactive setup")
    const currentLevel = configuredTelegram.level ?? 2
    const candidate = (await rl.question(`  Telegram message level [${currentLevel}] (0=debug, 1=ops, 2=milestones): `)).trim() || String(currentLevel)
    if (candidate === "0" || candidate === "1" || candidate === "2") {
      configuredTelegram.level = Number(candidate) as 0 | 1 | 2
      return
    }
    console.log("  Telegram message level must be 0, 1, or 2.")
  }
}

async function promptTelegramChatId(rl: Interface, config: AppConfig): Promise<void> {
  while (true) {
    const currentTelegram = config.notifications?.telegram
    if (!currentTelegram) throw new Error("Telegram config missing during interactive setup")
    const chatId = (await rl.question(`  Telegram chat id [${currentTelegram.defaultChatId ?? ""}]: `)).trim() || currentTelegram.defaultChatId
    if (chatId) {
      currentTelegram.defaultChatId = chatId
      return
    }
    console.log("  Telegram chat id is required when notifications are enabled.")
  }
}

async function promptTelegramInboundEnabled(
  rl: Interface,
  configuredTelegram: NonNullable<NonNullable<AppConfig["notifications"]>["telegram"]>,
): Promise<boolean> {
  const answer = (await rl.question(`  Enable Telegram inbound prompt replies? [${configuredTelegram.inbound?.enabled ? "Y/n" : "y/N"}] `)).trim().toLowerCase()
  return answer === "" ? configuredTelegram.inbound?.enabled === true : answer === "y" || answer === "yes"
}
