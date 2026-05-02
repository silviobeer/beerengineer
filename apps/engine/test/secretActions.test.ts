import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { applySecretAction } from "../src/setup/secretActions.js"
import { getSecretMetadata } from "../src/setup/secretStore.js"

function tempSecretStore() {
  const dir = mkdtempSync(join(tmpdir(), "be2-secret-actions-"))
  return { dir, storePath: join(dir, "secrets.json") }
}

test("AC-9 replace stores the new value without echoing old or new plaintext", () => {
  const paths = tempSecretStore()
  try {
    applySecretAction("sonar.token", { action: "replace", value: "old-secret" }, { storePath: paths.storePath })
    const result = applySecretAction("sonar.token", { action: "replace", value: "new-secret" }, { storePath: paths.storePath })

    assert.equal(result.ok, true)
    assert.doesNotMatch(JSON.stringify(result), /old-secret|new-secret/)
    assert.equal(result.secret.status, "active")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-10 disable keeps the value but marks it inactive", () => {
  const paths = tempSecretStore()
  try {
    applySecretAction("sonar.token", { action: "replace", value: "secret" }, { storePath: paths.storePath })
    const result = applySecretAction("sonar.token", { action: "disable" }, { storePath: paths.storePath })

    assert.equal(result.ok, true)
    assert.equal(result.secret.status, "disabled")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-11 reactivate makes a disabled existing value active again", () => {
  const paths = tempSecretStore()
  try {
    applySecretAction("sonar.token", { action: "replace", value: "secret" }, { storePath: paths.storePath })
    applySecretAction("sonar.token", { action: "disable" }, { storePath: paths.storePath })
    const result = applySecretAction("sonar.token", { action: "reactivate" }, { storePath: paths.storePath })

    assert.equal(result.ok, true)
    assert.equal(result.secret.status, "active")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-12 delete removes the stored value and reports missing afterwards", () => {
  const paths = tempSecretStore()
  try {
    applySecretAction("sonar.token", { action: "replace", value: "secret" }, { storePath: paths.storePath })
    const result = applySecretAction("sonar.token", { action: "delete" }, { storePath: paths.storePath })
    const metadata = getSecretMetadata("sonar.token", { storePath: paths.storePath })

    assert.equal(result.ok, true)
    assert.equal(metadata.status, "missing")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-12 invalid secret actions do not default to delete", () => {
  const paths = tempSecretStore()
  try {
    applySecretAction("sonar.token", { action: "replace", value: "secret" }, { storePath: paths.storePath })
    const result = applySecretAction("sonar.token", { action: "unknown" }, { storePath: paths.storePath })
    const after = getSecretMetadata("sonar.token", { storePath: paths.storePath })

    assert.equal(result.ok, false)
    assert.equal(after.status, "active")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})
