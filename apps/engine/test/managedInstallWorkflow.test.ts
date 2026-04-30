import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"

import { readUpdateLock } from "../src/core/updateMode/lock.js"
import {
  activateManagedInstallVersion,
  resolveManagedInstallStatePaths,
} from "../src/core/managedInstall/state.js"
import {
  runManagedInstallCompletionWorkflow,
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

test("completion workflow runs setup through the absolute managed wrapper without PATH dependence", async () => {
  const config = configForTempDir()
  createActiveInstall(config.dataDir)
  const invocations: Array<{ command: string; args: string[]; path: string | undefined }> = []

  const result = await runManagedInstallCompletionWorkflow(config, {
    operationId: "op-complete",
    pathEnv: "",
    uiStartEligible: false,
    commandRunner: async invocation => {
      invocations.push({ command: invocation.command, args: invocation.args, path: invocation.env.PATH })
      return { exitCode: 0 }
    },
  })
  const paths = resolveManagedInstallStatePaths(config)

  assert.equal(result.exitCode, 0)
  assert.equal(invocations[0].command, paths.wrapperPath)
  assert.deepEqual(invocations[0].args, ["setup"])
  assert.equal(invocations[0].path, "")
})

test("completion workflow treats setup failure as hard failure while preserving app data", async () => {
  const config = configForTempDir()
  createActiveInstall(config.dataDir)
  const configPath = join(config.dataDir, "config.json")
  const dbPath = join(config.dataDir, "beerengineer.sqlite")
  writeFileSync(configPath, "config\n", "utf8")
  writeFileSync(dbPath, "db\n", "utf8")

  const result = await runManagedInstallCompletionWorkflow(config, {
    operationId: "op-setup-fail",
    commandRunner: async invocation => invocation.phase === "setup"
      ? { exitCode: 1, stderr: "setup failed" }
      : { exitCode: 0 },
  })

  assert.equal(result.exitCode, 1)
  assert.match(result.error?.message ?? "", /setup failed:/)
  assert.equal(readFileSync(configPath, "utf8"), "config\n")
  assert.equal(readFileSync(dbPath, "utf8"), "db\n")
})

test("completion workflow reports engine start success and warning-only failure", async () => {
  const config = configForTempDir()
  createActiveInstall(config.dataDir)
  const paths = resolveManagedInstallStatePaths(config)

  const success = await runManagedInstallCompletionWorkflow(config, {
    operationId: "op-engine-ok",
    uiStartEligible: false,
    commandRunner: async () => ({ exitCode: 0 }),
  })
  assert.equal(success.summary.engineUrl, "http://127.0.0.1:4100")

  const warning = await runManagedInstallCompletionWorkflow(config, {
    operationId: "op-engine-warning",
    uiStartEligible: false,
    commandRunner: async invocation => invocation.phase === "engineStart"
      ? { exitCode: 1, stderr: "port busy" }
      : { exitCode: 0 },
  })

  assert.equal(warning.exitCode, 0)
  assert.equal(warning.summary.status, "succeeded-with-warning")
  assert.match(warning.summary.warnings.join("\n"), /engineStart: engine start failed/)
  assert.doesNotMatch(warning.summary.warnings.join("\n"), /reinstall/i)
  assert.ok(warning.summary.nextCommands.includes(`${paths.wrapperPath} start`))
})

test("completion workflow handles UI best-effort success instruction and warning paths", async () => {
  const config = configForTempDir()
  createActiveInstall(config.dataDir)
  const paths = resolveManagedInstallStatePaths(config)

  const ineligible = await runManagedInstallCompletionWorkflow(config, {
    operationId: "op-ui-manual",
    uiStartEligible: false,
    commandRunner: async () => ({ exitCode: 0 }),
  })
  assert.equal(ineligible.exitCode, 0)
  assert.equal(ineligible.summary.uiUrl, "http://127.0.0.1:3100")
  assert.ok(ineligible.summary.nextCommands.includes(`${paths.wrapperPath} start ui`))

  const failed = await runManagedInstallCompletionWorkflow(config, {
    operationId: "op-ui-fail",
    uiStartEligible: true,
    commandRunner: async invocation => invocation.phase === "uiStart"
      ? { exitCode: 1, stderr: "ui unavailable" }
      : { exitCode: 0 },
  })
  assert.equal(failed.exitCode, 0)
  assert.match(failed.summary.warnings.join("\n"), /uiStart: UI start failed/)
})

test("completion workflow short-circuits idempotent reruns without mutating active install", async () => {
  const config = configForTempDir()
  const active = createActiveInstall(config.dataDir)
  const paths = resolveManagedInstallStatePaths(config)
  const currentBefore = readFileSync(paths.wrapperPath, "utf8")
  let commandCount = 0

  const result = await runManagedInstallCompletionWorkflow(config, {
    operationId: "op-rerun",
    mode: "rerun",
    commandRunner: async () => {
      commandCount += 1
      return { exitCode: 0 }
    },
  })

  assert.equal(result.exitCode, 0)
  assert.equal(commandCount, 0)
  assert.match(result.summary.nextCommands.join("\n"), /update/)
  assert.equal(readFileSync(paths.wrapperPath, "utf8"), currentBefore)
  assert.equal(existsSync(active), true)
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

function createActiveInstall(dataDir: string): string {
  const root = join(dataDir, "install", "versions", "v1.0.0")
  mkdirSync(join(root, "apps", "engine", "bin"), { recursive: true })
  mkdirSync(join(root, "apps", "ui"), { recursive: true })
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "beerengineer",
    private: true,
    workspaces: ["apps/*"],
  })}\n`, "utf8")
  writeFileSync(join(root, "apps", "engine", "package.json"), `${JSON.stringify({
    name: "@beerengineer/engine",
    version: "1.0.0",
    bin: { beerengineer: "./bin/beerengineer.js" },
  })}\n`, "utf8")
  writeFileSync(join(root, "apps", "engine", "bin", "beerengineer.js"), "#!/usr/bin/env node\n", "utf8")
  activateManagedInstallVersion({ dataDir }, { tag: "v1.0.0", version: "1.0.0" })
  return root
}
