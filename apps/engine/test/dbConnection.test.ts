import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join, resolve } from "node:path"

import { resolveDbPath } from "../src/db/connection.js"
import { CONFIG_SCHEMA_VERSION } from "../src/setup/config.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTmpConfig(dir: string, dataDir: string): string {
  const configPath = join(dir, "config.json")
  const config = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    dataDir,
    allowedRoots: ["/tmp"],
    enginePort: 4100,
    llm: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
    },
    notifications: { telegram: { enabled: false, level: 2, inbound: { enabled: false } } },
    vcs: { github: { enabled: false } },
    browser: { enabled: false },
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8")
  return configPath
}

function capturingStderr(fn: () => void): string {
  const chunks: string[] = []
  const originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalWrite as any)(chunk, ...rest)
  }
  try {
    fn()
  } finally {
    process.stderr.write = originalWrite
  }
  return chunks.join("")
}

const LEGACY_DB_PATH = resolve(homedir(), ".local", "share", "beerengineer", "beerengineer.sqlite")

// ---------------------------------------------------------------------------
// Environment isolation
// ---------------------------------------------------------------------------

let tmpDir: string
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "beer-db-test-"))
  savedEnv = {
    BEERENGINEER_UI_DB_PATH: process.env.BEERENGINEER_UI_DB_PATH,
    BEERENGINEER_CONFIG_PATH: process.env.BEERENGINEER_CONFIG_PATH,
  }
  delete process.env.BEERENGINEER_UI_DB_PATH
  delete process.env.BEERENGINEER_CONFIG_PATH
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key as keyof NodeJS.ProcessEnv]
    } else {
      process.env[key as keyof NodeJS.ProcessEnv] = val
    }
  }
})

// ---------------------------------------------------------------------------
// Tier 1: explicit override argument wins everything
// ---------------------------------------------------------------------------

test("resolveDbPath - tier 1: explicit override takes precedence over env var and config", () => {
  const explicit = join(tmpDir, "explicit.sqlite")
  process.env.BEERENGINEER_UI_DB_PATH = join(tmpDir, "should-not-win.sqlite")
  const configDataDir = mkdtempSync(join(tmpDir, "data-"))
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpDir, configDataDir)

  const result = resolveDbPath(explicit)
  assert.equal(result, explicit)
})

// ---------------------------------------------------------------------------
// Tier 2: BEERENGINEER_UI_DB_PATH wins when no explicit override
// ---------------------------------------------------------------------------

test("resolveDbPath - tier 2: env var wins when no explicit override", () => {
  const envPath = join(tmpDir, "env-db.sqlite")
  process.env.BEERENGINEER_UI_DB_PATH = envPath
  const configDataDir = mkdtempSync(join(tmpDir, "data-"))
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpDir, configDataDir)

  const result = resolveDbPath()
  assert.equal(result, envPath)
})

// ---------------------------------------------------------------------------
// Tier 3: config dataDir used when no override and no env var
// ---------------------------------------------------------------------------

test("resolveDbPath - tier 3: config dataDir used when no override or env var", () => {
  const configDataDir = mkdtempSync(join(tmpDir, "data-"))
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpDir, configDataDir)

  const result = resolveDbPath()
  assert.equal(result, resolve(configDataDir, "beerengineer.sqlite"))
})

test("resolveDbPath - tier 3: no spurious legacy warning when config is valid", () => {
  const configDataDir = mkdtempSync(join(tmpDir, "data-"))
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpDir, configDataDir)

  const stderr = capturingStderr(() => resolveDbPath())
  assert.ok(
    !stderr.includes("fell back to legacy location"),
    `Unexpected legacy-location warning when config is valid: ${stderr}`,
  )
})

// ---------------------------------------------------------------------------
// Tier 4: fall back to legacy path when config is missing
// ---------------------------------------------------------------------------

test("resolveDbPath - tier 4: falls back to legacy path when config absent, warns to stderr", () => {
  process.env.BEERENGINEER_CONFIG_PATH = join(tmpDir, "nonexistent-config.json")

  let result: string | undefined
  const stderr = capturingStderr(() => { result = resolveDbPath() })

  assert.equal(result, LEGACY_DB_PATH)
  assert.ok(
    stderr.includes("fell back to legacy location"),
    `Expected legacy-location warning on stderr but got: ${JSON.stringify(stderr)}`,
  )
})

// ---------------------------------------------------------------------------
// Ambiguity warning: both legacy and config DB exist at startup
// ---------------------------------------------------------------------------

test("resolveDbPath - tier 3: warns about ambiguity when both legacy and config DB exist", (t) => {
  const configDataDir = mkdtempSync(join(tmpDir, "data-"))
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpDir, configDataDir)

  // Create the configured DB file.
  const configDb = resolve(configDataDir, "beerengineer.sqlite")
  writeFileSync(configDb, "")

  // Only create the legacy file when it does not already exist on this machine,
  // so we don't destroy real local data during a test run.
  const legacyAlreadyExisted = existsSync(LEGACY_DB_PATH)
  if (!legacyAlreadyExisted) {
    mkdirSync(resolve(homedir(), ".local", "share", "beerengineer"), { recursive: true })
    writeFileSync(LEGACY_DB_PATH, "")
    t.after(() => {
      try { rmSync(LEGACY_DB_PATH) } catch { /* best-effort */ }
    })
  }

  const stderr = capturingStderr(() => resolveDbPath())
  assert.ok(
    stderr.includes("ambig") || stderr.includes("both"),
    `Expected ambiguity warning on stderr but got: ${JSON.stringify(stderr)}`,
  )
})
