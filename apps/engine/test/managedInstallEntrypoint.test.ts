import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { parseArgs } from "../src/cli/parse.js"
import {
  MANAGED_INSTALL_POSIX_COMMAND,
  MANAGED_INSTALL_REPO,
  MANAGED_INSTALL_WINDOWS_COMMAND,
} from "../src/core/managedInstall/docs.js"

test("install CLI command parses bootstrap platform and JSON flags", () => {
  assert.deepEqual(parseArgs(["install", "--from-bootstrap", "posix", "--json"]), {
    kind: "install",
    json: true,
    fromBootstrap: "posix",
  })
  assert.deepEqual(parseArgs(["install", "--from-bootstrap", "windows"]), {
    kind: "install",
    json: false,
    fromBootstrap: "windows",
  })
})

test("public shell entrypoints are thin delegates into repo-owned install command", () => {
  const posix = readFileSync("apps/engine/bin/install.sh", "utf8")
  const windows = readFileSync("apps/engine/bin/install.ps1", "utf8")

  assert.match(posix, /node "\$SCRIPT_DIR\/beerengineer\.js" install --from-bootstrap posix/)
  assert.match(windows, /install --from-bootstrap windows/)
  for (const body of [posix, windows]) {
    assert.doesNotMatch(body, /install\/versions/)
    assert.doesNotMatch(body, /validateManagedInstall/)
    assert.match(body, /node/)
    assert.match(body, /npm/)
    assert.match(body, /git/)
  }
})

test("README exposes exactly one primary POSIX and Windows release install command", () => {
  const readme = readFileSync("README.md", "utf8")

  assert.equal(count(readme, MANAGED_INSTALL_POSIX_COMMAND), 1)
  assert.equal(count(readme, MANAGED_INSTALL_WINDOWS_COMMAND), 1)
  assert.match(readme, new RegExp(MANAGED_INSTALL_REPO))
  assert.match(readme, /target version|target release/)
  assert.match(readme, /no stable release/i)
  assert.doesNotMatch(readme, /beerengineer\/refs\/heads\/master|beerengineer\/master/)
})

function count(input: string, needle: string): number {
  return input.split(needle).length - 1
}
