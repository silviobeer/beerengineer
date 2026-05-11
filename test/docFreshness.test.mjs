import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

import {
  checkDocFreshness,
  formatDocFreshnessReport,
} from "../scripts/check-doc-freshness.mjs"

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "be2-doc-freshness-"))
  const repoPackage = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  )

  writeJson(root, "package.json", {
    name: "doc-freshness-fixture",
    private: true,
    type: "module",
    workspaces: repoPackage.workspaces,
    scripts: {
      test: repoPackage.scripts.test,
      "test:docs-freshness": "node scripts/check-doc-freshness.mjs",
    },
  })
  writeJson(root, "apps/engine/package.json", {
    name: "@fixture/engine",
    private: true,
    dependencies: {
      "better-sqlite3": "^11.10.0",
    },
    devDependencies: {
      "@openai/codex-sdk": "^0.125.0",
    },
  })
  writeJson(root, "apps/ui/package.json", {
    name: "@fixture/ui",
    private: true,
    dependencies: {
      next: "^15.0.0",
      react: "^19.0.0",
    },
  })
  writeJson(root, "apps/engine/src/placeholder.json", {})
  writeFile(root, "README.md", [
    "# Fixture Repo",
    "",
    "Current docs live in [PROJECT](docs/PROJECT.md).",
  ].join("\n"))
  writeFile(root, "AGENTS.md", [
    "# Agents",
    "",
    "Shared docs index: `docs/AGENTS.md`.",
  ].join("\n"))
  writeFile(root, "docs/AGENTS.md", [
    "# Docs",
    "",
    "Durable decisions live in `docs/adr/`.",
  ].join("\n"))
  writeFile(root, "docs/PROJECT.md", [
    "# Features",
    "",
    "## PROJ-2: Listed project",
  ].join("\n"))
  writeFile(root, "docs/TECHNICAL.md", [
    "# Technical",
    "",
    "Active engine sources live in `apps/engine/`.",
  ].join("\n"))
  writeFile(root, "docs/adr/README.md", [
    "# ADRs",
    "",
    "Canonical ADR home: `docs/adr/`.",
  ].join("\n"))
  writeFile(root, "notes/working-notes.md", "# Working Notes\n")
  writeFile(
    root,
    "scripts/check-doc-freshness.mjs",
    readFileSync(new URL("../scripts/check-doc-freshness.mjs", import.meta.url), "utf8"),
  )

  return root
}

function writeJson(root, relativePath, value) {
  writeFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

function writeFile(root, relativePath, content) {
  const filePath = join(root, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function makeCompletedProj(root, projId, slug, logs = ["progress.md"]) {
  const progressDir = join(root, "specs", `${projId}-${slug}`, "7_progress")
  mkdirSync(progressDir, { recursive: true })
  for (const logName of logs) {
    writeFileSync(join(progressDir, logName), `# ${projId}\n`)
  }
}

function makeEmptyProgressDir(root, projId, slug) {
  mkdirSync(join(root, "specs", `${projId}-${slug}`, "7_progress"), {
    recursive: true,
  })
}

function makeDir(root, relativePath) {
  mkdirSync(join(root, relativePath), { recursive: true })
}

function appendFile(root, relativePath, content) {
  const current = readFileSync(join(root, relativePath), "utf8")
  writeFile(root, relativePath, `${current}${content}`)
}

function runFixtureNpmTest(root) {
  return spawnSync("npm", ["test"], {
    cwd: root,
    encoding: "utf8",
  })
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true })
}

test("TC-1 only non-empty 7_progress marks a PROJ complete", () => {
  const root = createFixture()
  try {
    makeCompletedProj(root, "PROJ-2", "listed-project")
    makeEmptyProgressDir(root, "PROJ-3", "empty-progress")
    mkdirSync(join(root, "specs", "PROJ-4-no-progress"), { recursive: true })

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.missingProjects, [])
  } finally {
    cleanup(root)
  }
})

test("TC-2 missing completed PROJ is reported", () => {
  const root = createFixture()
  try {
    makeCompletedProj(root, "PROJ-9", "missing-project")

    const result = checkDocFreshness(root)
    const report = formatDocFreshnessReport(result)

    assert.equal(result.ok, false)
    assert.equal(result.findings.missingProjects.length, 1)
    assert.equal(result.findings.missingProjects[0].projId, "PROJ-9")
    assert.match(report, /Missing completed PROJs/)
    assert.match(report, /PROJ-9/)
    assert.match(report, /docs\/PROJECT\.md/)
  } finally {
    cleanup(root)
  }
})

