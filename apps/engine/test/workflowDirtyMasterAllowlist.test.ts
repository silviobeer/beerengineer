import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createBus } from "../src/core/bus.js"
import { runWithWorkflowIO, type WorkflowEvent, type WorkflowIO } from "../src/core/io.js"
import { runWithActiveRun } from "../src/core/runContext.js"
import { layout } from "../src/core/workspaceLayout.js"
import { performResume } from "../src/core/resume.js"
import { runWorkflow } from "../src/workflow.ts"

const SENTINEL_PROMPT_ERROR = "dirty-master-gate-passed"

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}

function seedGitRepo(root: string): void {
  git(root, ["init", "--initial-branch=master"])
  git(root, ["config", "user.email", "test@example.invalid"])
  git(root, ["config", "user.name", "test"])
  writeFileSync(join(root, "README.md"), "seed\n")
  git(root, ["add", "-A"])
  git(root, ["commit", "-m", "seed"])
  git(root, ["remote", "add", "origin", "https://github.com/acme/demo.git"])
  git(root, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"])
}

function writeWorkspaceConfig(root: string, dirtyMasterAllowlist?: string[]): void {
  mkdirSync(join(root, ".beerengineer"), { recursive: true })
  writeFileSync(
    join(root, ".beerengineer", "workspace.json"),
    JSON.stringify({
      schemaVersion: 2,
      key: "allowlist",
      name: "Allowlist",
      harnessProfile: { mode: "claude-first" },
      runtimePolicy: {
        stageAuthoring: "safe-readonly",
        reviewer: "safe-readonly",
        coderExecution: "safe-workspace-write",
      },
      ...(dirtyMasterAllowlist ? { dirtyMasterAllowlist } : {}),
      sonar: { enabled: false },
      reviewPolicy: {
        coderabbit: { enabled: false },
        sonarcloud: { enabled: false },
      },
      createdAt: Date.now(),
    }, null, 2),
  )
}

function makeGateProbeIo(events: WorkflowEvent[]): WorkflowIO {
  return {
    async ask() {
      throw new Error(SENTINEL_PROMPT_ERROR)
    },
    emit(event) {
      events.push(event)
    },
  }
}

function createResumableRunFixture(root: string): {
  db: ReturnType<typeof initDatabase>
  repos: Repos
  runId: string
  remediationId: string
} {
  const db = initDatabase(":memory:")
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "allowlist", name: "Allowlist", rootPath: root })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Resume me", description: "resume" })
  const run = repos.createRun({
    workspaceId: workspace.id,
    itemId: item.id,
    title: item.title,
    owner: "api",
    workspaceFsId: `resume-${item.id.toLowerCase()}`,
  })
  repos.updateRun(run.id, {
    status: "blocked",
    current_stage: "brainstorm",
    recovery_status: "blocked",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: "Blocked for test resume.",
  })

  const ctx = { workspaceId: run.workspace_fs_id, workspaceRoot: root, runId: run.id }
  mkdirSync(layout.runDir(ctx), { recursive: true })
  writeFileSync(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)

  const remediation = repos.createExternalRemediation({
    runId: run.id,
    scope: "run",
    scopeRef: null,
    summary: "Fixed external blocker.",
    source: "api",
  })

  return { db, repos, runId: run.id, remediationId: remediation.id }
}

