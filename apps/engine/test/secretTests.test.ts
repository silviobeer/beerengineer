import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { runSecretTest } from "../src/setup/secretTests.js"
import { readActiveSecretValue, storeSecret } from "../src/setup/secretStore.js"

function tempSecretStore() {
  const dir = mkdtempSync(join(tmpdir(), "be2-secret-tests-"))
  return { dir, storePath: join(dir, "secrets.json") }
}

test("AC-14 secret tests inject stored values into controlled checks", async () => {
  const paths = tempSecretStore()
  try {
    storeSecret("sonar", "valid-token", { storePath: paths.storePath })
    const result = await runSecretTest("sonar", { storePath: paths.storePath })

    assert.equal(result.ok, true)
    assert.equal(result.status, "valid")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-15 explicit invalid tests can disable known-bad secrets", async () => {
  const paths = tempSecretStore()
  try {
    storeSecret("sonar", "invalid-token", { storePath: paths.storePath })
    const result = await runSecretTest("sonar", { storePath: paths.storePath })

    assert.equal(result.status, "invalid")
    assert.equal(readActiveSecretValue("sonar", { storePath: paths.storePath }), null)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-16 transient failures do not automatically disable secrets", async () => {
  const paths = tempSecretStore()
  try {
    storeSecret("sonar", "transient-token", { storePath: paths.storePath })
    const result = await runSecretTest("sonar", { storePath: paths.storePath })

    assert.equal(result.status, "transient")
    assert.equal(readActiveSecretValue("sonar", { storePath: paths.storePath }), "transient-token")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-17 secret test results are UI-safe and redacted", async () => {
  const paths = tempSecretStore()
  try {
    storeSecret("sonar", "valid-secret-sentinel", { storePath: paths.storePath })
    const result = await runSecretTest("sonar", { storePath: paths.storePath })

    assert.doesNotMatch(JSON.stringify(result), /valid-secret-sentinel/)
    assert.match(result.message, /valid/i)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})
