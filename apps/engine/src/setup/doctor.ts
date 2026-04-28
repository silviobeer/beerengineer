import Database from "better-sqlite3"
import { spawn } from "node:child_process"
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createInterface, type Interface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { normalizePublicBaseUrl, resolveConfiguredDbPath, resolveConfigPath, resolveMergedConfig, readConfigFile, REQUIRED_MIGRATION_LEVEL, resolveOverrides, writeConfigFile } from "./config.js"
import type { AppConfig, CheckResult, GroupResult, SetupOverrides, SetupReport, SetupStatus } from "./types.js"
import { initDatabase } from "../db/connection.js"
import { Repos } from "../db/repositories.js"
import { createFrontendDesignReview, createFrontendDesignStage, createVisualCompanionReview, createVisualCompanionStage } from "../llm/registry.js"
import { layout } from "../core/workspaceLayout.js"
import { resolveWorkflowContextForRun } from "../core/workflowContextResolver.js"

type ToolProbe = {
  ok: boolean
  version?: string
  detail?: string
  stdout?: string
  stderr?: string
}

type DoctorOptions = {
  group?: string
  overrides?: SetupOverrides
  allLlmGroups?: boolean
}

type SetupRunOptions = DoctorOptions & {
  noInteractive?: boolean
}

type GroupDefinition = {
  id: string
  label: string
  level: GroupResult["level"]
  minOk: number
  idealOk?: number
  active: boolean
  run: () => Promise<CheckResult[]>
}

const TOOL_TIMEOUT_MS = 3_000

function remedyForTool(tool: string): CheckResult["remedy"] | undefined {
  const platform = process.platform
  let ghRemedy: CheckResult["remedy"]
  if (platform === "darwin") {
    ghRemedy = { hint: "Install GitHub CLI with Homebrew.", command: "brew install gh" }
  } else if (platform === "win32") {
    ghRemedy = { hint: "Install GitHub CLI with winget.", command: "winget install GitHub.cli" }
  } else {
    ghRemedy = { hint: "Install GitHub CLI from the official docs.", url: "https://cli.github.com/" }
  }
  const sonarScannerRemedy: CheckResult["remedy"] = platform === "darwin"
    ? { hint: "Install sonar-scanner with Homebrew.", command: "brew install sonar-scanner" }
    : { hint: "Install sonar-scanner from SonarSource docs.", url: "https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/analysis-scanner-configuration/" }
  const sonarInstallCommand = platform === "win32"
    ? "irm https://raw.githubusercontent.com/SonarSource/sonarqube-cli/refs/heads/master/user-scripts/install.ps1 | iex"
    : "curl -o- https://raw.githubusercontent.com/SonarSource/sonarqube-cli/refs/heads/master/user-scripts/install.sh | bash"
  const hints: Record<string, CheckResult["remedy"]> = {
    gh: ghRemedy,
    claude: { hint: "Install Claude Code globally with npm.", command: "npm i -g @anthropic-ai/claude-code" },
    codex: { hint: "Install Codex globally with npm.", command: "npm i -g @openai/codex" },
    opencode: { hint: "Install OpenCode per the official install docs.", url: "https://opencode.ai/docs/install" },
    playwright: { hint: "Install Playwright CLI and browser binaries from the official docs.", url: "https://playwright.dev/docs/intro" },
    "agent-browser": { hint: "Install agent-browser per the official repository.", url: "https://github.com/vercel-labs/agent-browser" },
    coderabbit: { hint: "Install CodeRabbit CLI globally with npm.", command: "npm i -g @coderabbit/cli" },
    "sonar-scanner": sonarScannerRemedy,
    sonar: {
      hint: "Install sonarqube-cli from SonarSource (installs the `sonar` binary).",
      command: sonarInstallCommand,
    },
  }
  return hints[tool]
}

function probeCommand(command: string, args: string[] = []): Promise<ToolProbe> {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve({ ok: false, detail: `timed out after ${TOOL_TIMEOUT_MS}ms` })
    }, TOOL_TIMEOUT_MS)

    child.stdout.on("data", chunk => stdoutChunks.push(chunk as Buffer))
    child.stderr.on("data", chunk => stderrChunks.push(chunk as Buffer))
    child.on("error", err => {
      clearTimeout(timer)
      resolve({ ok: false, detail: err.message })
    })
    child.on("exit", code => {
      clearTimeout(timer)
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim()
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim()
      const outputLine = (stdout || stderr).split(/\r?\n/)[0]
      resolve({
        ok: code === 0,
        version: outputLine || undefined,
        detail: code === 0 ? undefined : outputLine || `exit ${code ?? "unknown"}`,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
      })
    })
  })
}

async function probeCodexAuth(): Promise<CheckResult> {
  const auth = await probeCommand("codex", ["login", "status"])
  if (auth.ok) {
    const detail = (auth.stdout ?? auth.version ?? "Codex auth available").split(/\r?\n/)[0]
    return createCheck("llm.openai.auth", "OpenAI / Codex auth", "ok", detail)
  }
  return createCheck(
    "llm.openai.auth",
    "OpenAI / Codex auth",
    "missing",
    "Codex is not logged in and OPENAI_API_KEY is not set",
    {
      remedy: { hint: "Run `codex login`, or export OPENAI_API_KEY before running beerengineer_." },
    },
  )
}

