import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  resolveDocFreshnessScope,
  resolveScopedDirectoryReference,
  scopedDirectoryExists,
} from "../../src/doc-freshness/scope.js"
import {
  DIRECTORY_REFERENCE_WORDING_FIXTURES,
  writeDocFreshnessFixtureRepo,
} from "./fixtures.js"

function createFixtureRepo(): string {
  const rootPath = mkdtempSync(join(tmpdir(), "be2-doc-freshness-"))
  writeDocFreshnessFixtureRepo(rootPath)

  mkdirSync(join(rootPath, "docs"), { recursive: true })
  writeFileSync(join(rootPath, "docs", "notes.md"), "# Out of scope\n", "utf8")
  mkdirSync(join(rootPath, "specs", "PROJ-99-incomplete", "7_progress"), {
    recursive: true,
  })

  return rootPath
}

test("resolveDocFreshnessScope only returns the approved docs, manifests, and completed PROJ evidence", () => {
  const rootPath = createFixtureRepo()

  const scope = resolveDocFreshnessScope(rootPath)

  assert.deepEqual(
    scope.docs.map((doc) => doc.docPath),
    [
      "AGENTS.md",
      "apps/engine/docs/AGENTS.md",
      "apps/ui/docs/AGENTS.md",
      "apps/ui/README.md",
      "docs/adr/ADR-12-1.md",
      "docs/AGENTS.md",
      "docs/PROJECT.md",
      "docs/TECHNICAL.md",
      "README.md",
    ],
  )
  assert.deepEqual(
    scope.packageManifests.map((manifest) => manifest.manifestPath),
    [
      "package.json",
      "apps/engine/package.json",
      "apps/ui/package.json",
      "apps/worker/package.json",
    ],
  )
  assert.deepEqual(
    scope.completedProjects.map((project) => ({
      projId: project.projId,
      progressPath: project.progressPath,
      evidencePaths: project.evidencePaths,
    })),
    [
      {
        projId: "PROJ-10",
        progressPath: "specs/PROJ-10-shipped-foundation/7_progress",
        evidencePaths: [
          "specs/PROJ-10-shipped-foundation/7_progress/2026-05-10.md",
        ],
      },
      {
        projId: "PROJ-12",
        progressPath: "specs/PROJ-12-canonical-adr-home/7_progress",
        evidencePaths: [
          "specs/PROJ-12-canonical-adr-home/7_progress/2026-05-11.md",
        ],
      },
    ],
  )
})

test("directory reference resolution stays inside the approved directory-only scope", () => {
  const rootPath = createFixtureRepo()

  for (const fixture of DIRECTORY_REFERENCE_WORDING_FIXTURES) {
    assert.equal(
      scopedDirectoryExists(rootPath, fixture.docPath, fixture.reference),
      fixture.context === "current",
      fixture.name,
    )
  }

  assert.equal(
    resolveScopedDirectoryReference(rootPath, "README.md", "/etc/"),
    null,
  )
  assert.equal(
    resolveScopedDirectoryReference(rootPath, "README.md", "README.md"),
    null,
  )
  assert.equal(
    resolveScopedDirectoryReference(rootPath, "README.md", "tmp/"),
    null,
  )

  const resolved = resolveScopedDirectoryReference(
    rootPath,
    "docs/AGENTS.md",
    "../apps/engine/",
  )
  assert.deepEqual(resolved?.repoPath, "apps/engine")
})
