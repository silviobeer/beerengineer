// Acceptance tests for PROJ-8-PRD-1-US-1 — recursive engine test discovery.
// These tests spawn `npm test --workspace=@beerengineer/engine` as a subprocess
// to verify behaviour through the public test command's combined output.
// They are classified as integration-only in apps/engine/test/_mode-manifest.json
// to prevent recursion when the ordinary command runs.

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const engineRoot = resolve(here, "..")
const repoRoot = resolve(engineRoot, "..", "..")
const testDir = join(engineRoot, "test")

type CmdResult = SpawnSyncReturns<string> & { combined: string }

function spawnEnvWithoutTestContext(): NodeJS.ProcessEnv {
  // Node's test runner uses NODE_TEST_CONTEXT to detect recursive `node --test`
  // invocations and silently skip running files. The inner npm test must look
  // like a top-level test invocation, so strip every NODE_TEST_* variable
  // before spawning.
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST")) delete env[key]
  }
  return env
}

function runOrdinaryCommand(): CmdResult {
  const result = spawnSync("npm", ["test", "--workspace=@beerengineer/engine"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: spawnEnvWithoutTestContext(),
    maxBuffer: 256 * 1024 * 1024,
  })
  return Object.assign(result, { combined: `${result.stdout ?? ""}\n${result.stderr ?? ""}` })
}

function toPosix(p: string): string {
  return p.split(sep).join("/")
}

function discoverNestedInventory(): string[] {
  const categories = ["api", "core", "db", "setup", "stages"]
  const out: string[] = []
  for (const cat of categories) {
    const dir = join(testDir, cat)
    if (!existsSync(dir)) continue
    const entries = readdirSync(dir, { recursive: true, withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith(".test.ts")) continue
      const parent = entry.parentPath ?? entry.path
      const abs = join(parent, entry.name)
      out.push(toPosix(relative(engineRoot, abs)))
    }
  }
  return out.sort()
}

type Manifest = {
  integrationOnly?: { path: string; reason?: string }[]
  sonarCoverageOnly?: { path: string; reason?: string }[]
}

function loadManifest(): Manifest {
  const path = join(testDir, "_mode-manifest.json")
  return JSON.parse(readFileSync(path, "utf8")) as Manifest
}

function baselineDirectChildren(): string[] {
  // FX-1 baseline derived from the on-disk direct-child `.test.ts` files
  // currently present under apps/engine/test/. PROJ-8-PRD-1-US-1 is the first
  // story in PROJ-8, so today's root-level set is the pre-PROJ-8 baseline.
  return readdirSync(testDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".test.ts"))
    .map(e => e.name)
    .filter(name => !name.startsWith("_"))
    .sort()
}

function nonOrdinaryDirectChildBasenames(manifest: Manifest): Set<string> {
  // Manifest entries with normalized paths like "test/foo.test.ts" — only
  // direct-child (one segment after `test/`) entries contribute to the
  // direct-child baseline exclusion set.
  const out = new Set<string>()
  const all = [...(manifest.integrationOnly ?? []), ...(manifest.sonarCoverageOnly ?? [])]
  for (const entry of all) {
    const segments = entry.path.split("/")
    if (segments.length === 2 && segments[0] === "test") {
      out.add(segments[1])
    }
  }
  return out
}

const SUBDIR_PATH_RE = /test[\/\\](api|core|db|setup|stages)[\/\\]/

test("PROJ-8-PRD-1-US-1 TC-1: ordinary command output contains at least one nested test path under apps/engine/test/{api,core,db,setup,stages}/", () => {
  const result = runOrdinaryCommand()
  assert.match(
    result.combined,
    SUBDIR_PATH_RE,
    `Ordinary engine test output did not include any nested subdirectory path; recursive discovery may be broken.\n--- output (truncated) ---\n${result.combined.slice(0, 4000)}`,
  )
})

test("PROJ-8-PRD-1-US-1 TC-2: pre-PROJ-8 direct-child filenames still appear in ordinary command output", () => {
  const result = runOrdinaryCommand()
  const excluded = nonOrdinaryDirectChildBasenames(loadManifest())
  const missing: string[] = []
  for (const filename of baselineDirectChildren()) {
    if (excluded.has(filename)) continue
    if (!result.combined.includes(filename)) missing.push(filename)
  }
  assert.deepEqual(
    missing,
    [],
    `Direct-child test files missing from ordinary command output: ${missing.join(", ")}`,
  )
})