test("TC-3 prefix-related PROJ ids are matched exactly", () => {
  const root = createFixture()
  try {
    makeCompletedProj(root, "PROJ-1", "short")
    makeCompletedProj(root, "PROJ-12", "long")
    writeFile(root, "docs/PROJECT.md", "# Features\n\n## PROJ-12: Listed project\n")

    const result = checkDocFreshness(root)

    assert.equal(result.ok, false)
    assert.deepEqual(
      result.findings.missingProjects.map((finding) => finding.projId),
      ["PROJ-1"],
    )
  } finally {
    cleanup(root)
  }
})

test("TC-4 incomplete PROJs do not trigger missing-PROJ failures", () => {
  const root = createFixture()
  try {
    makeEmptyProgressDir(root, "PROJ-3", "empty-progress")
    mkdirSync(join(root, "specs", "PROJ-4-no-progress"), { recursive: true })

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.missingProjects, [])
  } finally {
    cleanup(root)
  }
})

test("TC-5 7_progress with only non-markdown files does not mark a PROJ complete", () => {
  const root = createFixture()
  try {
    makeCompletedProj(root, "PROJ-3", "non-markdown-only", ["progress.txt", "notes.json"])

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.missingProjects, [])
  } finally {
    cleanup(root)
  }
})

test("TC-6 multiple markdown progress logs still yield one missing-PROJ finding", () => {
  const root = createFixture()
  try {
    makeCompletedProj(root, "PROJ-9", "missing-project", [
      "ship.md",
      "qa.md",
      "retro.md",
    ])

    const result = checkDocFreshness(root)
    const report = formatDocFreshnessReport(result)

    assert.equal(result.ok, false)
    assert.equal(result.findings.missingProjects.length, 1)
    assert.equal(result.findings.missingProjects[0].projId, "PROJ-9")
    assert.equal(result.findings.missingProjects[0].logCount, 3)
    assert.match(report, /PROJ-9/)
    assert.equal(report.match(/docs\/PROJECT\.md:/g)?.length, 1)
  } finally {
    cleanup(root)
  }
})

test("TC-7 dependency scan ignores out-of-scope docs", () => {
  const root = createFixture()
  try {
    appendFile(root, "notes/working-notes.md", "\nPinned candidate: next@^99.0.0\n")

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.dependencyClaims, [])
  } finally {
    cleanup(root)
  }
})

test("TC-7b dependency scan ignores nested docs below the approved ADR scope", () => {
  const root = createFixture()
  try {
    writeFile(
      root,
      "docs/adr/archive/old-decision.md",
      "# Archived\n\nCurrent dependency: next@^99.0.0\n",
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.dependencyClaims, [])
  } finally {
    cleanup(root)
  }
})

test("TC-8 in-scope dependency mismatch reports doc and manifest", () => {
  const root = createFixture()
  try {
    appendFile(root, "docs/TECHNICAL.md", "\nPinned dependency: next@^99.0.0\n")

    const result = checkDocFreshness(root)
    const report = formatDocFreshnessReport(result)

    assert.equal(result.ok, false)
    assert.equal(result.findings.dependencyClaims.length, 1)
    assert.equal(result.findings.dependencyClaims[0].packageName, "next")
    assert.equal(result.findings.dependencyClaims[0].claimedVersion, "^99.0.0")
    assert.equal(
      result.findings.dependencyClaims[0].manifestPath,
      "apps/ui/package.json",
    )
    assert.match(report, /Dependency claim drift/)
    assert.match(report, /docs\/TECHNICAL\.md/)
    assert.match(report, /apps\/ui\/package\.json/)
  } finally {
    cleanup(root)
  }
})

test("TC-8b dependency scan uses only root and apps manifests as truth sources", () => {
  const root = createFixture()
  try {
    writeJson(root, "package.json", {
      name: "doc-freshness-fixture",
      private: true,
      type: "module",
      workspaces: ["apps/*"],
      dependencies: {
        vite: "^6.1.0",
      },
      scripts: {
        test: "npm run test:docs-freshness",
        "test:docs-freshness": "node scripts/check-doc-freshness.mjs",
      },
    })
    writeJson(root, "tools/package.json", {
      name: "@fixture/tools",
      private: true,
      dependencies: {
        vite: "^9.9.9",
      },
    })
    appendFile(root, "docs/TECHNICAL.md", "\nCurrent dependency: vite@^6.1.0\n")

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.dependencyClaims, [])
  } finally {
    cleanup(root)
  }
})

test("TC-8c pinned claim for dependency missing from approved manifests is reported", () => {
  const root = createFixture()
  try {
    writeJson(root, "tools/package.json", {
      name: "@fixture/tools",
      private: true,
      dependencies: {
        hono: "^4.7.0",
      },
    })
    appendFile(root, "docs/TECHNICAL.md", "\nCurrent dependency: hono@^4.7.0\n")

    const result = checkDocFreshness(root)
    const report = formatDocFreshnessReport(result)

    assert.equal(result.ok, false)
    assert.equal(result.findings.dependencyClaims.length, 1)
    assert.equal(result.findings.dependencyClaims[0].packageName, "hono")
    assert.equal(result.findings.dependencyClaims[0].claimedVersion, "^4.7.0")
    assert.equal(result.findings.dependencyClaims[0].actualVersion, null)
    assert.equal(result.findings.dependencyClaims[0].manifestPath, null)
    assert.match(report, /hono@\^4\.7\.0/)
    assert.match(report, /has no approved manifest entry/)
  } finally {
    cleanup(root)
  }
})