async function probeClaudeAuth(): Promise<CheckResult> {
  const auth = await probeCommand("claude", ["auth", "status"])
  if (!auth.ok) {
    return createCheck(
      "llm.anthropic.auth",
      "Anthropic / Claude Code auth",
      "missing",
      "Claude Code is not logged in and ANTHROPIC_API_KEY is not set",
      {
        remedy: { hint: "Run `claude`, complete `/login`, or export ANTHROPIC_API_KEY before running beerengineer_." },
      },
    )
  }

  try {
    const parsed = JSON.parse(auth.stdout ?? auth.version ?? "{}") as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string }
    if (parsed.loggedIn) {
      const via = parsed.authMethod ? ` via ${parsed.authMethod}` : ""
      const plan = parsed.subscriptionType ? ` (${parsed.subscriptionType})` : ""
      return createCheck("llm.anthropic.auth", "Anthropic / Claude Code auth", "ok", `Logged in${via}${plan}`)
    }
  } catch {
    // Fall through to a generic success detail when the CLI output is not JSON.
  }

  return createCheck("llm.anthropic.auth", "Anthropic / Claude Code auth", "ok", auth.version ?? "Claude Code auth available")
}

function statusIsOk(status: SetupStatus): boolean {
  return status === "ok"
}

function summarizeOverall(groups: GroupResult[]): SetupReport["overall"] {
  const requiredBlocked = groups.some(group => group.level === "required" && !group.satisfied)
  if (requiredBlocked) return "blocked"
  const recommendedLagging = groups.some(group => group.level !== "required" && !group.ideal)
  return recommendedLagging ? "warning" : "ok"
}

function formatGroupTitle(group: GroupResult): string {
  let suffix = "optional"
  if (group.level === "required") suffix = "required"
  else if (group.level === "recommended") suffix = "recommended"
  return `${group.label} (${suffix})`
}

function renderStatus(status: SetupStatus): string {
  switch (status) {
    case "ok":
      return "OK"
    case "missing":
      return "MISSING"
    case "misconfigured":
      return "MISCONFIGURED"
    case "skipped":
      return "SKIPPED"
    case "unknown":
      return "UNKNOWN"
    case "uninitialized":
      return "UNINITIALIZED"
  }
}

function createCheck(id: string, label: string, status: SetupStatus, detail?: string, extra: Partial<CheckResult> = {}): CheckResult {
  return { id, label, status, detail, ...extra }
}

function getActiveLlmGroup(config: AppConfig | null): string | null {
  if (!config) return null
  return `llm.${config.llm.provider}`
}

async function runCoreChecks(configPath: string, configState: ReturnType<typeof readConfigFile>, config: AppConfig | null): Promise<CheckResult[]> {
  const checks: CheckResult[] = []
  const major = currentNodeMajorVersion()
  checks.push(createCheck(
    "core.node",
    "Node.js runtime",
    major >= 22 ? "ok" : "misconfigured",
    `v${process.versions.node}${major >= 22 ? "" : " (>= 22 required)"}`
  ))

  const git = await probeCommand("git", ["--version"])
  checks.push(createCheck(
    "core.git",
    "git on PATH",
    git.ok ? "ok" : "missing",
    git.version ?? git.detail,
    { remedy: git.ok ? undefined : { hint: "Install Git and ensure it is on PATH.", url: "https://git-scm.com/downloads" } }
  ))

  const preconditionChecks = buildCorePreconditionChecks(configPath, configState, config)
  if (preconditionChecks) {
    checks.push(...preconditionChecks)
    return checks
  }
  const resolvedConfig = config as AppConfig

  checks.push(
    createCheck("core.config", "config file", "ok", configPath),
    checkConfiguredDataDir(resolvedConfig.dataDir),
  )

  const dbPath = resolveConfiguredDbPath(resolvedConfig)
  if (!existsSync(dbPath)) {
    checks.push(
      createCheck("core.db", "configured database", "missing", dbPath),
      createCheck("core.migrations", "database migration level", "skipped", "database file is missing"),
    )
    return checks
  }
  checks.push(
    ...readableDatabaseChecks(dbPath),
    checkDesignPrepAdapters(),
    await checkDesignPrepReferences(dbPath),
  )

  return checks
}

function checkConfiguredDataDir(dataDir: string): CheckResult {
  if (!existsSync(dataDir)) {
    return createCheck("core.dataDir", "configured data dir", "missing", dataDir)
  }
  try {
    accessSync(dataDir, constants.W_OK)
    return createCheck("core.dataDir", "configured data dir", "ok", dataDir)
  } catch (err) {
    return createCheck("core.dataDir", "configured data dir", "misconfigured", `${dataDir}: ${(err as Error).message}`)
  }
}

