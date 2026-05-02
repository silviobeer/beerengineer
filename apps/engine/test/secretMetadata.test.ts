import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { applySecretAction } from "../src/setup/secretActions.js"
import { optionalSecretGate, readSecretMetadata } from "../src/setup/secretMetadata.js"
import { markSecretTested, storeSecret } from "../src/setup/secretStore.js"

function tempSecretStore() {
  const dir = mkdtempSync(join(tmpdir(), "be2-secret-metadata-"))
  return { dir, storePath: join(dir, "secrets.json") }
}

test("AC-5 secret metadata distinguishes missing, active, disabled, invalid, suspicious, and unknown", () => {
  const paths = tempSecretStore()
  try {
    storeSecret("active", "secret", { storePath: paths.storePath })
    storeSecret("disabled", "secret", { storePath: paths.storePath })
    applySecretAction("disabled", { action: "disable" }, { storePath: paths.storePath })
    storeSecret("invalid", "secret", { storePath: paths.storePath })
    markSecretTested("invalid", "invalid", { storePath: paths.storePath })
    storeSecret("suspicious", "secret", { storePath: paths.storePath })
    markSecretTested("suspicious", "suspicious", { storePath: paths.storePath })
    storeSecret("unknown", "secret", { storePath: paths.storePath })
    markSecretTested("unknown", "unknown", { storePath: paths.storePath })

    assert.equal(readSecretMetadata("missing", { storePath: paths.storePath }).status, "missing")
    assert.equal(readSecretMetadata("active", { storePath: paths.storePath }).status, "active")
    assert.equal(readSecretMetadata("disabled", { storePath: paths.storePath }).status, "disabled")
    assert.equal(readSecretMetadata("invalid", { storePath: paths.storePath }).status, "invalid")
    assert.equal(readSecretMetadata("suspicious", { storePath: paths.storePath }).status, "suspicious")
    assert.equal(readSecretMetadata("unknown", { storePath: paths.storePath }).status, "unknown")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-6 metadata includes updated and last-tested timestamps when present", () => {
  const paths = tempSecretStore()
  try {
    storeSecret("sonar", "secret", { storePath: paths.storePath })
    markSecretTested("sonar", "valid", { storePath: paths.storePath })
    const metadata = readSecretMetadata("sonar", { storePath: paths.storePath })

    assert.equal(typeof metadata.updatedAt, "number")
    assert.equal(typeof metadata.lastTestedAt, "number")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-7 redaction holds for metadata and error-like missing responses", () => {
  const paths = tempSecretStore()
  try {
    storeSecret("telegram", "telegram-secret-sentinel", { storePath: paths.storePath })
    const metadata = readSecretMetadata("telegram", { storePath: paths.storePath })
    const missing = readSecretMetadata("missing", { storePath: paths.storePath })

    assert.doesNotMatch(JSON.stringify(metadata), /telegram-secret-sentinel/)
    assert.doesNotMatch(JSON.stringify(missing), /secret-sentinel/)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-8 optional-service readiness can use metadata without cleartext", () => {
  const paths = tempSecretStore()
  try {
    storeSecret("telegram", "telegram-secret-sentinel", { storePath: paths.storePath })
    const gate = optionalSecretGate("telegram", { storePath: paths.storePath })

    assert.equal(gate.status, "configured")
    assert.doesNotMatch(JSON.stringify(gate), /telegram-secret-sentinel/)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})