test("TC-8d matching approved manifest version produces no dependency finding", () => {
  const root = createFixture()
  try {
    appendFile(root, "docs/TECHNICAL.md", "\nCurrent dependency: next@^15.0.0\n")

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.dependencyClaims, [])
  } finally {
    cleanup(root)
  }
})

test("TC-8d2 direct apps manifests are included in approved dependency truth", () => {
  const root = createFixture()
  try {
    writeJson(root, "apps/docs/package.json", {
      name: "@fixture/docs",
      private: true,
      dependencies: {
        marked: "^15.0.7",
      },
    })
    appendFile(root, "docs/TECHNICAL.md", "\nCurrent dependency: marked@^15.0.7\n")

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.dependencyClaims, [])
  } finally {
    cleanup(root)
  }
})

test("TC-8d3 current-guidance headings apply to the following pinned dependency bullet", () => {
  const root = createFixture()
  try {
    appendFile(
      root,
      "docs/TECHNICAL.md",
      [
        "",
        "Current dependencies:",
        "- next@^99.0.0",
      ].join("\n"),
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, false)
    assert.equal(result.findings.dependencyClaims.length, 1)
    assert.equal(result.findings.dependencyClaims[0].packageName, "next")
    assert.equal(result.findings.dependencyClaims[0].claimedVersion, "^99.0.0")
  } finally {
    cleanup(root)
  }
})

test("TC-8e current stale claim is reported while historical and example references are ignored", () => {
  const root = createFixture()
  try {
    appendFile(
      root,
      "docs/TECHNICAL.md",
      [
        "",
        "Current dependency: next@^99.0.0",
        "Historical note: next@^13.0.0 was removed during migration.",
        "Example snippet:",
        "```bash",
        "npm install next@^12.0.0",
        "```",
      ].join("\n"),
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, false)
    assert.equal(result.findings.dependencyClaims.length, 1)
    assert.equal(result.findings.dependencyClaims[0].packageName, "next")
    assert.equal(result.findings.dependencyClaims[0].claimedVersion, "^99.0.0")
  } finally {
    cleanup(root)
  }
})

test("TC-8e2 non-current headings suppress following pinned dependency bullets", () => {
  const root = createFixture()
  try {
    appendFile(
      root,
      "docs/TECHNICAL.md",
      [
        "",
        "Historical dependencies:",
        "- next@^99.0.0",
      ].join("\n"),
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.dependencyClaims, [])
  } finally {
    cleanup(root)
  }
})

test("TC-8f unversioned mentions do not create extra dependency findings", () => {
  const root = createFixture()
  try {
    appendFile(
      root,
      "docs/TECHNICAL.md",
      [
        "",
        "Current dependency: next@^99.0.0",
        "Next remains the framework for the UI workspace.",
        "The next upgrade needs coordination with React.",
      ].join("\n"),
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, false)
    assert.equal(result.findings.dependencyClaims.length, 1)
    assert.equal(result.findings.dependencyClaims[0].packageName, "next")
    assert.equal(result.findings.dependencyClaims[0].claimedVersion, "^99.0.0")
  } finally {
    cleanup(root)
  }
})

test("TC-9 deleted-path scan ignores out-of-scope docs", () => {
  const root = createFixture()
  try {
    appendFile(root, "notes/working-notes.md", "\nCurrent active code lives in `legacy/`.\n")

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.stalePaths, [])
  } finally {
    cleanup(root)
  }
})

test("TC-9b deleted-directory scan ignores nested docs below the approved ADR scope", () => {
  const root = createFixture()
  try {
    writeFile(
      root,
      "docs/adr/archive/old-decision.md",
      "# Archived\n\nCurrent active code lives in `legacy/`.\n",
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.stalePaths, [])
  } finally {
    cleanup(root)
  }
})