function readableDatabaseChecks(dbPath: string): CheckResult[] {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    db.prepare("SELECT 1").get()
    const userVersion = (db.pragma("user_version", { simple: true }) as number) ?? 0
    db.close()
    return [
      createCheck("core.db", "configured database", "ok", dbPath),
      createCheck(
        "core.migrations",
        "database migration level",
        userVersion === REQUIRED_MIGRATION_LEVEL ? "ok" : "misconfigured",
        `current=${userVersion}, required=${REQUIRED_MIGRATION_LEVEL}`
      ),
    ]
  } catch (err) {
    return [
      createCheck("core.db", "configured database", "misconfigured", `${dbPath}: ${(err as Error).message}`),
      createCheck("core.migrations", "database migration level", "skipped", "database is not readable"),
    ]
  }
}

function checkDesignPrepAdapters(): CheckResult {
  try {
    createVisualCompanionStage()
    createVisualCompanionReview()
    createFrontendDesignStage()
    createFrontendDesignReview()
    return createCheck("core.designPrepAdapters", "design-prep adapters registered", "ok", "visual-companion + frontend-design")
  } catch (err) {
    return createCheck("core.designPrepAdapters", "design-prep adapters registered", "misconfigured", (err as Error).message)
  }
}

async function checkDesignPrepReferences(dbPath: string): Promise<CheckResult> {
  try {
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const hasUiRun = repoHasUiRun(repos)
    const workspace = repos.listWorkspaces().find(candidate => candidate.root_path)
    db.close()
    if (!hasUiRun) {
      return createCheck("core.designPrepReferences", "design-prep references folder writable", "skipped", "no UI-bearing runs detected")
    }
    if (!workspace?.root_path) {
      return createCheck("core.designPrepReferences", "design-prep references folder writable", "skipped", "no registered workspace roots")
    }
    return probeDesignPrepReferences(workspace.root_path)
  } catch (err) {
    return createCheck("core.designPrepReferences", "design-prep references folder writable", "misconfigured", (err as Error).message)
  }
}

function repoHasUiRun(repos: Repos): boolean {
  return repos.listRuns().filter(run => run.workspace_fs_id).some(run => {
    try {
      const ctx = resolveWorkflowContextForRun(repos, run)
      if (!ctx) return false
      const projectsPath = layout.stageArtifactsDir(ctx, "brainstorm")
      const projects = JSON.parse(readFileSync(`${projectsPath}/projects.json`, "utf8")) as Array<{ hasUi?: boolean }>
      return projects.some(project => project.hasUi === true)
    } catch {
      return false
    }
  })
}

function probeDesignPrepReferences(workspaceRoot: string): CheckResult {
  // Probe the workspace root itself for writability rather than creating
  // the design-prep subdirectory eagerly — doctor should be read-only.
  const probeTarget = `${workspaceRoot}/.beerengineer`
  const parentTarget = existsSync(probeTarget) ? probeTarget : workspaceRoot
  accessSync(parentTarget, constants.W_OK)
  return createCheck(
    "core.designPrepReferences",
    "design-prep references folder writable",
    "ok",
    `${probeTarget}/references/design-prep (parent: ${parentTarget})`
  )
}

function currentNodeMajorVersion(): number {
  const [major] = process.versions.node.split(".").map(Number)
  return major
}

function buildCorePreconditionChecks(
  configPath: string,
  configState: ReturnType<typeof readConfigFile>,
  config: AppConfig | null,
): CheckResult[] | null {
  if (configState.kind === "missing") {
    return [
      createCheck("core.config", "config file", "uninitialized", `missing at ${configPath}`),
      createCheck("core.dataDir", "configured data dir", "uninitialized", "config has not been initialized"),
      createCheck("core.db", "configured database", "uninitialized", "config has not been initialized"),
      createCheck("core.migrations", "database migration level", "uninitialized", "config has not been initialized"),
    ]
  }
  if (configState.kind === "invalid") {
    return [
      createCheck("core.config", "config file", "misconfigured", `${configPath}: ${configState.error}`),
      createCheck("core.dataDir", "configured data dir", "skipped", "config is invalid"),
      createCheck("core.db", "configured database", "skipped", "config is invalid"),
      createCheck("core.migrations", "database migration level", "skipped", "config is invalid"),
    ]
  }
  if (config) return null
  return [
    createCheck("core.config", "config file", "unknown", `${configPath}: effective config could not be resolved`),
    createCheck("core.dataDir", "configured data dir", "skipped", "effective config is unavailable"),
    createCheck("core.db", "configured database", "skipped", "effective config is unavailable"),
    createCheck("core.migrations", "database migration level", "skipped", "effective config is unavailable"),
  ]
}

