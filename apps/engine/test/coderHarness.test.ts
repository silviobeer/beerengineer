import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { runCoderHarness } from "../src/llm/hosted/execution/coderHarness.js"
import { resetCodexSandboxPolicyForTests } from "../src/llm/hosted/providers/codexSandboxPolicy.js"
import type { StoryExecutionContext } from "../src/types/execution.js"

function makeStubBin(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8")
  chmodSync(path, 0o755)
  return path
}

function seedCleanGitRepo(root: string): void {
  spawnSync("git", ["init", "--initial-branch=master"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["config", "user.name", "test"], { cwd: root, encoding: "utf8" })
  writeFileSync(join(root, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: root, encoding: "utf8" })
}

function minimalStoryContext(workspaceRoot: string): StoryExecutionContext {
  return {
    kind: "feature",
    item: { slug: "demo", baseBranch: "master" },
    project: { id: "PROJ-15", name: "beerengineer_" },
    conceptSummary: "demo",
    story: {
      id: "REQ-15-2",
      title: "demo story",
      acceptanceCriteria: [],
    },
    architectureSummary: {
      summary: "demo",
      systemShape: "demo",
      constraints: [],
      relevantComponents: [],
      decisions: [],
    },
    wave: {
      id: "W1",
      number: 1,
      goal: "demo",
      dependencies: [],
    },
    worktreeRoot: workspaceRoot,
    primaryWorkspaceRoot: workspaceRoot,
    testPlan: {
      project: { id: "PROJ-15", name: "beerengineer_" },
      story: { id: "REQ-15-2", title: "demo story" },
      acceptanceCriteria: [],
      testPlan: {
        summary: "demo",
        testCases: [],
        fixtures: [],
        edgeCases: [],
        assumptions: [],
      },
    },
  }
}

test("runCoderHarness surfaces worker start failures with recovery-friendly wording", async () => {
  resetCodexSandboxPolicyForTests()
  const dir = mkdtempSync(join(tmpdir(), "be2-coder-harness-"))
  const binDir = join(dir, "bin")
  const previousPath = process.env.PATH

  try {
    seedCleanGitRepo(dir)
    makeStubBin(
      binDir,
      "codex",
      `
printf '%s\n' 'generic launch failure' >&2
exit 1
`,
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    await assert.rejects(
      () =>
        runCoderHarness({
          harness: {
            kind: "hosted",
            harness: "codex",
            runtime: "cli",
            provider: "openai",
            model: "gpt-5.4",
            workspaceRoot: dir,
          },
          runtimePolicy: { mode: "safe-workspace-write" },
          baselinePath: join(dir, "baseline.json"),
          storyContext: minimalStoryContext(dir),
        }),
      /worker start failed: .*generic launch failure/i,
    )
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})
