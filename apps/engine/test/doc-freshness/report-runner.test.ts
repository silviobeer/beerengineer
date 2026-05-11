import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"

import { collectDocFreshnessFindings } from "../../src/doc-freshness/index.js"
import { writeDocFreshnessFixtureRepo } from "./fixtures.js"

function createFixtureRepo(): string {
  const rootPath = mkdtempSync(join(tmpdir(), "be2-doc-freshness-runner-"))
  writeDocFreshnessFixtureRepo(rootPath)
  return rootPath
}

function cleanup(rootPath: string): void {
  rmSync(rootPath, { recursive: true, force: true })
}

function appendFile(rootPath: string, relativePath: string, content: string): void {
  const absolutePath = join(rootPath, relativePath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content, { encoding: "utf8", flag: "a" })
}

function runWorkspaceReport(rootPath: string) {
  const repoRoot = resolve(import.meta.dirname, "..", "..", "..")

  return spawnSync(
    "npm",
    ["run", "--silent", "report:doc-freshness", "--workspace=@beerengineer/engine", "--", rootPath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
}

test("REQ-1 clean in-scope repo succeeds with the explicit no-issues message", () => {
  const rootPath = createFixtureRepo()

  try {
    const result = runWorkspaceReport(rootPath)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(
      result.stdout.trim(),
      "Documentation freshness check passed: no freshness issues were detected.",
    )
    assert.equal(result.stderr.trim(), "")
  } finally {
    cleanup(rootPath)
  }
})

test("REQ-1 findings from all approved rules fail the report and list doc path plus rule id", () => {
  const rootPath = createFixtureRepo()

  try {
    writeFileSync(
      join(rootPath, "docs/PROJECT.md"),
      "# Project Index\n\nCompleted work includes PROJ-10 in the shipped catalog.\n",
      "utf8",
    )
    appendFile(rootPath, "docs/TECHNICAL.md", "\nCurrent dependency: next@99.9.9\n")
    appendFile(rootPath, "docs/AGENTS.md", "\nCurrent active code lives in `legacy/`.\n")

    const result = runWorkspaceReport(rootPath)
    const output = result.stderr.trim()

    assert.notEqual(result.status, 0)
    assert.match(output, /^Documentation freshness check failed\./)
    assert.match(output, /docs\/PROJECT\.md \[completed-proj-parity]/)
    assert.match(output, /docs\/TECHNICAL\.md \[dependency-claim-parity]/)
    assert.match(output, /docs\/AGENTS\.md \[deleted-directory-reference]/)
    assert.doesNotMatch(output, /no freshness issues were detected/i)
  } finally {
    cleanup(rootPath)
  }
})

test("REQ-1 scope stays limited to canonical docs and short ADR markdown files", () => {
  const rootPath = createFixtureRepo()

  try {
    appendFile(rootPath, "notes/out-of-scope.md", "\nCurrent dependency: next@99.9.9\n")
    appendFile(rootPath, "apps/ui/README.md", "\nCurrent dependency: next@99.9.9\n")
    writeFileSync(
      join(rootPath, "docs/adr/ADR-12-9.md"),
      "# ADR-12-9\n\nCurrent dependency: hono@9.9.9\n",
      "utf8",
    )
    writeFileSync(
      join(rootPath, "docs/adr/archive.md"),
      "# Archive\n\nCurrent active code lives in `legacy/`.\n",
      "utf8",
    )
    mkdirSync(join(rootPath, "docs/adr/archive"), { recursive: true })
    writeFileSync(
      join(rootPath, "docs/adr/archive", "ignored.md"),
      "# Nested\n\nCurrent dependency: next@1.0.0\n",
      "utf8",
    )

    const findings = collectDocFreshnessFindings(rootPath)

    assert.ok(
      findings.some((finding) => finding.docPath === "apps/ui/README.md"),
    )
    assert.ok(
      findings.some((finding) => finding.docPath === "docs/adr/ADR-12-9.md"),
    )
    assert.ok(
      findings.some((finding) => finding.docPath === "docs/adr/archive.md"),
    )
    assert.ok(
      findings.every((finding) => finding.docPath !== "notes/out-of-scope.md"),
    )
    assert.ok(
      findings.every((finding) => finding.docPath !== "docs/adr/archive/ignored.md"),
    )
  } finally {
    cleanup(rootPath)
  }
})

test("REQ-1 repeated runs over the same repo state stay byte-for-byte stable", () => {
  const rootPath = createFixtureRepo()

  try {
    appendFile(rootPath, "docs/TECHNICAL.md", "\nCurrent dependency: hono@^4.8.0\n")
    appendFile(rootPath, "docs/AGENTS.md", "\nCurrent active code lives in `legacy/`.\n")
    unlinkSync(join(rootPath, "docs", "PROJECT.md"))

    const first = runWorkspaceReport(rootPath)
    const second = runWorkspaceReport(rootPath)

    assert.equal(first.status, second.status)
    assert.equal(first.stdout, second.stdout)
    assert.equal(first.stderr, second.stderr)
  } finally {
    cleanup(rootPath)
  }
})