async function runGitHubChecks(enabled: boolean): Promise<CheckResult[]> {
  const gh = await probeCommand("gh", ["--version"])
  const ghCheck = createCheck(
    "vcs.gh",
    "GitHub CLI",
    gh.ok ? "ok" : "missing",
    gh.version ?? gh.detail,
    { remedy: gh.ok ? undefined : remedyForTool("gh") }
  )
  if (!enabled) {
    return [
      ghCheck,
      createCheck("vcs.gh.auth", "GitHub auth", "skipped", "GitHub workflows are disabled in config"),
    ]
  }
  if (!gh.ok) {
    return [
      ghCheck,
      createCheck("vcs.gh.auth", "GitHub auth", "skipped", "GitHub CLI is not available"),
    ]
  }
  const auth = await probeCommand("gh", ["auth", "status"])
  return [
    ghCheck,
    createCheck("vcs.gh.auth", "GitHub auth", auth.ok ? "ok" : "missing", auth.version ?? auth.detail),
  ]
}

async function runLlmChecks(provider: AppConfig["llm"]["provider"], config: AppConfig): Promise<CheckResult[]> {
  const defs = {
    anthropic: { cliId: "llm.anthropic.cli", authId: "llm.anthropic.auth", label: "Anthropic / Claude Code", command: "claude", apiKeyRef: config.llm.apiKeyRef || "ANTHROPIC_API_KEY" },
    openai: { cliId: "llm.openai.cli", authId: "llm.openai.auth", label: "OpenAI / Codex", command: "codex", apiKeyRef: config.llm.apiKeyRef || "OPENAI_API_KEY" },
    opencode: { cliId: "llm.opencode.cli", authId: "llm.opencode.auth", label: "OpenCode", command: "opencode", apiKeyRef: config.llm.apiKeyRef || "OPENCODE_API_KEY" },
  } as const
  const def = defs[provider]
  const cli = await probeCommand(def.command, ["--version"])
  const cliCheck = createCheck(def.cliId, `${def.label} CLI`, cli.ok ? "ok" : "missing", cli.version ?? cli.detail, {
    remedy: cli.ok ? undefined : remedyForTool(def.command),
  })
  if (!cli.ok) {
    return [cliCheck, createCheck(def.authId, `${def.label} auth`, "skipped", `${def.command} CLI is not available`)]
  }
  if (provider === "anthropic") {
    const apiKey = process.env[def.apiKeyRef]
    if (apiKey) {
      return [
        cliCheck,
        createCheck(def.authId, `${def.label} auth`, "ok", `${def.apiKeyRef} is set`),
      ]
    }
    return [cliCheck, await probeClaudeAuth()]
  }
  if (provider === "openai") {
    const apiKey = process.env[def.apiKeyRef]
    if (apiKey) {
      return [
        cliCheck,
        createCheck(def.authId, `${def.label} auth`, "ok", `${def.apiKeyRef} is set`),
      ]
    }
    return [cliCheck, await probeCodexAuth()]
  }
  const present = Boolean(process.env[def.apiKeyRef])
  return [
    cliCheck,
    createCheck(
      def.authId,
      `${def.label} auth`,
      present ? "ok" : "missing",
      present ? `${def.apiKeyRef} is set` : `${def.apiKeyRef} is not set`,
      present ? {} : { remedy: { hint: `Export ${def.apiKeyRef} before running beerengineer_.` } }
    ),
  ]
}

async function runBrowserChecks(enabled: boolean): Promise<CheckResult[]> {
  if (!enabled) {
    return [
      createCheck("browser.playwright", "Playwright CLI + browser probe", "skipped", "browser automation is disabled in config"),
      createCheck("browser.agent-browser", "agent-browser CLI", "skipped", "browser automation is disabled in config"),
    ]
  }
  const playwright = await probeCommand("playwright", ["--version"])
  const agentBrowser = await probeCommand("agent-browser", ["--version"])
  return [
    createCheck("browser.playwright", "Playwright CLI + browser probe", playwright.ok ? "ok" : "missing", playwright.version ?? playwright.detail, {
      remedy: playwright.ok ? undefined : remedyForTool("playwright"),
    }),
    createCheck("browser.agent-browser", "agent-browser CLI", agentBrowser.ok ? "ok" : "missing", agentBrowser.version ?? agentBrowser.detail, {
      remedy: agentBrowser.ok ? undefined : remedyForTool("agent-browser"),
    }),
  ]
}

