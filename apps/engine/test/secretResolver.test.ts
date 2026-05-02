import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { applySecretAction } from "../src/setup/secretActions.js"
import { resolveSecretForExecution, withResolvedSecret } from "../src/setup/secretResolver.js"
import { deleteSecret, storeSecret } from "../src/setup/secretStore.js"

function tempSecretStore() {
  const dir = mkdtempSync(join(tmpdir(), "be2-secret-resolver-"))
  return { dir, storePath: join(dir, "secrets.json") }
}

test("AC-21 setup checks can resolve stored secrets explicitly", () => {
  const paths = tempSecretStore()
  try {
    storeSecret("sonar", "stored-secret", { storePath: paths.storePath })
    const resolved = resolveSecretForExecution("SONAR_TOKEN", "sonar", { storePath: paths.storePath })

    assert.equal(resolved.ok, true)
    if (resolved.ok) assert.equal(resolved.env.SONAR_TOKEN, "stored-secret")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-22 tool executions can receive scoped secret env values", async () => {
  const paths = tempSecretStore()
  try {
    storeSecret("sonar", "stored-secret", { storePath: paths.storePath })
    const result = await withResolvedSecret("SONAR_TOKEN", "sonar", env => env.SONAR_TOKEN, { storePath: paths.storePath })

    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.result, "stored-secret")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-23 disabled, deleted, or missing secrets are not injected", () => {
  const paths = tempSecretStore()
  try {
    storeSecret("disabled", "secret", { storePath: paths.storePath })
    applySecretAction("disabled", { action: "disable" }, { storePath: paths.storePath })
    storeSecret("deleted", "secret", { storePath: paths.storePath })
    deleteSecret("deleted", { storePath: paths.storePath })

    assert.equal(resolveSecretForExecution("DISABLED_TOKEN", "disabled", { storePath: paths.storePath }).ok, false)
    assert.equal(resolveSecretForExecution("DELETED_TOKEN", "deleted", { storePath: paths.storePath }).ok, false)
    assert.equal(resolveSecretForExecution("MISSING_TOKEN", "missing", { storePath: paths.storePath }).ok, false)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-24 resolved secret values are scoped and not persisted elsewhere", async () => {
  const paths = tempSecretStore()
  try {
    storeSecret("sonar", "scoped-secret-sentinel", { storePath: paths.storePath })
    await withResolvedSecret("SONAR_TOKEN", "sonar", () => "done", { storePath: paths.storePath })

    assert.match(readFileSync(paths.storePath, "utf8"), /scoped-secret-sentinel/)
    assert.equal(process.env.SONAR_TOKEN, undefined)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("AC-25 env source wins deterministically over secret store without leaking metadata", () => {
  const paths = tempSecretStore()
  const before = process.env.SONAR_TOKEN
  try {
    process.env.SONAR_TOKEN = "env-secret"
    storeSecret("sonar", "store-secret", { storePath: paths.storePath })
    const resolved = resolveSecretForExecution("SONAR_TOKEN", "sonar", { storePath: paths.storePath })

    assert.equal(resolved.ok, true)
    if (resolved.ok) {
      assert.equal(resolved.source, "env")
      assert.doesNotMatch(JSON.stringify({ source: resolved.source, ref: resolved.ref }), /env-secret|store-secret/)
    }
  } finally {
    if (before === undefined) delete process.env.SONAR_TOKEN
    else process.env.SONAR_TOKEN = before
    rmSync(paths.dir, { recursive: true, force: true })
  }
})
