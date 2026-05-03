#!/usr/bin/env node
import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const engineRoot = join(repoRoot, "apps", "engine")
const testDir = join(engineRoot, "test")

const integrationTests = new Set([
  "apiIntegration.test.ts",
  "baseBranch.test.ts",
  "cli-actions.test.ts",
  "cli-navigation.test.ts",
  "cli.test.ts",
  "executionSequential.test.ts",
  "git.test.ts",
  "gitInspect.test.ts",
  "managedInstallDiagnostics.test.ts",
  "managedInstallDocs.test.ts",
  "managedInstallDownload.test.ts",
  "managedInstallEntrypoint.test.ts",
  "managedInstallLock.test.ts",
  "managedInstallPath.test.ts",
  "managedInstallPrerequisites.test.ts",
  "managedInstallRelease.test.ts",
  "managedInstallState.test.ts",
  "managedInstallValidation.test.ts",
  "managedInstallWorkflow.test.ts",
  "resume.test.ts",
  "setupTaskCommit.test.ts",
  "updateMode.test.ts",
  "updateSwitcher.test.ts",
  "workflowE2E.test.ts",
  "workspaces.test.ts",
])

const sonarCoverageExclusions = new Set([
  "messagingLevel.test.ts",
  "resume.test.ts",
  "sdkLive.test.ts",
  "workflowE2E.test.ts",
])

function allTests() {
  return readdirSync(testDir)
    .filter(file => file.endsWith(".test.ts"))
    .sort()
}

function selectedTests(mode) {
  const tests = allTests()
  if (mode === "all") return tests
  if (mode === "unit") return tests.filter(file => !integrationTests.has(file) && file !== "sdkLive.test.ts")
  if (mode === "integration") return tests.filter(file => integrationTests.has(file))
  if (mode === "managed-install") return tests.filter(file => file.startsWith("managedInstall"))
  if (mode === "sonar-coverage") return tests.filter(file => !sonarCoverageExclusions.has(file))
  throw new Error(`Unknown test mode: ${mode}`)
}

const mode = process.argv[2] ?? "all"
const files = selectedTests(mode).map(file => join("test", file))
const nodeArgs = ["--test", "--import", "tsx"]

if (process.argv.includes("--list") || process.argv.includes("--dry-run")) {
  console.log(files.join("\n"))
  process.exit(0)
}

if (mode === "integration" || mode === "sonar-coverage") {
  nodeArgs.splice(1, 0, "--test-concurrency=1")
}

const result = spawnSync(process.execPath, [...nodeArgs, ...files], {
  cwd: engineRoot,
  stdio: "inherit",
})

process.exit(result.status ?? 1)