async function runReviewChecks(): Promise<CheckResult[]> {
  const [coderabbit, sonarScanner, sonarqubeCli] = await Promise.all([
    probeCommand("coderabbit", ["--version"]),
    probeCommand("sonar-scanner", ["--version"]),
    probeCommand("sonar", ["--version"]),
  ])
  const sonarTokenPresent = Boolean(process.env.SONAR_TOKEN)
  return [
    createCheck("review.coderabbit", "CodeRabbit CLI", coderabbit.ok ? "ok" : "missing", coderabbit.version ?? coderabbit.detail, {
      remedy: coderabbit.ok ? undefined : remedyForTool("coderabbit"),
    }),
    createCheck("review.sonar-scanner", "sonar-scanner", sonarScanner.ok ? "ok" : "missing", sonarScanner.version ?? sonarScanner.detail, {
      remedy: sonarScanner.ok ? undefined : remedyForTool("sonar-scanner"),
    }),
    createCheck("review.sonarqube-cli", "sonarqube-cli", sonarqubeCli.ok ? "ok" : "missing", sonarqubeCli.version ?? sonarqubeCli.detail, {
      remedy: sonarqubeCli.ok ? undefined : remedyForTool("sonar"),
    }),
    createCheck(
      "review.sonar-token",
      "SONAR_TOKEN",
      sonarTokenPresent ? "ok" : "missing",
      sonarTokenPresent
        ? "Token available for scanner/API auth"
        : "Missing SONAR_TOKEN. Story-branch Sonar gating will fail if Sonar is enabled.",
      {
        remedy: sonarTokenPresent
          ? undefined
          : { hint: "Create a SonarQube Cloud analysis token and export it as SONAR_TOKEN." },
      },
    ),
    createCheck(
      "review.sonar-plan",
      "Sonar branch-analysis plan tier",
      "unknown",
      "Branch analysis for story branches requires SonarQube Cloud Team, Enterprise, or OSS; Free plan workspaces will be skipped.",
    ),
  ]
}

function buildTelegramExportCommand(envName: string): string {
  return `export ${envName}=<telegram-bot-token>`
}

function buildTelegramWebhookSecretExportCommand(envName: string): string {
  return `export ${envName}=<telegram-webhook-secret>`
}

async function runNotificationChecks(config: AppConfig | null): Promise<CheckResult[]> {
  if (!config) {
    return [
      createCheck("notifications.public-base-url", "Public base URL", "skipped", "effective config is unavailable"),
      createCheck("notifications.telegram.enabled", "Telegram notifications enabled", "skipped", "effective config is unavailable"),
      createCheck("notifications.telegram.level", "Telegram message level", "skipped", "effective config is unavailable"),
      createCheck("notifications.telegram.bot-token-env", "Telegram bot token env var", "skipped", "effective config is unavailable"),
      createCheck("notifications.telegram.bot-token-present", "Telegram bot token present", "skipped", "effective config is unavailable"),
      createCheck("notifications.telegram.default-chat-id", "Telegram default chat id", "skipped", "effective config is unavailable"),
      createCheck("notifications.telegram.inbound.enabled", "Telegram inbound replies enabled", "skipped", "effective config is unavailable"),
      createCheck("notifications.telegram.inbound.webhook-secret-env", "Telegram webhook secret env var", "skipped", "effective config is unavailable"),
      createCheck("notifications.telegram.inbound.webhook-secret-present", "Telegram webhook secret present", "skipped", "effective config is unavailable"),
    ]
  }

  const checks: CheckResult[] = []
  checks.push(checkNotificationBaseUrl(config.publicBaseUrl?.trim()))

  const telegramEnabled = config.notifications?.telegram?.enabled === true
  checks.push(createCheck(
    "notifications.telegram.enabled",
    "Telegram notifications enabled",
    telegramEnabled ? "ok" : "skipped",
    telegramEnabled ? "Enabled in config" : "Disabled in config",
  ))

  const tokenEnv = config.notifications?.telegram?.botTokenEnv?.trim()
  if (!telegramEnabled) {
    checks.push(...disabledTelegramChecks())
    return checks
  }

  checks.push(createCheck(
    "notifications.telegram.level",
    "Telegram message level",
    "ok",
    `L${config.notifications?.telegram?.level ?? 2}`,
  ))

  const tokenChecks = [
    checkTelegramTokenEnv(tokenEnv),
    checkTelegramTokenPresent(tokenEnv),
    checkTelegramDefaultChatId(config.notifications?.telegram?.defaultChatId?.trim()),
  ]
  checks.push(...tokenChecks)

  const inboundEnabled = config.notifications?.telegram?.inbound?.enabled === true
  checks.push(createCheck(
    "notifications.telegram.inbound.enabled",
    "Telegram inbound replies enabled",
    inboundEnabled ? "ok" : "skipped",
    inboundEnabled ? "Enabled in config" : "Disabled in config",
  ))

  const webhookSecretEnv = config.notifications?.telegram?.inbound?.webhookSecretEnv?.trim()
  checks.push(
    checkTelegramWebhookSecretEnv(inboundEnabled, webhookSecretEnv),
    checkTelegramWebhookSecretPresent(inboundEnabled, webhookSecretEnv),
  )

  return checks
}

function checkNotificationBaseUrl(baseUrl: string | undefined): CheckResult {
  if (!baseUrl) {
    return createCheck(
      "notifications.public-base-url",
      "Public base URL",
      "missing",
      "Missing publicBaseUrl. Telegram links need a Tailscale-reachable absolute URL.",
      { remedy: { hint: "Set publicBaseUrl to the externally reachable UI address, for example http://100.x.y.z:3100." } },
    )
  }
  try {
    return createCheck("notifications.public-base-url", "Public base URL", "ok", normalizePublicBaseUrl(baseUrl))
  } catch (err) {
    return createCheck(
      "notifications.public-base-url",
      "Public base URL",
      "misconfigured",
      (err as Error).message,
      { remedy: { hint: "Use an absolute http(s) URL that is reachable over Tailscale and not localhost.", command: "BEERENGINEER_PUBLIC_BASE_URL=http://100.x.y.z:3100" } },
    )
  }
}

