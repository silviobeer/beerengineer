import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createBus } from "../src/core/bus.js"
import { attachDbSync } from "../src/core/runOrchestrator.js"
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

function writeWorkspaceConfig(
  root: string,
  options: {
    dirtyMasterAllowlist?: string[]
    autoRestoreAllowlisted?: boolean
  } = {},
): void {
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
      ...(options.dirtyMasterAllowlist ? { dirtyMasterAllowlist: options.dirtyMasterAllowlist } : {}),
      ...(typeof options.autoRestoreAllowlisted === "boolean"
        ? { autoRestoreAllowlisted: options.autoRestoreAllowlisted }
        : {}),
      sonar: { enabled: false },
      reviewPolicy: {
        coderabbit: { enabled: false },
        sonarcloud: { enabled: false },
      },
      createdAt: Date.now(),
    }, null, 2),
  )
}

function trackedFileAtHead(root: string, path: string): string {
  const result = spawnSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

function commitTrackedFile(root: string, path: string, content: string, message: string): void {
  const parts = path.split("/")
  if (parts.length > 1) mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true })
  writeFileSync(join(root, path), content)
  git(root, ["add", path])
  git(root, ["commit", "-m", message])
}

function createStartRunFixture(root: string): {
  db: ReturnType<typeof initDatabase>
  repos: Repos
  runId: string
  itemId: string
  io: WorkflowIO
  events: WorkflowEvent[]
} {
  const db = initDatabase(":memory:")
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "allowlist", name: "Allowlist", rootPath: root })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Start me", description: "start" })
  const run = repos.createRun({
    workspaceId: workspace.id,
    itemId: item.id,
    title: item.title,
    owner: "api",
    workspaceFsId: `start-${item.id.toLowerCase()}`,
  })
  const events: WorkflowEvent[] = []
  const bus = createBus()
  bus.subscribe(event => events.push(event))
  attachDbSync(bus, repos, { runId: run.id, itemId: item.id })
  const io: WorkflowIO = {
    async ask() {
      throw new Error(SENTINEL_PROMPT_ERROR)
    },
    emit(event) {
      bus.emit(event)
    },
  }
  return { db, repos, runId: run.id, itemId: item.id, io, events }
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

