import Database from "better-sqlite3"
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { applySchema, initDatabase, resolveDbPathInfo } from "../src/db/connection.js"
import { resolveLegacyDbCleanupLogPath } from "../src/db/legacyDbReconciler.js"
import { Repos } from "../src/db/repositories.js"
import { buildUpdateStatus, assertUpdateSafety } from "../src/core/updateMode/status.js"
import { CONFIG_SCHEMA_VERSION, type AppConfig } from "../src/setup/config.js"

const LEGACY_DB_PATH = () => resolve(homedir(), ".local", "share", "beerengineer", "beerengineer.sqlite")

let tmpRoot: string
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "be2-legacy-db-"))
  savedEnv = {
    HOME: process.env.HOME,
    BEERENGINEER_CONFIG_PATH: process.env.BEERENGINEER_CONFIG_PATH,
    BEERENGINEER_UI_DB_PATH: process.env.BEERENGINEER_UI_DB_PATH,
  }
  process.env.HOME = join(tmpRoot, "home")
  delete process.env.BEERENGINEER_CONFIG_PATH
  delete process.env.BEERENGINEER_UI_DB_PATH
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(tmpRoot, { recursive: true, force: true })
})

test("legacy item rows prevent automatic cleanup and append one skipped-non-empty event", () => {
  const dataDir = mkdtempSync(join(tmpRoot, "data-"))
  seedConfiguredDb(dataDir)
  seedLegacyItemOnlyDb()
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpRoot, dataDir)

  initDatabase().close()

  assert.equal(existsSync(LEGACY_DB_PATH()), true)
  assert.match(resolveDbPathInfo().warnings[0] ?? "", /^legacy-db-shadow:/)
  assert.deepEqual(
    readCleanupEvents(dataDir).map(event => event.outcome),
    ["skipped-non-empty"],
  )
})

test("legacy run rows prevent automatic cleanup and preserve sibling files", () => {
  const dataDir = mkdtempSync(join(tmpRoot, "data-"))
  seedConfiguredDb(dataDir)
  seedLegacyRunOnlyDb()
  writeFileSync(`${LEGACY_DB_PATH()}-wal`, "wal\n", "utf8")
  writeFileSync(`${LEGACY_DB_PATH()}-shm`, "shm\n", "utf8")
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpRoot, dataDir)

  initDatabase().close()

  assert.equal(existsSync(LEGACY_DB_PATH()), true)
  assert.equal(existsSync(`${LEGACY_DB_PATH()}-wal`), true)
  assert.equal(existsSync(`${LEGACY_DB_PATH()}-shm`), true)
  assert.deepEqual(
    readCleanupEvents(dataDir).map(event => event.outcome),
    ["skipped-non-empty"],
  )
})

test("missing configured DB keeps an empty legacy family in place and logs skipped-no-configured-db", () => {
  const dataDir = mkdtempSync(join(tmpRoot, "data-"))
  seedEmptyLegacyDb()
  writeFileSync(`${LEGACY_DB_PATH()}-wal`, "wal\n", "utf8")
  writeFileSync(`${LEGACY_DB_PATH()}-shm`, "shm\n", "utf8")
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpRoot, dataDir)

  initDatabase().close()

  assert.equal(existsSync(LEGACY_DB_PATH()), true)
  assert.equal(existsSync(`${LEGACY_DB_PATH()}-wal`), true)
  assert.equal(existsSync(`${LEGACY_DB_PATH()}-shm`), true)
  assert.match(resolveDbPathInfo().warnings[0] ?? "", /^legacy-db-shadow:/)
  assert.deepEqual(
    readCleanupEvents(dataDir).map(event => event.outcome),
    ["skipped-no-configured-db"],
  )
})