function disabledTelegramChecks(): CheckResult[] {
  const disabledDetail = "Telegram notifications are disabled in config"
  return [
    createCheck("notifications.telegram.level", "Telegram message level", "skipped", disabledDetail),
    createCheck("notifications.telegram.bot-token-env", "Telegram bot token env var", "skipped", disabledDetail),
    createCheck("notifications.telegram.bot-token-present", "Telegram bot token present", "skipped", disabledDetail),
    createCheck("notifications.telegram.default-chat-id", "Telegram default chat id", "skipped", disabledDetail),
    createCheck("notifications.telegram.inbound.enabled", "Telegram inbound replies enabled", "skipped", disabledDetail),
    createCheck("notifications.telegram.inbound.webhook-secret-env", "Telegram webhook secret env var", "skipped", disabledDetail),
    createCheck("notifications.telegram.inbound.webhook-secret-present", "Telegram webhook secret present", "skipped", disabledDetail),
  ]
}

function checkTelegramTokenEnv(tokenEnv: string | undefined): CheckResult {
  if (tokenEnv) {
    return createCheck("notifications.telegram.bot-token-env", "Telegram bot token env var", "ok", tokenEnv)
  }
  return createCheck(
    "notifications.telegram.bot-token-env",
    "Telegram bot token env var",
    "missing",
    "Missing notifications.telegram.botTokenEnv",
    { remedy: { hint: "Store the Telegram bot token in an env var and record that env var name in config." } },
  )
}

function checkTelegramTokenPresent(tokenEnv: string | undefined): CheckResult {
  const tokenPresent = tokenEnv ? Boolean(process.env[tokenEnv]) : false
  return createCheck(
    "notifications.telegram.bot-token-present",
    "Telegram bot token present",
    tokenPresent ? "ok" : "missing",
    tokenPresent ? `${tokenEnv} is set` : `${tokenEnv ?? "bot token env"} is not set in this shell`,
    tokenPresent || !tokenEnv
      ? {}
      : { remedy: { hint: "Export the Telegram bot token before starting the engine.", command: buildTelegramExportCommand(tokenEnv) } },
  )
}

function checkTelegramDefaultChatId(chatId: string | undefined): CheckResult {
  return createCheck(
    "notifications.telegram.default-chat-id",
    "Telegram default chat id",
    chatId ? "ok" : "missing",
    chatId ?? "Missing notifications.telegram.defaultChatId",
    chatId ? {} : { remedy: { hint: "Record the chat id that should receive beerengineer_ notifications." } },
  )
}

function checkTelegramWebhookSecretEnv(inboundEnabled: boolean, webhookSecretEnv: string | undefined): CheckResult {
  let status: SetupStatus = "skipped"
  let detail = "Telegram inbound replies are disabled in config"
  if (inboundEnabled) {
    status = webhookSecretEnv ? "ok" : "missing"
    detail = webhookSecretEnv ?? "Missing notifications.telegram.inbound.webhookSecretEnv"
  }
  return createCheck(
    "notifications.telegram.inbound.webhook-secret-env",
    "Telegram webhook secret env var",
    status,
    detail,
    inboundEnabled && !webhookSecretEnv
      ? { remedy: { hint: "Store the Telegram webhook secret in an env var and record that env var name in config." } }
      : {},
  )
}

function checkTelegramWebhookSecretPresent(inboundEnabled: boolean, webhookSecretEnv: string | undefined): CheckResult {
  const webhookSecretPresent = webhookSecretEnv ? Boolean(process.env[webhookSecretEnv]) : false
  let status: SetupStatus = "skipped"
  let detail = "Telegram inbound replies are disabled in config"
  if (inboundEnabled && webhookSecretEnv) {
    status = webhookSecretPresent ? "ok" : "missing"
    detail = webhookSecretPresent ? `${webhookSecretEnv} is set` : `${webhookSecretEnv} is not set in this shell`
  } else if (inboundEnabled) {
    status = "missing"
    detail = "Webhook secret env var is not configured"
  }
  return createCheck(
    "notifications.telegram.inbound.webhook-secret-present",
    "Telegram webhook secret present",
    status,
    detail,
    inboundEnabled && webhookSecretEnv && !webhookSecretPresent
      ? { remedy: { hint: "Export the Telegram webhook secret before starting the engine.", command: buildTelegramWebhookSecretExportCommand(webhookSecretEnv) } }
      : {},
  )
}

