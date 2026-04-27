import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { collectProjectReviewRepoEvidence } from "../src/stages/project-review/index.js"
import { branchNameProject } from "../src/core/branchNames.js"
import type { WithExecution } from "../src/types.js"

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

function makeContext(workspaceRoot: string): WithExecution {
  return {
    workspaceId: "ws",
    runId: "run-1",
    itemSlug: "smoke-item",
    baseBranch: "main",
    workspaceRoot,
    project: {
      id: "P01",
      name: "Smoke Test End To End",
      description: "desc",
      concept: { summary: "s", problem: "p", users: ["u"], constraints: ["c"] },
    },
    prd: {
      stories: [{ id: "US-01", title: "Title", acceptanceCriteria: [] }],
    },
    architecture: {
      project: { id: "P01", name: "Smoke Test End To End", description: "desc" },
      concept: { summary: "s", problem: "p", users: ["u"], constraints: ["c"] },
      prdSummary: { storyCount: 1, storyIds: ["US-01"] },
      architecture: {
        summary: "arch",
        systemShape: "shape",
        components: [],
        dataModelNotes: [],
        apiNotes: [],
        deploymentNotes: [],
        constraints: [],
        risks: [],
        openQuestions: [],
      },
    },
    plan: {
      project: { id: "P01", name: "Smoke Test End To End" },
      conceptSummary: "concept",
      architectureSummary: "arch",
      plan: {
        summary: "plan",
        assumptions: [],
        sequencingNotes: [],
        dependencies: [],
        risks: [],
        waves: [
          {
            id: "W1",
            number: 1,
            goal: "goal",
            stories: [{ id: "SMOKE-001", title: "story" }],
            internallyParallelizable: false,
            dependencies: [],
            exitCriteria: [],
          },
        ],
      },
    },
    executionSummaries: [
      {
        waveId: "W1",
        waveBranch: "wave/smoke-item__p01__w1",
        projectBranch: "proj/smoke-item__p01",
        storiesMerged: [
          {
            storyId: "SMOKE-001",
            branch: "story/smoke-item__p01__w1__smoke-001",
            commitCount: 1,
            filesIntegrated: [
              "docs/QA-RESULTS.md",
              "public/index.html",
              "tests/smoke-test.test.js",
              "node_modules/express/index.js",
            ],
          },
        ],
        storiesBlocked: [],
      },
    ],
  }
}

test("collectProjectReviewRepoEvidence reads tracked files from the project branch and ignores transient review targets", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-project-review-"))
  try {
    git(root, "init", "--initial-branch=main")
    git(root, "config", "user.email", "test@example.invalid")
    git(root, "config", "user.name", "test")
    writeFileSync(join(root, "README.md"), "# seed\n")
    git(root, "add", "-A")
    git(root, "commit", "-m", "seed")

    const ctx = makeContext(root)
    const projectBranch = branchNameProject(ctx, ctx.project.id)
    git(root, "checkout", "-b", projectBranch)
    mkdirSync(join(root, "docs"), { recursive: true })
    mkdirSync(join(root, "public"), { recursive: true })
    mkdirSync(join(root, "tests"), { recursive: true })
    writeFileSync(join(root, "docs", "QA-RESULTS.md"), "Exact title verified.\n")
    writeFileSync(join(root, "public", "index.html"), "<!doctype html><html><head><title>Hello, World! - Workflow Smoke Test</title></head><body></body></html>\n")
    writeFileSync(join(root, "tests", "smoke-test.test.js"), "console.log('ok')\n")
    writeFileSync(join(root, "package.json"), "{\"name\":\"demo\"}\n")
    git(root, "add", "-A")
    git(root, "commit", "-m", "project files")

    const evidence = collectProjectReviewRepoEvidence(ctx)
    assert.ok(evidence)
    assert.equal(evidence?.branch, projectBranch)
    assert.ok((evidence?.trackedFileCount ?? 0) >= 5)
    assert.ok(evidence?.trackedFilesSample.includes("public/index.html"))
    assert.ok(evidence?.checkedFiles.some(file => file.path === "docs/QA-RESULTS.md" && file.exists))
    assert.ok(evidence?.checkedFiles.some(file => file.path === "public/index.html" && file.exists))
    assert.equal(evidence?.checkedFiles.some(file => file.path.startsWith("node_modules/")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
