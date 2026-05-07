#!/usr/bin/env node
// Public acceptance check for PROJ-8-PRD-1-US-1 (AC-5).
//
// Runs the ordinary engine test command and asserts that the permanent
// nested-discovery canary's unique test name appears in the combined
// stdout+stderr output. Under flat (non-recursive) discovery the canary
// is never collected, its name is never emitted, and this script exits
// non-zero with a clear diagnostic.
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const canaryName = "PROJ-8-PRD-1-US-1: nested-discovery-canary"

const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key.startsWith("NODE_TEST")) delete env[key]
}

const result = spawnSync("npm", ["test", "--workspace=@beerengineer/engine"], {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  env,
  maxBuffer: 256 * 1024 * 1024,
})

const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`

if (combined.includes(canaryName)) {
  console.log(`ok — found nested-discovery canary "${canaryName}" in ordinary command output.`)
  process.exit(0)
}

console.error(
  [
    `FAIL — nested-discovery canary "${canaryName}" was not found in the output of`,
    `  npm test --workspace=@beerengineer/engine`,
    "",
    "This means engine test discovery regressed to flat (non-recursive) mode.",
    `Expected: ${join("apps", "engine", "test", "api", "_discovery-canary.test.ts")} to be collected and executed.`,
    `npm test exit code: ${result.status ?? "unknown"}`,
  ].join("\n"),
)
process.exit(1)