export async function generateSetupReport(options: DoctorOptions = {}): Promise<SetupReport> {
  const overrides = resolveOverrides(options.overrides)
  const configPath = resolveConfigPath(overrides)
  const configState = readConfigFile(configPath)
  const config = resolveMergedConfig(configState, overrides)
  const llmGroup = getActiveLlmGroup(configState.kind === "ok" ? config : null)
  const telegramEnabled = config?.notifications?.telegram?.enabled === true

  const groupDefs: GroupDefinition[] = [
    {
      id: "core",
      label: "Core app checks",
      level: "required",
      minOk: 6,
      active: true,
      run: () => runCoreChecks(configPath, configState, config),
    },
    {
      id: "notifications",
      label: "Notification delivery",
      level: "required",
      minOk: telegramEnabled ? 4 : 0,
      active: true,
      run: () => runNotificationChecks(config),
    },
    {
      id: "vcs.github",
      label: "GitHub workflows",
      level: "required",
      minOk: 2,
      active: configState.kind === "ok" && Boolean(config?.vcs?.github?.enabled),
      run: () => runGitHubChecks(Boolean(config?.vcs?.github?.enabled)),
    },
    {
      id: "llm.anthropic",
      label: "Anthropic capability",
      level: "required",
      minOk: 2,
      active: Boolean(config) && (options.allLlmGroups === true || llmGroup === "llm.anthropic"),
      run: () => runLlmChecks("anthropic", config as AppConfig),
    },
    {
      id: "llm.openai",
      label: "OpenAI capability",
      level: "required",
      minOk: 2,
      active: Boolean(config) && (options.allLlmGroups === true || llmGroup === "llm.openai"),
      run: () => runLlmChecks("openai", config as AppConfig),
    },
    {
      id: "llm.opencode",
      label: "OpenCode capability",
      level: "required",
      minOk: 2,
      active: Boolean(config) && (options.allLlmGroups === true || llmGroup === "llm.opencode"),
      run: () => runLlmChecks("opencode", config as AppConfig),
    },
    {
      id: "browser-agent",
      label: "Browser agent capability",
      level: "required",
      minOk: 2,
      active: configState.kind === "ok" && Boolean(config?.browser?.enabled),
      run: () => runBrowserChecks(Boolean(config?.browser?.enabled)),
    },
    {
      id: "review",
      label: "Review tool recommendations",
      level: "recommended",
      minOk: 0,
      idealOk: 3,
      active: true,
      run: () => runReviewChecks(),
    },
  ]

  const selectedDefs = groupDefs.filter(group => group.active && (!options.group || group.id === options.group))
  const groups = await Promise.all(selectedDefs.map(async group => {
    const checks = await group.run()
    const passed = checks.filter(check => statusIsOk(check.status)).length
    const satisfied = passed >= group.minOk
    const ideal = passed >= (group.idealOk ?? group.minOk)
    return {
      id: group.id,
      label: group.label,
      level: group.level,
      minOk: group.minOk,
      idealOk: group.idealOk,
      passed,
      satisfied,
      ideal,
      checks,
    } satisfies GroupResult
  }))

  return {
    reportVersion: 1,
    overall: summarizeOverall(groups),
    groups,
    generatedAt: Date.now(),
  }
}

function printDoctorReport(report: SetupReport, opts: { installHints: boolean }): void {
  console.log("")
  console.log(`  Setup status: ${report.overall}`)
  for (const group of report.groups) {
    console.log(`  ${formatGroupTitle(group)} [${group.passed}/${group.idealOk ?? group.minOk}]`)
    for (const check of group.checks) {
      printDoctorCheck(check, opts.installHints)
    }
  }
  console.log("")
}

function printDoctorCheck(check: CheckResult, installHints: boolean): void {
  const detail = check.detail ? ` - ${check.detail}` : ""
  console.log(`    [${renderStatus(check.status)}] ${check.label}${detail}`)
  if (!installHints || check.status === "ok" || !check.remedy) return
  console.log(`      hint: ${check.remedy.hint}`)
  if (check.remedy.command) console.log(`      cmd:  ${check.remedy.command}`)
  if (check.remedy.url) console.log(`      url:  ${check.remedy.url}`)
}

function doctorExitCode(report: SetupReport): number {
  return report.overall === "blocked" ? 1 : 0
}

export async function runDoctorCommand(options: DoctorOptions = {}): Promise<number> {
  const report = await generateSetupReport(options)
  printDoctorReport(report, { installHints: false })
  return doctorExitCode(report)
}

function needsInitialization(report: SetupReport): boolean {
  return report.groups.some(group => group.id === "core" && group.checks.some(check => check.status === "uninitialized"))
}

class InvalidConfigError extends Error {
  constructor(public readonly path: string, public readonly reason: string) {
    super(`config at ${path} is invalid: ${reason}`)
  }
}

function buildProvisionedConfig(overrides: SetupOverrides = {}): AppConfig {
  const resolved = resolveOverrides(overrides)
  const state = readConfigFile(resolveConfigPath(resolved))
  if (state.kind === "invalid") {
    throw new InvalidConfigError(state.path, state.error)
  }
  return resolveMergedConfig(state, resolved) as AppConfig
}

