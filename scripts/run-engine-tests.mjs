#!/usr/bin/env node
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { createServer } from "node:net"
import { dirname, join, sep } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const engineRoot = join(repoRoot, "apps", "engine")
const testDir = join(engineRoot, "test")
const manifestPath = join(testDir, "_mode-manifest.json")

const integrationLegacyBasenames = new Set([
  "apiIntegration.test.ts",
  "baseBranch.test.ts",
  "cli-actions.test.ts",
  "cli-navigation.test.ts",
  "cli.test.ts",
  "executionSequential.test.ts",
  "git.test.ts",
  "gitInspect.test.ts",
  "managedInstallDiagnostics.test.ts",
  "managedInstallDocs.test.ts",
  "managedInstallDownload.test.ts",
  "managedInstallEntrypoint.test.ts",
  "managedInstallLock.test.ts",
  "managedInstallPath.test.ts",
  "managedInstallPrerequisites.test.ts",
  "managedInstallRelease.test.ts",
  "managedInstallState.test.ts",
  "managedInstallValidation.test.ts",
  "managedInstallWorkflow.test.ts",
  "resume.test.ts",
  "setupTaskCommit.test.ts",
  "updateMode.test.ts",
  "updateSwitcher.test.ts",
  "workflowE2E.test.ts",
  "workspaces.test.ts",
])

const sonarCoverageSkipBasenames = new Set([
  "messagingLevel.test.ts",
  "resume.test.ts",
  "sdkLive.test.ts",
  "workflowE2E.test.ts",
])

function toPosix(p) {
  return p.split(sep).join("/")
}

function basename(rel) {
  const idx = rel.lastIndexOf("/")
  return idx === -1 ? rel : rel.slice(idx + 1)
}

function discoverAllTests() {
  const entries = readdirSync(testDir, { recursive: true, withFileTypes: true })
  const result = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith(".test.ts")) continue
    const parent = entry.parentPath ?? entry.path
    const abs = join(parent, entry.name)
    const rel = toPosix(abs.slice(engineRoot.length + 1))
    result.push(rel)
  }
  return result.sort()
}

function loadManifest() {
  let text
  try {
    text = readFileSync(manifestPath, "utf8")
  } catch (err) {
    if (err.code === "ENOENT") return { integrationOnly: [], sonarCoverageOnly: [] }
    throw err
  }
  const parsed = JSON.parse(text)
  return {
    integrationOnly: parsed.integrationOnly ?? [],
    sonarCoverageOnly: parsed.sonarCoverageOnly ?? [],
  }
}

function selectedTests(mode) {
  const all = discoverAllTests()
  const manifest = loadManifest()
  const integrationOnly = new Set(manifest.integrationOnly.map(e => e.path))
  const sonarCoverageOnly = new Set(manifest.sonarCoverageOnly.map(e => e.path))

  if (mode === "all") {
    return all.filter(p => !integrationOnly.has(p) && !sonarCoverageOnly.has(p))
  }
  if (mode === "unit") {
    return all.filter(p => {
      if (integrationOnly.has(p) || sonarCoverageOnly.has(p)) return false
      if (integrationLegacyBasenames.has(basename(p))) return false
      if (basename(p) === "sdkLive.test.ts") return false
      return true
    })
  }
  if (mode === "integration") {
    return all.filter(p => integrationOnly.has(p) || integrationLegacyBasenames.has(basename(p)))
  }
  if (mode === "managed-install") {
    return all.filter(p => /(^|\/)managedInstall[A-Z]/.test(p))
  }
  if (mode === "sonar-coverage") {
    return all.filter(p => !sonarCoverageSkipBasenames.has(basename(p)))
  }
  throw new Error(`Unknown test mode: ${mode}`)
}

function applyTestSelectionFilter(files) {
  const raw = process.env.BEERENGINEER_TEST_SELECTION
  if (!raw) return files
  const selected = new Set(
    raw.split(",")
      .map(value => value.trim())
      .filter(Boolean),
  )
  return files.filter(file => selected.has(file))
}

const mode = process.argv[2] ?? "all"
const files = applyTestSelectionFilter(selectedTests(mode))
const nodeArgs = ["--test", "--import", "tsx"]
const telegramOverrideEnvKeys = [
  "BEERENGINEER_TELEGRAM_ENABLED",
  "BEERENGINEER_TELEGRAM_BOT_TOKEN_ENV",
  "BEERENGINEER_TELEGRAM_DEFAULT_CHAT_ID",
  "BEERENGINEER_TELEGRAM_LEVEL",
  "BEERENGINEER_TELEGRAM_INBOUND_ENABLED",
  "BEERENGINEER_TELEGRAM_WEBHOOK_SECRET_ENV",
]

function testEnvBase() {
  const env = { ...process.env }
  for (const key of telegramOverrideEnvKeys) {
    delete env[key]
  }
  delete env.NODE_TEST_CONTEXT
  env.BEERENGINEER_TEST_DISABLE_REAL_TELEGRAM = "1"
  return env
}

async function allocateEnginePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate engine test port")))
        return
      }
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function isolatedTestEnv() {
  const env = testEnvBase()
  if (process.env.BEERENGINEER_TEST_USE_REAL_CONFIG === "1") return env

  const dir = mkdtempSync(join(tmpdir(), "be2-engine-tests-"))
  const dataDir = join(dir, "data")
  const configPath = join(dir, "config.json")
  const xdgStateHome = join(dir, "state")
  const enginePort = await allocateEnginePort()

  writeFileSync(
    configPath,
    `${JSON.stringify({
      schemaVersion: 1,
      dataDir,
      allowedRoots: [repoRoot],
      enginePort,
      llm: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        apiKeyRef: "ANTHROPIC_API_KEY",
        defaultHarnessProfile: { mode: "claude-first" },
      },
      notifications: {
        telegram: {
          enabled: false,
          level: 2,
          inbound: { enabled: false },
        },
      },
      vcs: { github: { enabled: false } },
      browser: { enabled: false },
    }, null, 2)}\n`,
    "utf8",
  )

  return {
    ...env,
    BEERENGINEER_CONFIG_PATH: configPath,
    XDG_STATE_HOME: xdgStateHome,
  }
}

if (process.argv.includes("--list") || process.argv.includes("--dry-run")) {
  console.log(files.join("\n"))
  process.exit(0)
}

if (mode === "integration" || mode === "sonar-coverage") {
  nodeArgs.splice(1, 0, "--test-concurrency=1")
}

// Emit a stable, machine-greppable selection manifest before running. Node's
// default TAP reporter omits file paths for passing tests, so this header is
// the only way callers (acceptance scripts, fitness checks) can verify which
// files the runner actually selected from the on-disk discovery.
console.log(`# engine-tests: mode=${mode} selected=${files.length}`)
for (const f of files) console.log(`# selected: ${f}`)

const result = spawnSync(process.execPath, [...nodeArgs, ...files], {
  cwd: engineRoot,
  env: await isolatedTestEnv(),
  stdio: "inherit",
})

process.exit(result.status ?? 1)
