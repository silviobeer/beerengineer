import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { test } from "node:test"

import {
  runDocFreshnessReport,
} from "../../src/doc-freshness/index.js"
import type {
  DocFreshnessFinding,
} from "../../src/doc-freshness/reporter.js"

function createBufferWriter() {
  const chunks: string[] = []

  return {
    writer: {
      write(chunk: string) {
        chunks.push(chunk)
      },
    },
    read() {
      return chunks.join("")
    },
  }
}

test("SETUP-1 report runner emits the deterministic empty-result path", async () => {
  const stdout = createBufferWriter()
  const stderr = createBufferWriter()

  const exitCode = await runDocFreshnessReport({
    stdout: stdout.writer,
    stderr: stderr.writer,
  })

  assert.equal(exitCode, 0)
  assert.equal(stdout.read(), "Documentation freshness check passed.\n")
  assert.equal(stderr.read(), "")
})

test("SETUP-1 report runner emits deterministically sorted findings", async () => {
  const stdout = createBufferWriter()
  const stderr = createBufferWriter()
  const findings: DocFreshnessFinding[] = [
    {
      docPath: "docs/PROJECT.md",
      ruleId: "completed-proj-parity",
      message: "PROJ-12 is missing from the project index.",
      sortKey: ["docs/PROJECT.md", "completed-proj-parity", "PROJ-12"],
      evidence: { projId: "PROJ-12" },
    },
    {
      docPath: "README.md",
      ruleId: "deleted-directory-reference",
      message: "apps/legacy/ no longer exists.",
      sortKey: ["README.md", "deleted-directory-reference", "apps/legacy/"],
      evidence: { referencedPath: "apps/legacy/" },
    },
  ]

  const exitCode = await runDocFreshnessReport({
    collectFindings: () => [findings[0], findings[1]],
    stdout: stdout.writer,
    stderr: stderr.writer,
  })

  assert.equal(exitCode, 1)
  assert.equal(stdout.read(), "")
  assert.equal(
    stderr.read(),
    [
      "Documentation freshness check failed.",
      "",
      "- README.md [deleted-directory-reference] apps/legacy/ no longer exists.",
      "- docs/PROJECT.md [completed-proj-parity] PROJ-12 is missing from the project index.",
      "",
    ].join("\n"),
  )
})

test("SETUP-1 exposes a workspace script entrypoint for the report", () => {
  const root = resolve(import.meta.dirname, "..", "..", "..")
  const result = spawnSync("npm", ["run", "--silent", "report:doc-freshness", "--workspace=@beerengineer/engine"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(result.stdout.trim(), "Documentation freshness check passed.")
  assert.equal(result.stderr.trim(), "")
})