test("runWorkflow allows built-in and configured allowlisted master dirt without blocking or mutating master", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-allow-"))
  const events: WorkflowEvent[] = []
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root, ["tmp/**/*.lock"])
    mkdirSync(join(root, ".claude"), { recursive: true })
    mkdirSync(join(root, "tmp", "locks"), { recursive: true })
    writeFileSync(join(root, ".claude", "scheduled_tasks.lock"), "locked\n")
    writeFileSync(join(root, "tmp", "locks", "current.lock"), "temporary\n")

    const headBefore = git(root, ["rev-parse", "HEAD"])
    const gitignorePath = join(root, ".gitignore")
    const gitignoreBefore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : null

    await assert.rejects(
      () =>
        runWithWorkflowIO(makeGateProbeIo(events), () =>
          runWithActiveRun({ runId: "run-allow", itemId: "item-allow" }, () =>
            runWorkflow(
              { id: "item-allow", title: "Allowlisted dirt", description: "probe" },
              { workspaceRoot: root },
            ),
          ),
        ),
      new RegExp(SENTINEL_PROMPT_ERROR),
    )

    assert.equal(events.some(event => event.type === "run_blocked"), false)
    assert.equal(git(root, ["rev-parse", "HEAD"]), headBefore)
    assert.equal(existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : null, gitignoreBefore)
    const status = git(root, ["status", "--porcelain", "--", ".claude/scheduled_tasks.lock", "tmp/locks/current.lock"])
    assert.match(status, /\.claude\/scheduled_tasks\.lock/)
    assert.match(status, /tmp\/locks\/current\.lock/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runWorkflow blocks master dirt when any path is outside the allowlist", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-mixed-"))
  const events: WorkflowEvent[] = []
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root, [])
    mkdirSync(join(root, ".claude"), { recursive: true })
    writeFileSync(join(root, ".claude", "scheduled_tasks.lock"), "locked\n")
    writeFileSync(join(root, "real-dirty.txt"), "block me\n")

    await assert.rejects(
      () =>
        runWithWorkflowIO(makeGateProbeIo(events), () =>
          runWithActiveRun({ runId: "run-mixed", itemId: "item-mixed" }, () =>
            runWorkflow(
              { id: "item-mixed", title: "Mixed dirt", description: "probe" },
              { workspaceRoot: root },
            ),
          ),
        ),
      /Strategy violation: main\/master must stay clean/i,
    )

    const blocked = events.find(event => event.type === "run_blocked")
    assert.ok(blocked, "expected run_blocked event")
    if (blocked?.type === "run_blocked") {
      assert.match(blocked.summary, /Strategy violation/i)
      assert.match(blocked.summary, /main\/master/i)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("performResume allows fully allowlisted master dirt", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-resume-allow-"))
  const events: WorkflowEvent[] = []
  const bus = createBus()
  bus.subscribe(event => events.push(event))
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root, [])
    mkdirSync(join(root, ".claude"), { recursive: true })
    writeFileSync(join(root, ".claude", "scheduled_tasks.lock"), "locked\n")

    const { db, repos, runId, remediationId } = createResumableRunFixture(root)
    try {
      const io: WorkflowIO & { bus: typeof bus } = {
        bus,
        async ask() {
          throw new Error(SENTINEL_PROMPT_ERROR)
        },
        emit(event) {
          bus.emit(event)
        },
      }

      await assert.rejects(
        () =>
          performResume({
            repos,
            io,
            runId,
            remediation: repos.getExternalRemediation(remediationId)!,
          }),
        new RegExp(SENTINEL_PROMPT_ERROR),
      )

      assert.equal(events.some(event => event.type === "run_blocked"), false)
      assert.equal(events.some(event => event.type === "run_resumed"), true)
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("performResume still blocks master dirt outside the allowlist", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-resume-block-"))
  const events: WorkflowEvent[] = []
  const bus = createBus()
  bus.subscribe(event => events.push(event))
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root, [])
    mkdirSync(join(root, ".claude"), { recursive: true })
    writeFileSync(join(root, ".claude", "scheduled_tasks.lock"), "locked\n")
    writeFileSync(join(root, "real-dirty.txt"), "block me\n")

    const { db, repos, runId, remediationId } = createResumableRunFixture(root)
    try {
      const io: WorkflowIO & { bus: typeof bus } = {
        bus,
        async ask() {
          throw new Error(SENTINEL_PROMPT_ERROR)
        },
        emit(event) {
          bus.emit(event)
        },
      }

      await performResume({
        repos,
        io,
        runId,
        remediation: repos.getExternalRemediation(remediationId)!,
      })

      const blocked = events.find(event => event.type === "run_blocked")
      assert.ok(blocked, "expected run_blocked event")
      if (blocked?.type === "run_blocked") {
        assert.match(blocked.summary, /Strategy violation/i)
      }
      assert.equal(events.some(event => event.type === "run_finished"), false)
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
