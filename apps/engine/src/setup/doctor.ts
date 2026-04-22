import Database from "better-sqlite3"
import { accessSync, constants, existsSync, mkdirSync, rmSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { resolveConfiguredDbPath, resolveConfigPath, resolveMergedConfig, readConfigFile, REQUIRED_MIGRATION_LEVEL, resolveOverrides, writeConfigFile } from "./config.js"
import type { AppConfig, CheckResult, GroupResult, SetupOverrides, SetupReport, SetupStatus } from "./types.js"
import { initDatabase } from "../db/connection.js"

type ToolProbe = {
  ok: boolean
  version?: string
  detail?: string
}

type DoctorOptions = {
  group?: string
  overrides?: SetupOverrides
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
  const hints: Record<string, CheckResult["remedy"]> = {
    gh:
      platform === "darwin"
        ? { hint: "Install GitHub CLI with Homebrew.", command: "brew install gh" }
        : platform === "win32"
        ? { hint: "Install GitHub CLI with winget.", command: "winget install GitHub.cli" }
        : { hint: "Install GitHub CLI from the official docs.", url: "https://cli.github.com/" },
    claude: { hint: "Install Claude Code globally with npm.", command: "npm i -g @anthropic-ai/claude-code" },
    codex: { hint: "Install Codex globally with npm.", command: "npm i -g @openai/codex" },
    opencode: { hint: "Install OpenCode via the official installer.", command: "curl -fsSL https://opencode.ai/install | bash" },
    playwright: { hint: "Install Playwright CLI and browser binaries from the official docs.", url: "https://playwright.dev/docs/intro" },
    "agent-browser": { hint: "Install agent-browser per the official repository.", url: "https://github.com/vercel-labs/agent-browser" },
    coderabbit: { hint: "Install CodeRabbit CLI globally with npm.", command: "npm i -g @coderabbit/cli" },
    "sonar-scanner":
      platform === "darwin"
        ? { hint: "Install sonar-scanner with Homebrew.", command: "brew install sonar-scanner" }
        : { hint: "Install sonar-scanner from SonarSource docs.", url: "https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/analysis-scanner-configuration/" },
    "sonarqube-cli": { hint: "Install sonarqube-cli globally with npm.", command: "npm i -g sonarqube-cli" },
  }
  return hints[tool]
}

async function probeCommand(command: string, args: string[] = []): Promise<ToolProbe> {
  const { spawn } = await import("node:child_process")
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
      })
    })
  })
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
  const suffix = group.level === "required" ? "required" : group.level === "recommended" ? "recommended" : "optional"
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
  const [major] = process.versions.node.split(".").map(Number)
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

  if (configState.kind === "missing") {
    checks.push(createCheck("core.config", "config file", "uninitialized", `missing at ${configPath}`))
    checks.push(createCheck("core.dataDir", "configured data dir", "uninitialized", "config has not been initialized"))
    checks.push(createCheck("core.db", "configured database", "uninitialized", "config has not been initialized"))
    checks.push(createCheck("core.migrations", "database migration level", "uninitialized", "config has not been initialized"))
    return checks
  }

  if (configState.kind === "invalid") {
    checks.push(createCheck("core.config", "config file", "misconfigured", `${configPath}: ${configState.error}`))
    checks.push(createCheck("core.dataDir", "configured data dir", "skipped", "config is invalid"))
    checks.push(createCheck("core.db", "configured database", "skipped", "config is invalid"))
    checks.push(createCheck("core.migrations", "database migration level", "skipped", "config is invalid"))
    return checks
  }

  if (!config) {
    checks.push(createCheck("core.config", "config file", "unknown", `${configPath}: effective config could not be resolved`))
    checks.push(createCheck("core.dataDir", "configured data dir", "skipped", "effective config is unavailable"))
    checks.push(createCheck("core.db", "configured database", "skipped", "effective config is unavailable"))
    checks.push(createCheck("core.migrations", "database migration level", "skipped", "effective config is unavailable"))
    return checks
  }

  checks.push(createCheck("core.config", "config file", "ok", configPath))

  if (!existsSync(config.dataDir)) {
    checks.push(createCheck("core.dataDir", "configured data dir", "missing", config.dataDir))
  } else {
    try {
      accessSync(config.dataDir, constants.W_OK)
      checks.push(createCheck("core.dataDir", "configured data dir", "ok", config.dataDir))
    } catch (err) {
      checks.push(createCheck("core.dataDir", "configured data dir", "misconfigured", `${config.dataDir}: ${(err as Error).message}`))
    }
  }

  const dbPath = resolveConfiguredDbPath(config)
  if (!existsSync(dbPath)) {
    checks.push(createCheck("core.db", "configured database", "missing", dbPath))
    checks.push(createCheck("core.migrations", "database migration level", "skipped", "database file is missing"))
    return checks
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    db.prepare("SELECT 1").get()
    checks.push(createCheck("core.db", "configured database", "ok", dbPath))
    const userVersion = (db.pragma("user_version", { simple: true }) as number) ?? 0
    checks.push(createCheck(
      "core.migrations",
      "database migration level",
      userVersion === REQUIRED_MIGRATION_LEVEL ? "ok" : "misconfigured",
      `current=${userVersion}, required=${REQUIRED_MIGRATION_LEVEL}`
    ))
    db.close()
  } catch (err) {
    checks.push(createCheck("core.db", "configured database", "misconfigured", `${dbPath}: ${(err as Error).message}`))
    checks.push(createCheck("core.migrations", "database migration level", "skipped", "database is not readable"))
  }

  return checks
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
  const present = Boolean(process.env[def.apiKeyRef])
  return [
    cliCheck,
    createCheck(
      def.authId,
      `${def.label} auth`,
      present ? "ok" : "missing",
      present ? `${def.apiKeyRef} is set` : `${def.apiKeyRef} is not set`,
      present ? {} : { remedy: { hint: `Export ${def.apiKeyRef} before running BeerEngineer.` } }
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
    probeCommand("sonarqube-cli", ["--version"]),
  ])
  return [
    createCheck("review.coderabbit", "CodeRabbit CLI", coderabbit.ok ? "ok" : "missing", coderabbit.version ?? coderabbit.detail, {
      remedy: coderabbit.ok ? undefined : remedyForTool("coderabbit"),
    }),
    createCheck("review.sonar-scanner", "sonar-scanner", sonarScanner.ok ? "ok" : "missing", sonarScanner.version ?? sonarScanner.detail, {
      remedy: sonarScanner.ok ? undefined : remedyForTool("sonar-scanner"),
    }),
    createCheck("review.sonarqube-cli", "sonarqube-cli", sonarqubeCli.ok ? "ok" : "missing", sonarqubeCli.version ?? sonarqubeCli.detail, {
      remedy: sonarqubeCli.ok ? undefined : remedyForTool("sonarqube-cli"),
    }),
  ]
}