test("TC-10 active deleted directory in approved docs is reported", () => {
  const root = createFixture()
  try {
    appendFile(root, "docs/AGENTS.md", "\nCurrent active code lives in `legacy/`.\n")

    const result = checkDocFreshness(root)
    const report = formatDocFreshnessReport(result)

    assert.equal(result.ok, false)
    assert.equal(result.findings.stalePaths.length, 1)
    assert.equal(result.findings.stalePaths[0].referencedPath, "legacy/")
    assert.equal(result.findings.stalePaths[0].docPath, "docs/AGENTS.md")
    assert.match(report, /Stale active path references/)
    assert.match(report, /legacy\//)
    assert.match(report, /docs\/AGENTS\.md/)
  } finally {
    cleanup(root)
  }
})

test("TC-10b missing nested directory is reported even when its parent exists", () => {
  const root = createFixture()
  try {
    makeDir(root, "apps/engine/")
    appendFile(
      root,
      "docs/TECHNICAL.md",
      "\nCurrent engine feature code now lives in `apps/engine/legacy/`.\n",
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, false)
    assert.equal(result.findings.stalePaths.length, 1)
    assert.equal(
      result.findings.stalePaths[0].referencedPath,
      "apps/engine/legacy/",
    )
    assert.equal(result.findings.stalePaths[0].docPath, "docs/TECHNICAL.md")
  } finally {
    cleanup(root)
  }
})

test("TC-10c active directory reference is allowed when the directory exists", () => {
  const root = createFixture()
  try {
    makeDir(root, "legacy/")
    appendFile(root, "docs/AGENTS.md", "\nCurrent active code lives in `legacy/`.\n")

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.stalePaths, [])
  } finally {
    cleanup(root)
  }
})

test("TC-11 historical deleted-directory references are allowed", () => {
  const root = createFixture()
  try {
    appendFile(
      root,
      "docs/TECHNICAL.md",
      "\nHistorical note: `legacy/` was removed and is no longer active.\n",
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.stalePaths, [])
  } finally {
    cleanup(root)
  }
})

test("TC-11b active and historical mentions of the same missing directory are evaluated independently", () => {
  const root = createFixture()
  try {
    appendFile(
      root,
      "docs/TECHNICAL.md",
      [
        "",
        "Historical note: `legacy/` was removed and is no longer active.",
        "Current engine code lives in `legacy/`.",
      ].join("\n"),
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, false)
    assert.equal(result.findings.stalePaths.length, 1)
    assert.equal(result.findings.stalePaths[0].referencedPath, "legacy/")
    assert.equal(result.findings.stalePaths[0].lineNumber, 5)
  } finally {
    cleanup(root)
  }
})

test("TC-11c deleted-directory rule does not broaden into generic broken-link checking", () => {
  const root = createFixture()
  try {
    appendFile(
      root,
      "docs/TECHNICAL.md",
      [
        "",
        "Current engine code lives in `legacy/`.",
        "Current runbook file lives in `docs/missing-guide.md`.",
        "Current external guide: [Setup](https://example.invalid/setup).",
      ].join("\n"),
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, false)
    assert.equal(result.findings.stalePaths.length, 1)
    assert.equal(result.findings.stalePaths[0].referencedPath, "legacy/")
  } finally {
    cleanup(root)
  }
})

test("TC-11d deleted-directory rule returns empty results when all references are valid or historical", () => {
  const root = createFixture()
  try {
    makeDir(root, "legacy/")
    appendFile(
      root,
      "docs/TECHNICAL.md",
      [
        "",
        "Historical note: `retired/` was removed and is no longer active.",
        "Current engine code lives in `legacy/`.",
      ].join("\n"),
    )

    const result = checkDocFreshness(root)

    assert.equal(result.ok, true)
    assert.deepEqual(result.findings.stalePaths, [])
  } finally {
    cleanup(root)
  }
})

test("TC-12 root test path fails non-zero with grouped drift report", () => {
  const root = createFixture()
  try {
    makeCompletedProj(root, "PROJ-9", "missing-project")
    appendFile(root, "docs/TECHNICAL.md", "\nPinned dependency: next@^99.0.0\n")
    appendFile(root, "docs/AGENTS.md", "\nCurrent active code lives in `legacy/`.\n")

    const result = runFixtureNpmTest(root)
    const output = `${result.stdout}\n${result.stderr}`

    assert.notEqual(result.status, 0)
    assert.match(output, /Missing completed PROJs/)
    assert.match(output, /Dependency claim drift/)
    assert.match(output, /Stale active path references/)
    assert.match(output, /docs\/TECHNICAL\.md/)
    assert.match(output, /docs\/AGENTS\.md/)
  } finally {
    cleanup(root)
  }
})

test("TC-13 clean repo passes despite out-of-scope doc issues", () => {
  const root = createFixture()
  try {
    makeCompletedProj(root, "PROJ-2", "listed-project")
    appendFile(root, "notes/working-notes.md", "\nPinned candidate: next@^99.0.0\n")
    appendFile(root, "notes/working-notes.md", "Current active code lives in `legacy/`.\n")
    appendFile(root, "notes/working-notes.md", "Broken link: https://example.invalid/docs\n")

    const result = runFixtureNpmTest(root)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    cleanup(root)
  }
})
