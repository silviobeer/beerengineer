import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { parseArgs, resolveItemReference, resolveUiWorkspacePath, runDoctor } from "../src/index.js"

test("parseArgs recognizes help, doctor, start ui, workflow, item action, and unknown commands", () => {
  assert.deepEqual(parseArgs([]), { kind: "workflow", json: false })
  assert.deepEqual(parseArgs(["--json"]), { kind: "workflow", json: true })
  assert.deepEqual(parseArgs(["run", "--json"]), { kind: "workflow", json: true })
  assert.deepEqual(parseArgs(["--help"]), { kind: "help" })
  assert.deepEqual(parseArgs(["-h"]), { kind: "help" })
  assert.deepEqual(parseArgs(["--doctor"]), { kind: "doctor" })
  assert.deepEqual(parseArgs(["start", "ui"]), { kind: "start-ui" })
  assert.deepEqual(parseArgs(["item", "action", "--item", "ITEM-0001", "--action", "start_brainstorm"]), {
    kind: "item-action",
    itemRef: "ITEM-0001",
    action: "start_brainstorm"
  })
  assert.deepEqual(parseArgs(["item", "action"]), { kind: "unknown", token: "item action" })
  assert.deepEqual(parseArgs(["wat"]), { kind: "unknown", token: "wat" })
})

test("runDoctor succeeds when the database schema and UI workspace are present", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  const previousDbPath = process.env.BEERENGINEER_UI_DB_PATH

  try {
    const dbPath = join(dir, "doctor.sqlite")
    process.env.BEERENGINEER_UI_DB_PATH = dbPath
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    repos.upsertWorkspace({ key: "default", name: "Default Workspace" })
    db.close()

    assert.equal(resolveUiWorkspacePath().endsWith("/apps/ui"), true)
    assert.equal(await runDoctor(), 0)
  } finally {
    if (previousDbPath === undefined) delete process.env.BEERENGINEER_UI_DB_PATH
    else process.env.BEERENGINEER_UI_DB_PATH = previousDbPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("resolveItemReference rejects ambiguous item codes across workspaces", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cli-"))
  try {
    const db = initDatabase(join(dir, "items.sqlite"))
    const repos = new Repos(db)
    const w1 = repos.upsertWorkspace({ key: "w1", name: "W1" })
    const w2 = repos.upsertWorkspace({ key: "w2", name: "W2" })
    repos.createItem({ workspaceId: w1.id, code: "ITEM-0001", title: "A", description: "" })
    repos.createItem({ workspaceId: w2.id, code: "ITEM-0001", title: "B", description: "" })

    const resolved = resolveItemReference(repos, "ITEM-0001")
    assert.equal(resolved.kind, "ambiguous")
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("beerengineer bin shim runs the TypeScript entrypoint", () => {
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  const binPath = resolve(engineRoot, "bin/beerengineer.js")
  const result = spawnSync(process.execPath, [binPath, "--help"], {
    cwd: engineRoot,
    encoding: "utf8",
  })

  assert.equal(result.status, 0)
  assert.match(`${result.stdout ?? ""}${result.stderr ?? ""}`, /BeerEngineer2 CLI/)
})
