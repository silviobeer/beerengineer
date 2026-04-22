import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { WorkflowIO } from "../src/core/io.js"
import { createApiIOSession } from "../src/core/ioApi.js"
import { createCliIO } from "../src/core/ioCli.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

/**
 * Contract test: `ioApi` and `ioCli` must both satisfy the WorkflowIO shape
 * the orchestrator depends on. A drift between adapters causes one surface to
 * silently fail at runtime — the contract check locks the obligations.
 */

const REQUIRED_METHODS = ["ask", "emit"] as const

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-iocontract-"))
  return initDatabase(join(dir, "test.sqlite"))
}

function assertSatisfiesWorkflowIO(io: WorkflowIO, label: string): void {
  for (const method of REQUIRED_METHODS) {
    assert.equal(typeof io[method], "function", `${label} missing ${method}`)
  }
  // `close` is optional but, if present, must be a function.
  if (io.close !== undefined) {
    assert.equal(typeof io.close, "function", `${label} close must be a function`)
  }
}

test("ioApi satisfies WorkflowIO contract", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const session = createApiIOSession(repos)
    assertSatisfiesWorkflowIO(session.io, "ioApi")
    session.dispose()
  } finally {
    db.close()
  }
})

test("ioCli satisfies WorkflowIO contract", () => {
  const io = createCliIO()
  try {
    assertSatisfiesWorkflowIO(io, "ioCli")
  } finally {
    io.close?.()
  }
})

test("ioCli with repos argument still satisfies contract and does not require an active run for ask wiring", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const io = createCliIO(repos)
    assertSatisfiesWorkflowIO(io, "ioCli(repos)")
    io.close?.()
  } finally {
    db.close()
  }
})
