import { test } from "node:test"
import assert from "node:assert/strict"
import Database from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildHealthResponse, probeDb } from "../../src/api/health.js"

test("probeDb returns ok for an open SQLite connection", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-health-open-"))
  const db = new Database(join(dir, "db.sqlite"))
  try {
    assert.equal(probeDb(db), "ok")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("probeDb returns failed for a closed SQLite connection", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-health-closed-"))
  const db = new Database(join(dir, "db.sqlite"))
  db.close()
  try {
    assert.equal(probeDb(db), "failed")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("buildHealthResponse returns 503 without DB error details when SQLite probe fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-health-response-"))
  const db = new Database(join(dir, "db.sqlite"))
  db.close()
  try {
    const response = buildHealthResponse(db)
    assert.equal(response.status, 503)
    assert.deepEqual(Object.keys(response.body).sort(), ["db", "ok", "service", "uptimeMs"].sort())
    assert.equal(response.body.ok, false)
    assert.equal(response.body.service, "beerengineer-engine")
    assert.equal(response.body.db, "failed")
    assert.equal(typeof response.body.uptimeMs, "number")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("buildHealthResponse remains limited to process and DB liveness fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-health-contract-"))
  const db = new Database(join(dir, "db.sqlite"))
  try {
    const response = buildHealthResponse(db)
    assert.equal(response.status, 200)
    assert.deepEqual(Object.keys(response.body).sort(), ["db", "ok", "service", "uptimeMs"].sort())
    assert.equal(response.body.service, "beerengineer-engine")
    assert.equal(response.body.db, "ok")
    assert.equal(typeof response.body.uptimeMs, "number")
    assert.equal("leaseWrite" in response.body, false)
    assert.equal("startupRecovery" in response.body, false)
    assert.equal("shutdown" in response.body, false)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
