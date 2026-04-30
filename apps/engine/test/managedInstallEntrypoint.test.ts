import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { runManagedInstallCommand } from "../src/cli/commands/install.js"
import { parseArgs } from "../src/cli/parse.js"
import { MANAGED_INSTALL_RESULT_VERSION } from "../src/core/managedInstall/diagnostics.js"
import {
  MANAGED_INSTALL_POSIX_COMMAND,
  MANAGED_INSTALL_REPO,
  MANAGED_INSTALL_WINDOWS_COMMAND,
} from "../src/core/managedInstall/docs.js"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

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
  const posix = readFileSync(repoPath("apps/engine/bin/install.sh"), "utf8")
  const windows = readFileSync(repoPath("apps/engine/bin/install.ps1"), "utf8")

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

test("install CLI JSON output round-trips success and startup errors with schema", async () => {
  const successChunks: string[] = []
  const successExit = await runManagedInstallCommand(
    { kind: "install", json: true, fromBootstrap: "posix" },
    {
      operationId: () => "op-cli-success",
      resolveRelease: async () => releaseTarget(),
      writeStdout: chunk => successChunks.push(chunk),
    },
  )
  const success = JSON.parse(successChunks.join(""))

  assert.equal(successExit, 0)
  assert.equal(success.version, MANAGED_INSTALL_RESULT_VERSION)
  assert.equal(success.operationId, "op-cli-success")
  assert.equal(success.target.repo, MANAGED_INSTALL_REPO)
  assert.equal(success.summary.status, "succeeded")
  assert.equal(success.exitCode, 0)

  const failureChunks: string[] = []
  const failureExit = await runManagedInstallCommand(
    { kind: "install", json: true, fromBootstrap: "windows" },
    {
      operationId: () => "op-cli-failure",
      resolveRelease: async () => {
        throw new Error("managed_install_release_required:no_stable_release")
      },
      writeStdout: chunk => failureChunks.push(chunk),
    },
  )
  const failure = JSON.parse(failureChunks.join(""))

  assert.equal(failureExit, 1)
  assert.equal(failure.version, MANAGED_INSTALL_RESULT_VERSION)
  assert.equal(failure.operationId, "op-cli-failure")
  assert.equal(failure.summary.status, "failed")
  assert.equal(failure.exitCode, 1)
  assert.match(failure.error.message, /no_stable_release/)
})

test("README exposes exactly one primary POSIX and Windows release install command", () => {
  const readme = readFileSync(repoPath("README.md"), "utf8")

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

function repoPath(path: string): string {
  return resolve(REPO_ROOT, path)
}

function releaseTarget() {
  return {
    repo: MANAGED_INSTALL_REPO,
    tag: "v1.0.0",
    version: "1.0.0",
    tarballUrl: "https://api.github.com/repos/silviobeer/beerengineer/tarball/v1.0.0",
    htmlUrl: "https://github.com/silviobeer/beerengineer/releases/tag/v1.0.0",
    publishedAt: "2026-01-01T00:00:00Z",
    download: {
      tarballUrl: "https://api.github.com/repos/silviobeer/beerengineer/tarball/v1.0.0",
      host: "api.github.com",
      protocol: "https:" as const,
    },
  }
}