function ensureProvisionedState(overrides: SetupOverrides = {}): AppConfig {
  const resolved = resolveOverrides(overrides)
  const configPath = resolveConfigPath(resolved)
  const config = buildProvisionedConfig(resolved)
  mkdirSync(config.dataDir, { recursive: true })
  initDatabase(resolveConfiguredDbPath(config)).close()
  writeConfigFile(configPath, config)
  return config
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

function diffPrint(previous: SetupReport, next: SetupReport): void {
  const previousStatuses = new Map(previous.groups.flatMap(group => group.checks.map(check => [check.id, check.status] as const)))
  for (const group of next.groups) {
    for (const check of group.checks) {
      const before = previousStatuses.get(check.id)
      if (before && before !== "ok" && check.status === "ok") {
        console.log(`  + ${check.id} now ok`)
      }
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

    const enabledAnswer = (await rl.question("  Enable Telegram notifications? [y/N] ")).trim().toLowerCase()
    const enabled = enabledAnswer === "y" || enabledAnswer === "yes"
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
    const inboundEnabled = await promptTelegramInboundEnabled(rl, configuredTelegram)
    configuredTelegram.inbound = {
      ...configuredTelegram.inbound,
      enabled: inboundEnabled,
    }

    if (inboundEnabled) {
      const secretEnvAnswer =
        (await rl.question(`  Telegram webhook secret env var [${configuredTelegram.inbound?.webhookSecretEnv ?? "TELEGRAM_WEBHOOK_SECRET"}]: `)).trim()
      const configuredInbound = configuredTelegram.inbound
      if (!configuredInbound) throw new Error("Telegram inbound config missing during interactive setup")
      configuredInbound.webhookSecretEnv = secretEnvAnswer || configuredInbound.webhookSecretEnv || "TELEGRAM_WEBHOOK_SECRET"
    }

    writeConfigFile(configPath, next)
    console.log("")
    console.log("  Next steps:")
    console.log(`    ${buildTelegramExportCommand(configuredTelegram.botTokenEnv ?? "TELEGRAM_BOT_TOKEN")}`)
    if (configuredTelegram.inbound?.enabled && configuredTelegram.inbound?.webhookSecretEnv) {
      console.log(`    ${buildTelegramWebhookSecretExportCommand(configuredTelegram.inbound.webhookSecretEnv)}`)
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
    const baseUrlAnswer = (await rl.question(`  Public base URL [${current ?? "http://100.x.y.z:3100"}]: `)).trim()
    const candidate = baseUrlAnswer || current || "http://100.x.y.z:3100"
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
    const levelAnswer = (await rl.question(`  Telegram message level [${currentLevel}] (0=debug, 1=ops, 2=milestones): `)).trim()
    const candidate = levelAnswer || String(currentLevel)
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
    const chatIdAnswer = (await rl.question(`  Telegram chat id [${currentTelegram.defaultChatId ?? ""}]: `)).trim()
    const chatId = chatIdAnswer || currentTelegram.defaultChatId
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
  const inboundAnswer = (await rl.question(`  Enable Telegram inbound prompt replies? [${configuredTelegram.inbound?.enabled ? "Y/n" : "y/N"}] `)).trim().toLowerCase()
  if (inboundAnswer === "") return configuredTelegram.inbound?.enabled === true
  return inboundAnswer === "y" || inboundAnswer === "yes"
}

export async function runSetupCommand(options: SetupRunOptions = {}): Promise<number> {
  const resolved = resolveOverrides(options.overrides)
  const configPath = resolveConfigPath(resolved)
  let report = await refreshSetupReport(options)

  if (needsInitialization(report)) {
    const initialized = initializeProvisionedState(options.overrides)
    if (!initialized.ok) return 1
    console.log("  App setup initialized config, data dir, and database.")
    report = await refreshSetupReport(options)
  }

  const interactive = !options.noInteractive && Boolean(process.stdin.isTTY && process.stdout.isTTY)
  if (interactive && (!options.group || options.group === "notifications")) {
    const configured = maybeConfigureTelegramInteractive(configPath, buildProvisionedConfig(resolved))
    await configured
    report = await refreshSetupReport(options)
  }
  while (interactive && report.overall === "blocked") {
    const action = await promptRetryAction(report.groups.filter(group => group.level === "required").every(group => group.satisfied))
    if (action === "quit") return doctorExitCode(report)
    if (action === "skip") break
    const next = await generateSetupReport(options)
    diffPrint(report, next)
    report = next
  }

  if (report.overall !== "blocked") {
    console.log("  Next: beerengineer workspace add <path>")
  }
  return doctorExitCode(report)
}

function initializeProvisionedState(overrides: SetupOverrides | undefined): { ok: true } | { ok: false } {
  try {
    ensureProvisionedState(overrides)
    return { ok: true }
  } catch (err) {
    if (err instanceof InvalidConfigError) {
      console.error(`  Refusing to overwrite invalid config at ${err.path}: ${err.reason}`)
      console.error("  Fix the file by hand or remove it, then re-run `beerengineer setup`.")
      return { ok: false }
    }
    throw err
  }
}

async function refreshSetupReport(options: SetupRunOptions): Promise<SetupReport> {
  const report = await generateSetupReport(options)
  printDoctorReport(report, { installHints: true })
  return report
}