export async function generateSetupReport(options: DoctorOptions = {}): Promise<SetupReport> {
  const overrides = resolveOverrides(options.overrides)
  const configPath = resolveConfigPath(overrides)
  const configState = readConfigFile(configPath)
  const config = resolveMergedConfig(configState, overrides)
  const llmGroup = getActiveLlmGroup(configState.kind === "ok" ? config : null)

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
      active: llmGroup === "llm.anthropic" && Boolean(config),
      run: () => runLlmChecks("anthropic", config as AppConfig),
    },
    {
      id: "llm.openai",
      label: "OpenAI capability",
      level: "required",
      minOk: 2,
      active: llmGroup === "llm.openai" && Boolean(config),
      run: () => runLlmChecks("openai", config as AppConfig),
    },
    {
      id: "llm.opencode",
      label: "OpenCode capability",
      level: "required",
      minOk: 2,
      active: llmGroup === "llm.opencode" && Boolean(config),
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
      const detail = check.detail ? ` - ${check.detail}` : ""
      console.log(`    [${renderStatus(check.status)}] ${check.label}${detail}`)
      if (opts.installHints && check.status !== "ok" && check.remedy) {
        console.log(`      hint: ${check.remedy.hint}`)
        if (check.remedy.command) console.log(`      cmd:  ${check.remedy.command}`)
        if (check.remedy.url) console.log(`      url:  ${check.remedy.url}`)
      }
    }
  }
  console.log("")
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

function buildProvisionedConfig(overrides: SetupOverrides = {}): AppConfig {
  const resolved = resolveOverrides(overrides)
  const state = readConfigFile(resolveConfigPath(resolved))
  return resolveMergedConfig(state.kind === "invalid" ? { kind: "missing", path: state.path } : state, resolved) as AppConfig
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

export async function runSetupCommand(options: SetupRunOptions = {}): Promise<number> {
  let report = await generateSetupReport(options)
  printDoctorReport(report, { installHints: true })

  if (needsInitialization(report)) {
    ensureProvisionedState(options.overrides)
    console.log("  App setup initialized config, data dir, and database.")
    report = await generateSetupReport(options)
    printDoctorReport(report, { installHints: true })
  }

  const interactive = !options.noInteractive && Boolean(process.stdin.isTTY && process.stdout.isTTY)
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

export function cleanupProvisionedState(overrides: SetupOverrides = {}): void {
  const resolved = resolveOverrides(overrides)
  const state = readConfigFile(resolveConfigPath(resolved))
  const config = resolveMergedConfig(state.kind === "invalid" ? { kind: "missing", path: state.path } : state, resolved)
  if (config) {
    rmSync(resolveConfiguredDbPath(config), { force: true })
    rmSync(config.dataDir, { recursive: true, force: true })
  }
  rmSync(resolveConfigPath(resolved), { force: true })
}
