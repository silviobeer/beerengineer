import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"

import { readUpdateLock } from "../src/core/updateMode/lock.js"
import {
  resolveManagedInstallStatePaths,
} from "../src/core/managedInstall/state.js"
import {
  runManagedInstallReleaseWorkflow,
} from "../src/core/managedInstall/workflow.js"

test("managed install workflow distinguishes release resolution failures without activation", async () => {
  const config = configForTempDir()
  const result = await runManagedInstallReleaseWorkflow(config, {
    operationId: "op-resolution",
    resolveRelease: async () => {
      throw new Error("managed_install_release_resolution_failed:no_stable_release")
    },
    downloadRelease: async () => {
      throw new Error("should_not_download")
    },
    validateRelease: async () => {
      throw new Error("should_not_validate")
    },
  })

  assert.equal(result.exitCode, 1)
  assert.match(result.error?.message ?? "", /release-resolution/)
  assert.equal(existsSync(resolveManagedInstallStatePaths(config).currentLinkPath), false)
})

test("managed install workflow preserves app data and does not activate failed downloads", async () => {
  const config = configForTempDir()
  const configPath = join(config.dataDir, "config.json")
  const dbPath = join(config.dataDir, "beerengineer.sqlite")
  mkdirSync(config.dataDir, { recursive: true })
  writeFileSync(configPath, "config\n", "utf8")
  writeFileSync(dbPath, "db\n", "utf8")

  const result = await runManagedInstallReleaseWorkflow(config, {
    operationId: "op-download",
    resolveRelease: async () => releaseTarget(),
    downloadRelease: async () => {
      throw new Error("managed_install_download_failed:timeout")
    },
    validateRelease: async () => {
      throw new Error("should_not_validate")
    },
  })

  assert.equal(result.exitCode, 1)
  assert.match(result.error?.message ?? "", /download/)
  assert.equal(existsSync(resolveManagedInstallStatePaths(config).currentLinkPath), false)
  assert.equal(readFileSync(configPath, "utf8"), "config\n")
  assert.equal(readFileSync(dbPath, "utf8"), "db\n")
})

test("managed install workflow cleans staged invalid releases and releases shared lock", async () => {
  const config = configForTempDir()
  const result = await runManagedInstallReleaseWorkflow(config, {
    operationId: "op-validation",
    resolveRelease: async () => releaseTarget(),
    downloadRelease: async () => ({ body: Buffer.from("tarball"), finalUrl: "https://codeload.github.com/repo.tar.gz" }),
    validateRelease: async () => {
      throw new Error("managed_install_validate_failed:missing_root_package_json")
    },
  })
  const paths = resolveManagedInstallStatePaths(config)
  const versionEntries = existsSync(paths.versionsDir) ? readdirSync(paths.versionsDir) : []

  assert.equal(result.exitCode, 1)
  assert.match(result.error?.message ?? "", /release-validation/)
  assert.equal(existsSync(paths.currentLinkPath), false)
  assert.equal(versionEntries.some(entry => entry.startsWith(".staging-op-validation-")), false)
  assert.equal(readUpdateLock(paths.lockPath).held, false)
})

test("managed install workflow reports staging failures separately from lock failures", async () => {
  const config = configForTempDir()
  writeFileSync(join(config.dataDir, "install"), "not a directory\n", "utf8")

  const result = await runManagedInstallReleaseWorkflow(config, {
    operationId: "op-staging",
    resolveRelease: async () => releaseTarget(),
    downloadRelease: async () => ({ body: Buffer.from("tarball"), finalUrl: "https://codeload.github.com/repo.tar.gz" }),
    validateRelease: async () => {
      throw new Error("should_not_validate")
    },
  })

  assert.equal(result.exitCode, 1)
  assert.match(result.error?.message ?? "", /staging failed:/)
  assert.doesNotMatch(result.error?.message ?? "", /lock failed:/)
})

function configForTempDir(): { dataDir: string } {
  return { dataDir: mkdtempSync(join(tmpdir(), "managed-install-workflow-")) }
}

function releaseTarget() {
  return {
    repo: "silviobeer/beerengineer",
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