test("runWorkflow defaults autoRestoreAllowlisted to true for tracked built-in allowlisted files", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-default-restore-"))
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root)
    commitTrackedFile(root, ".claude/scheduled_tasks.lock", "head lock\n", "track allowlisted lock")
    writeFileSync(join(root, ".claude", "scheduled_tasks.lock"), "dirty lock\n")

    const headContent = trackedFileAtHead(root, ".claude/scheduled_tasks.lock")
    const { db, repos, runId, itemId, io, events } = createStartRunFixture(root)
    try {
      await assert.rejects(
        () =>
          runWithWorkflowIO(io, () =>
            runWithActiveRun({ runId, itemId, title: "Start me" }, () =>
              runWorkflow(
                { id: itemId, title: "Start me", description: "probe" },
                { workspaceRoot: root },
              ),
            ),
          ),
        new RegExp(SENTINEL_PROMPT_ERROR),
      )

      assert.equal(events.some(event => event.type === "run_blocked"), false)
      assert.equal(readFileSync(join(root, ".claude", "scheduled_tasks.lock"), "utf8"), headContent)
      assert.equal(git(root, ["status", "--porcelain", "--", ".claude/scheduled_tasks.lock"]), "")
      assert.equal(repos.listLogsForRun(runId).filter(log => log.event_type === "dirty_master_allowlist_restore").length, 1)
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runWorkflow leaves tracked allowlisted files dirty when autoRestoreAllowlisted is false", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-no-restore-"))
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root, { autoRestoreAllowlisted: false })
    commitTrackedFile(root, ".claude/scheduled_tasks.lock", "head lock\n", "track allowlisted lock")
    writeFileSync(join(root, ".claude", "scheduled_tasks.lock"), "dirty lock\n")

    const { db, repos, runId, itemId, io, events } = createStartRunFixture(root)
    try {
      await assert.rejects(
        () =>
          runWithWorkflowIO(io, () =>
            runWithActiveRun({ runId, itemId, title: "Start me" }, () =>
              runWorkflow(
                { id: itemId, title: "Start me", description: "probe" },
                { workspaceRoot: root },
              ),
            ),
          ),
        new RegExp(SENTINEL_PROMPT_ERROR),
      )

      assert.equal(events.some(event => event.type === "run_blocked"), false)
      assert.equal(readFileSync(join(root, ".claude", "scheduled_tasks.lock"), "utf8"), "dirty lock\n")
      assert.match(git(root, ["status", "--porcelain", "--", ".claude/scheduled_tasks.lock"]), /\.claude\/scheduled_tasks\.lock/)
      assert.equal(repos.listLogsForRun(runId).filter(log => log.event_type === "dirty_master_allowlist_restore").length, 0)
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runWorkflow tolerates untracked allowlisted dirt without restoring it or emitting a restore event", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-untracked-allow-"))
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root, { dirtyMasterAllowlist: ["tmp/**/*.lock"] })
    mkdirSync(join(root, "tmp", "locks"), { recursive: true })
    writeFileSync(join(root, "tmp", "locks", "current.lock"), "temporary\n")

    const { db, repos, runId, itemId, io, events } = createStartRunFixture(root)
    try {
      await assert.rejects(
        () =>
          runWithWorkflowIO(io, () =>
            runWithActiveRun({ runId, itemId, title: "Start me" }, () =>
              runWorkflow(
                { id: itemId, title: "Start me", description: "probe" },
                { workspaceRoot: root },
              ),
            ),
          ),
        new RegExp(SENTINEL_PROMPT_ERROR),
      )

      assert.equal(events.some(event => event.type === "run_blocked"), false)
      assert.equal(readFileSync(join(root, "tmp", "locks", "current.lock"), "utf8"), "temporary\n")
      assert.match(git(root, ["status", "--porcelain", "--", "tmp/locks/current.lock"]), /tmp\/locks\/current\.lock/)
      assert.equal(repos.listLogsForRun(runId).filter(log => log.event_type === "dirty_master_allowlist_restore").length, 0)
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runWorkflow restores tracked allowlisted dirt but leaves untracked allowlisted dirt in place", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-mixed-allow-"))
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root, { dirtyMasterAllowlist: ["tmp/**/*.lock"] })
    commitTrackedFile(root, "tmp/locks/current.lock", "head lock\n", "track allowlisted temp lock")
    writeFileSync(join(root, "tmp", "locks", "current.lock"), "dirty tracked lock\n")
    writeFileSync(join(root, "tmp", "locks", "scratch.lock"), "untracked lock\n")

    const headContent = trackedFileAtHead(root, "tmp/locks/current.lock")
    const { db, repos, runId, itemId, io, events } = createStartRunFixture(root)
    try {
      await assert.rejects(
        () =>
          runWithWorkflowIO(io, () =>
            runWithActiveRun({ runId, itemId, title: "Start me" }, () =>
              runWorkflow(
                { id: itemId, title: "Start me", description: "probe" },
                { workspaceRoot: root },
              ),
            ),
          ),
        new RegExp(SENTINEL_PROMPT_ERROR),
      )

      assert.equal(events.some(event => event.type === "run_blocked"), false)
      assert.equal(readFileSync(join(root, "tmp", "locks", "current.lock"), "utf8"), headContent)
      assert.equal(readFileSync(join(root, "tmp", "locks", "scratch.lock"), "utf8"), "untracked lock\n")
      assert.equal(git(root, ["status", "--porcelain", "--", "tmp/locks/current.lock"]), "")
      assert.match(git(root, ["status", "--porcelain", "--", "tmp/locks/scratch.lock"]), /tmp\/locks\/scratch\.lock/)
      assert.equal(repos.listLogsForRun(runId).filter(log => log.event_type === "dirty_master_allowlist_restore").length, 1)
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("one gate evaluation restoring multiple tracked allowlisted files emits exactly one restore event", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-multi-restore-"))
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root, { dirtyMasterAllowlist: ["tmp/**/*.lock"] })
    commitTrackedFile(root, "tmp/locks/one.lock", "one head\n", "track one")
    commitTrackedFile(root, "tmp/locks/two.lock", "two head\n", "track two")
    writeFileSync(join(root, "tmp", "locks", "one.lock"), "one dirty\n")
    writeFileSync(join(root, "tmp", "locks", "two.lock"), "two dirty\n")

    const { db, repos, runId, itemId, io } = createStartRunFixture(root)
    try {
      await assert.rejects(
        () =>
          runWithWorkflowIO(io, () =>
            runWithActiveRun({ runId, itemId, title: "Start me" }, () =>
              runWorkflow(
                { id: itemId, title: "Start me", description: "probe" },
                { workspaceRoot: root },
              ),
            ),
          ),
        new RegExp(SENTINEL_PROMPT_ERROR),
      )

      assert.equal(git(root, ["status", "--porcelain", "--", "tmp/locks/one.lock", "tmp/locks/two.lock"]), "")
      assert.equal(repos.listLogsForRun(runId).filter(log => log.event_type === "dirty_master_allowlist_restore").length, 1)
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runWorkflow restores allowlisted tracked dirt but still blocks on non-allowlisted changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-block-mixed-"))
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root)
    commitTrackedFile(root, ".claude/scheduled_tasks.lock", "head lock\n", "track allowlisted lock")
    writeFileSync(join(root, ".claude", "scheduled_tasks.lock"), "dirty lock\n")
    writeFileSync(join(root, "real-dirty.txt"), "block me\n")

    const headContent = trackedFileAtHead(root, ".claude/scheduled_tasks.lock")
    const { db, repos, runId, itemId, io, events } = createStartRunFixture(root)
    try {
      await assert.rejects(
        () =>
          runWithWorkflowIO(io, () =>
            runWithActiveRun({ runId, itemId, title: "Start me" }, () =>
              runWorkflow(
                { id: itemId, title: "Start me", description: "probe" },
                { workspaceRoot: root },
              ),
            ),
          ),
        /Strategy violation: main\/master must stay clean/i,
      )

      assert.equal(readFileSync(join(root, ".claude", "scheduled_tasks.lock"), "utf8"), headContent)
      assert.equal(readFileSync(join(root, "real-dirty.txt"), "utf8"), "block me\n")
      assert.equal(git(root, ["status", "--porcelain", "--", ".claude/scheduled_tasks.lock"]), "")
      assert.match(git(root, ["status", "--porcelain", "--", "real-dirty.txt"]), /real-dirty\.txt/)
      assert.equal(repos.listLogsForRun(runId).filter(log => log.event_type === "dirty_master_allowlist_restore").length, 1)
      const blocked = events.find(event => event.type === "run_blocked")
      assert.ok(blocked, "expected run_blocked event")
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runWorkflow surfaces restore failures and does not proceed as clean", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-restore-fail-"))
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root)
    commitTrackedFile(root, ".claude/scheduled_tasks.lock", "head lock\n", "track allowlisted lock")
    writeFileSync(join(root, ".claude", "scheduled_tasks.lock"), "dirty lock\n")
    chmodSync(join(root, ".claude"), 0o555)
    chmodSync(join(root, ".claude", "scheduled_tasks.lock"), 0o444)

    const { db, repos, runId, itemId, io, events } = createStartRunFixture(root)
    try {
      await assert.rejects(
        () =>
          runWithWorkflowIO(io, () =>
            runWithActiveRun({ runId, itemId, title: "Start me" }, () =>
              runWorkflow(
                { id: itemId, title: "Start me", description: "probe" },
                { workspaceRoot: root },
              ),
            ),
          ),
        /allowlisted restore failed/i,
      )

      const blocked = events.find(event => event.type === "run_blocked")
      assert.ok(blocked, "expected run_blocked event")
      if (blocked?.type === "run_blocked") {
        assert.match(blocked.summary, /allowlisted restore failed/i)
      }
      assert.equal(repos.listLogsForRun(runId).filter(log => log.event_type === "dirty_master_allowlist_restore").length, 1)
      assert.equal(events.some(event => event.type === "run_finished"), false)
    } finally {
      db.close()
    }
  } finally {
    try {
      chmodSync(join(root, ".claude"), 0o755)
      chmodSync(join(root, ".claude", "scheduled_tasks.lock"), 0o644)
    } catch {}
    rmSync(root, { recursive: true, force: true })
  }
})

test("performResume applies the same tracked allowlisted restore behavior as start", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-dirty-master-resume-restore-"))
  const events: WorkflowEvent[] = []
  const bus = createBus()
  bus.subscribe(event => events.push(event))
  try {
    seedGitRepo(root)
    writeWorkspaceConfig(root)
    commitTrackedFile(root, ".claude/scheduled_tasks.lock", "head lock\n", "track allowlisted lock")
    writeFileSync(join(root, ".claude", "scheduled_tasks.lock"), "dirty lock\n")

    const headContent = trackedFileAtHead(root, ".claude/scheduled_tasks.lock")
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
        /worker start failed|dirty-master-gate-passed/,
      )

      assert.equal(events.some(event => event.type === "run_blocked"), false)
      assert.equal(events.some(event => event.type === "run_resumed"), true)
      assert.equal(readFileSync(join(root, ".claude", "scheduled_tasks.lock"), "utf8"), headContent)
      assert.equal(git(root, ["status", "--porcelain", "--", ".claude/scheduled_tasks.lock"]), "")
      assert.equal(repos.listLogsForRun(runId).filter(log => log.event_type === "dirty_master_allowlist_restore").length, 1)
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
