import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { optionalSecretGate } from "../src/setup/secretMetadata.js"
import { markSecretTested, storeSecret } from "../src/setup/secretStore.js"

function tempSecretStore() {
  const dir = mkdtempSync(join(tmpdir(), "be2-optional-secret-"))
  return { dir, storePath: join(dir, "secrets.json") }
}

test("AC-18 missing optional secrets do not block required gates", () => {
  const paths = tempSecretStore()
  try {
    const gate = optionalSecretGate("telegram", { storePath: paths.storePath })
    assert.equal(gate.status, "skipped")
    assert.equal(gate.skippable, true)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-19 optional secret readiness distinguishes skipped, configured, and failed", () => {
  const paths = tempSecretStore()
  try {
    storeSecret("configured", "secret", { storePath: paths.storePath })
    storeSecret("failed", "secret", { storePath: paths.storePath })
    markSecretTested("failed", "suspicious", { storePath: paths.storePath })

    assert.equal(optionalSecretGate("missing", { storePath: paths.storePath }).status, "skipped")
    assert.equal(optionalSecretGate("configured", { storePath: paths.storePath }).status, "configured")
    assert.equal(optionalSecretGate("failed", { storePath: paths.storePath }).status, "failed")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-20 optional gate metadata lets the UI enable Skip", () => {
  const paths = tempSecretStore()
  try {
    const gate = optionalSecretGate("telegram", { storePath: paths.storePath })
    assert.equal(gate.skippable, true)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})