test("PROJ-8-PRD-1-US-1 TC-3: ordinary mode includes non-excluded nested files and excludes manifest entries", () => {
  const result = runOrdinaryCommand()
  const manifest = loadManifest()
  const nonOrdinary = new Set<string>([
    ...(manifest.integrationOnly ?? []).map(e => e.path),
    ...(manifest.sonarCoverageOnly ?? []).map(e => e.path),
  ])
  const inventory = discoverNestedInventory()
  const ordinaryNested = inventory.filter(p => !nonOrdinary.has(p))

  // Positive assertion: every non-excluded nested file appears as a normalized
  // relative path in the output. Bare-filename matching is not sufficient.
  const missing = ordinaryNested.filter(p => !result.combined.includes(p))
  assert.deepEqual(
    missing,
    [],
    `Nested ordinary files missing from output: ${missing.join(", ")}`,
  )

  // Negative assertion: every manifest-classified non-ordinary file must NOT
  // appear in the output. Mandatory representatives are asserted explicitly.
  const mandatoryNonOrdinary = ["test/apiIntegration.test.ts", "test/sdkLive.test.ts"]
  for (const p of mandatoryNonOrdinary) {
    assert.ok(
      nonOrdinary.has(p),
      `Mode manifest must classify ${p} as non-ordinary; TC-3 mandatory representative.`,
    )
  }
  const leaked = [...nonOrdinary].filter(p => result.combined.includes(p))
  assert.deepEqual(
    leaked,
    [],
    `Manifest non-ordinary files leaked into ordinary command output: ${leaked.join(", ")}`,
  )
})

test("PROJ-8-PRD-1-US-1 TC-4: ordinary command surfaces the sentinel's specific failure message, proving nested failure was collected and executed", () => {
  const sentinelPath = join(testDir, "api", "_sentinel.test.ts")
  const sentinelBody = [
    `import { test } from "node:test"`,
    `import assert from "node:assert/strict"`,
    ``,
    `test("PROJ-8-PRD-1-US-1-sentinel: nested-failure-must-surface", () => {`,
    `  assert.fail("sentinel-failure")`,
    `})`,
    ``,
  ].join("\n")
  writeFileSync(sentinelPath, sentinelBody, "utf8")
  let result: CmdResult
  try {
    result = runOrdinaryCommand()
  } finally {
    try {
      unlinkSync(sentinelPath)
    } catch {
      // best-effort cleanup
    }
  }
  assert.ok(
    result.combined.includes("sentinel-failure"),
    `Sentinel error message 'sentinel-failure' was not in ordinary command output. Nested failure was not surfaced.\n--- output (last 4KB) ---\n${result.combined.slice(-4000)}`,
  )
  assert.ok(
    result.combined.includes("PROJ-8-PRD-1-US-1-sentinel"),
    `Sentinel test name not found in ordinary command output.`,
  )
  assert.notEqual(
    result.status,
    0,
    `Ordinary command exit code should be non-zero when the nested sentinel fails.`,
  )
})

test("PROJ-8-PRD-1-US-1 TC-5: public acceptance check exits zero and the canary's unique name appears in ordinary command output", () => {
  const scriptPath = join(repoRoot, "scripts", "check-nested-discovery.mjs")
  assert.ok(existsSync(scriptPath), "scripts/check-nested-discovery.mjs is missing.")
  const checkResult = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: spawnEnvWithoutTestContext(),
    maxBuffer: 256 * 1024 * 1024,
  })
  const combined = `${checkResult.stdout ?? ""}\n${checkResult.stderr ?? ""}`
  assert.equal(
    checkResult.status,
    0,
    `Public acceptance check failed (exit ${checkResult.status}). Output:\n${combined.slice(-4000)}`,
  )
  assert.ok(
    combined.includes("PROJ-8-PRD-1-US-1: nested-discovery-canary"),
    "Canary name not echoed by acceptance check; canary may not have been collected by ordinary command.",
  )
})