test("empty legacy family is removed, warning is suppressed, and one cleaned event is logged", () => {
  const dataDir = mkdtempSync(join(tmpRoot, "data-"))
  seedConfiguredDb(dataDir)
  seedEmptyLegacyDb()
  writeFileSync(`${LEGACY_DB_PATH()}-wal`, "wal\n", "utf8")
  writeFileSync(`${LEGACY_DB_PATH()}-shm`, "shm\n", "utf8")
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpRoot, dataDir)

  initDatabase().close()

  assert.equal(existsSync(LEGACY_DB_PATH()), false)
  assert.equal(existsSync(`${LEGACY_DB_PATH()}-wal`), false)
  assert.equal(existsSync(`${LEGACY_DB_PATH()}-shm`), false)
  assert.deepEqual(resolveDbPathInfo().warnings, [])
  const [event] = readCleanupEvents(dataDir)
  assert.equal(readCleanupEvents(dataDir).length, 1)
  assert.equal(event?.event, "legacy-db-cleanup")
  assert.equal(event?.configuredDbPath, join(dataDir, "beerengineer.sqlite"))
  assert.equal(event?.legacyDbPath, LEGACY_DB_PATH())
  assert.equal(event?.outcome, "cleaned")
  assert.match(event?.timestamp ?? "", /^\d{4}-\d{2}-\d{2}T/)
})

test("corrupt legacy DB stays visible and blocks update preflight", () => {
  const control = initDatabase(":memory:")
  const repos = new Repos(control)
  const dataDir = mkdtempSync(join(tmpRoot, "data-"))
  seedConfiguredDb(dataDir)
  mkdirSync(resolve(LEGACY_DB_PATH(), ".."), { recursive: true })
  writeFileSync(LEGACY_DB_PATH(), "not sqlite", "utf8")
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpRoot, dataDir)

  const status = buildUpdateStatus(repos, buildAppConfig(dataDir))

  assert.match(status.warnings[0] ?? "", /^legacy-db-shadow:/)
  assert.throws(() => assertUpdateSafety(status), /update_preflight_failed:legacy_db_shadow/)
  assert.deepEqual(
    readCleanupEvents(dataDir).map(event => event.outcome),
    ["skipped-unreadable"],
  )
  control.close()
})

test("failed deletion stays visible, blocks update preflight, and logs once", () => {
  const control = initDatabase(":memory:")
  const repos = new Repos(control)
  const dataDir = mkdtempSync(join(tmpRoot, "data-"))
  seedConfiguredDb(dataDir)
  seedBareLegacyDb()
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpRoot, dataDir)
  const legacyDir = resolve(LEGACY_DB_PATH(), "..")
  chmodSync(legacyDir, 0o555)

  try {
    const status = buildUpdateStatus(repos, buildAppConfig(dataDir))
    assert.match(status.warnings[0] ?? "", /^legacy-db-shadow:/)
    assert.throws(() => assertUpdateSafety(status), /update_preflight_failed:legacy_db_shadow/)
    assert.deepEqual(
      readCleanupEvents(dataDir).map(event => event.outcome),
      ["failed-deletion"],
    )
    assert.equal(existsSync(LEGACY_DB_PATH()), true)
  } finally {
    chmodSync(legacyDir, 0o755)
    control.close()
  }
})

test("one process reuses the first non-success verdict without duplicate cleanup events", () => {
  const control = initDatabase(":memory:")
  const repos = new Repos(control)
  const dataDir = mkdtempSync(join(tmpRoot, "data-"))
  seedConfiguredDb(dataDir)
  seedLegacyItemOnlyDb()
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpRoot, dataDir)

  const status = buildUpdateStatus(repos, buildAppConfig(dataDir))
  initDatabase().close()

  assert.match(status.warnings[0] ?? "", /^legacy-db-shadow:/)
  assert.equal(readCleanupEvents(dataDir).length, 1)
  control.close()
})

test("explicit override DB opens do not trigger legacy shadow reconciliation", () => {
  const dataDir = mkdtempSync(join(tmpRoot, "data-"))
  seedConfiguredDb(dataDir)
  seedEmptyLegacyDb()
  process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpRoot, dataDir)

  initDatabase(join(tmpRoot, "override.sqlite")).close()

  assert.equal(existsSync(LEGACY_DB_PATH()), true)
  assert.deepEqual(readCleanupEvents(dataDir), [])
})

test("missing wal or shm siblings do not block cleaned cleanup outcomes", () => {
  const scenarios: Array<{
    name: string
    createSiblings: () => void
    expectedRemovedPaths: string[]
  }> = [
    {
      name: "sqlite only",
      createSiblings: () => {},
      expectedRemovedPaths: [LEGACY_DB_PATH()],
    },
    {
      name: "sqlite plus wal",
      createSiblings: () => {
        writeFileSync(`${LEGACY_DB_PATH()}-wal`, "wal\n", "utf8")
      },
      expectedRemovedPaths: [LEGACY_DB_PATH(), `${LEGACY_DB_PATH()}-wal`],
    },
  ]

  for (const scenario of scenarios) {
    const dataDir = mkdtempSync(join(tmpRoot, "data-"))
    seedConfiguredDb(dataDir)
    seedEmptyLegacyDb()
    scenario.createSiblings()
    process.env.BEERENGINEER_CONFIG_PATH = writeTmpConfig(tmpRoot, dataDir)

    initDatabase().close()

    for (const target of scenario.expectedRemovedPaths) {
      assert.equal(existsSync(target), false, `${scenario.name} should remove ${target}`)
    }
    assert.deepEqual(resolveDbPathInfo().warnings, [], `${scenario.name} should not warn after cleanup`)
    assert.deepEqual(
      readCleanupEvents(dataDir).map(event => event.outcome),
      ["cleaned"],
      `${scenario.name} should log a cleaned outcome`,
    )
  }
})

function writeTmpConfig(root: string, dataDir: string): string {
  const configPath = join(root, "config.json")
  writeFileSync(configPath, JSON.stringify(buildAppConfig(dataDir), null, 2), "utf8")
  return configPath
}

function buildAppConfig(dataDir: string): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    dataDir,
    allowedRoots: [tmpRoot],
    enginePort: 4100,
    llm: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
    },
    notifications: { telegram: { enabled: false, level: 2, inbound: { enabled: false } } },
    vcs: { github: { enabled: false } },
    recovery: { startupAutoResume: true },
    browser: { enabled: false },
  }
}

function seedConfiguredDb(dataDir: string): void {
  initDatabase(join(dataDir, "beerengineer.sqlite")).close()
}

function seedEmptyLegacyDb(): void {
  initDatabase(LEGACY_DB_PATH()).close()
}

function seedBareLegacyDb(): void {
  mkdirSync(resolve(LEGACY_DB_PATH(), ".."), { recursive: true })
  const db = new Database(LEGACY_DB_PATH())
  applySchema(db)
  db.close()
}

function seedLegacyItemOnlyDb(): void {
  const db = initDatabase(LEGACY_DB_PATH())
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "legacy", name: "Legacy", rootPath: tmpRoot })
  repos.createItem({ workspaceId: workspace.id, code: "ITEM-0001", title: "Legacy item", description: "shadow" })
  db.close()
}

function seedLegacyRunOnlyDb(): void {
  const db = initDatabase(LEGACY_DB_PATH())
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "legacy", name: "Legacy", rootPath: tmpRoot })
  const item = repos.createItem({ workspaceId: workspace.id, code: "ITEM-0001", title: "Legacy item", description: "shadow" })
  repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title, owner: "cli" })
  db.close()
}

function readCleanupEvents(dataDir: string): Array<{
  event: string
  configuredDbPath: string
  legacyDbPath: string
  outcome: string
  timestamp?: string
}> {
  const logPath = resolveLegacyDbCleanupLogPath(dataDir)
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as {
      event: string
      configuredDbPath: string
      legacyDbPath: string
      outcome: string
      timestamp?: string
    })
}
