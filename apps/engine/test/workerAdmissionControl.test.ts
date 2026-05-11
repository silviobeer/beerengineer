import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import { createBus, busToWorkflowIO } from "../src/core/bus.js"
import { prepareRun } from "../src/core/runOrchestrator.js"
import { writeRecoveryRecord } from "../src/core/recovery.js"
import {
  autoResumeRunOnStartup,
  prepareForegroundIdeaRun,
  prepareForegroundResumeRun,
} from "../src/core/runService.js"
import {
  createWorkerAdmissionController,
  resolveEffectiveWorkerCap,
} from "../src/core/workerAdmission.js"
import { layout } from "../src/core/workspaceLayout.js"
import { buildReadyResponse } from "../src/api/health.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { recoverLostWorkerRuns } from "../src/core/orphanRecovery.js"
import { claimWorkerLease } from "../src/core/workerLease.js"

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeIo() {
  const bus = createBus()
  return { ...busToWorkflowIO(bus), bus }
}

function fakeScheduler() {
  const intervals: Array<{ callback: () => void; ms: number; cleared: boolean }> = []
  return {
    intervals,
    scheduler: {
      setInterval(callback: () => void, ms: number): number {
        intervals.push({ callback, ms, cleared: false })
        return intervals.length - 1
      },
      clearInterval(id: number): void {
        if (intervals[id]) intervals[id]!.cleared = true
      },
    },
  }
}

async function waitFor(check: () => boolean, message: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 2_000) {
    if (check()) return
    await delay(10)
  }
  assert.fail(message)
}

function tempRepos(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  const workspaceRoot = join(dir, "workspace")
  mkdirSync(workspaceRoot, { recursive: true })
  const workspace = repos.upsertWorkspace({ key: "default", name: "Default", rootPath: workspaceRoot })
  return {
    dir,
    db,
    repos,
    workspace,
    close() {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

async function seedRecoverableRun(
  repos: Repos,
  workspace: { id: string; root_path: string | null },
  input: {
    title: string
    workspaceFsId: string
    recoveryStatus?: "blocked" | "failed"
    recoverySummary?: string
  },
) {
  const item = repos.createItem({ workspaceId: workspace.id, title: input.title, description: "resume target" })
  const run = repos.createRun({
    workspaceId: workspace.id,
    itemId: item.id,
    title: item.title,
    owner: "api",
    workspaceFsId: input.workspaceFsId,
  })
  const ctx = { workspaceId: input.workspaceFsId, workspaceRoot: workspace.root_path!, runId: run.id }
  mkdirSync(dirname(layout.runFile(ctx)), { recursive: true })
  writeFileSync(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)
  await writeRecoveryRecord(ctx, {
    status: input.recoveryStatus ?? "blocked",
    cause: "system_error",
    scope: { type: "run", runId: run.id },
    summary: input.recoverySummary ?? "Needs resume.",
    evidencePaths: [],
  })
  repos.updateRun(run.id, {
    status: "failed",
    recovery_status: input.recoveryStatus ?? "blocked",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: input.recoverySummary ?? "Needs resume.",
  })
  return { item, run }
}

test("REQ-1 AC-1.5 clamps a derived worker cap below one up to one", () => {
  const policy = resolveEffectiveWorkerCap({
    totalMemoryBytes: 1,
    workerMemoryBytes: 2,
  })

  assert.equal(policy.effectiveWorkerCap, 1)
  assert.equal(policy.source, "host_memory")
  assert.equal(policy.rawDerivedCap, 0)
})

test("REQ-1 AC-1.1 AC-1.2 AC-1.3 AC-1.8 queues excess fresh work and auto-refills when a slot frees", async () => {
  const { repos, workspace, close } = tempRepos("be2-admission-fresh-")
  const scheduled = fakeScheduler()
  const controller = createWorkerAdmissionController(repos, {
    effectiveWorkerCap: 2,
    source: "override",
    overrideCap: 2,
    rawDerivedCap: 2,
    totalMemoryBytes: null,
    workerMemoryBytes: null,
  }, {
    scheduler: scheduled.scheduler,
    reconciliationIntervalMs: 1_000,
  })
  const blockers = new Map<string, ReturnType<typeof deferred>>()

  try {
    const makePrepared = (title: string) => prepareForegroundIdeaRun(repos, makeIo(), {
      title,
      description: title,
      workspaceKey: workspace.key,
      admissionController: controller,
      workerLeaseScheduler: scheduled.scheduler,
      prepareRunImpl: (item, workflowRepos, workflowIo, opts) =>
        prepareRun(item, workflowRepos, workflowIo, {
          ...opts,
          workflowRunner: async (_item, options) => {
            const runId = options.executionOwnership?.runId
            assert.ok(runId, "workflow runner must receive a runId")
            await blockers.get(runId!)!.promise
          },
        }),
    })

    const first = makePrepared("first")
    const second = makePrepared("second")
    const third = makePrepared("third")
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(third.ok, true)
    if (!first.ok || !second.ok || !third.ok) return

    blockers.set(first.runId, deferred())
    blockers.set(second.runId, deferred())
    blockers.set(third.runId, deferred())

    const firstPromise = first.start()
    const secondPromise = second.start()
    const thirdPromise = third.start()

    await waitFor(
      () =>
        repos.listRunningRuns().length === 2
        && repos.getRun(third.runId)?.status === "queued"
        && repos.getRun(third.runId)?.worker_instance_id == null,
      "expected two active runs and one queued run",
    )

    blockers.get(first.runId)!.resolve()
    await firstPromise

    await waitFor(
      () =>
        repos.getRun(third.runId)?.status === "running"
        && repos.getRun(third.runId)?.worker_instance_id != null,
      "expected the queued run to start after the first worker completed",
    )

    blockers.get(second.runId)!.resolve()
    blockers.get(third.runId)!.resolve()
    await secondPromise
    await thirdPromise
    await delay(25)
  } finally {
    controller.dispose()
    close()
  }
})

test("REQ-1 AC-1.1 AC-1.2 keeps one global cap across fresh starts and resumes", async () => {
  const { repos, workspace, close } = tempRepos("be2-admission-mixed-")
  const scheduled = fakeScheduler()
  const controller = createWorkerAdmissionController(repos, {
    effectiveWorkerCap: 2,
    source: "override",
    overrideCap: 2,
    rawDerivedCap: 2,
    totalMemoryBytes: null,
    workerMemoryBytes: null,
  }, {
    scheduler: scheduled.scheduler,
    reconciliationIntervalMs: 1_000,
  })
  const freshBlocker = deferred()
  const resumeBlocker = deferred()
  const queuedBlocker = deferred()

  try {
    const fresh = prepareForegroundIdeaRun(repos, makeIo(), {
      title: "fresh",
      description: "fresh",
      workspaceKey: workspace.key,
      admissionController: controller,
      workerLeaseScheduler: scheduled.scheduler,
      prepareRunImpl: (item, workflowRepos, workflowIo, opts) =>
        prepareRun(item, workflowRepos, workflowIo, {
          ...opts,
          workflowRunner: async () => {
            await freshBlocker.promise
          },
        }),
    })
    assert.equal(fresh.ok, true)
    if (!fresh.ok) return

    const resumeTarget = await seedRecoverableRun(repos, workspace, {
      title: "resume",
      workspaceFsId: `resume-${Date.now()}`,
    })
    const resume = await prepareForegroundResumeRun(repos, makeIo(), {
      runId: resumeTarget.run.id,
      summary: "resume it",
      workerOwnerKind: "api",
      admissionController: controller,
      workerLeaseScheduler: scheduled.scheduler,
      resumeRunImpl: async input => {
        repos.updateRun(input.runId, { status: "running", recovery_status: null, recovery_scope: null, recovery_scope_ref: null, recovery_summary: null })
        await resumeBlocker.promise
        repos.updateRun(input.runId, { status: "completed" })
      },
    })
    assert.equal(resume.ok, true)
    if (!resume.ok) return

    const freshPromise = fresh.start()
    const resumePromise = resume.start()

    await waitFor(
      () => repos.listRunningRuns().length === 2,
      "expected the fresh start and resume to consume the global cap first",
    )

    const queued = prepareForegroundIdeaRun(repos, makeIo(), {
      title: "queued",
      description: "queued",
      workspaceKey: workspace.key,
      admissionController: controller,
      workerLeaseScheduler: scheduled.scheduler,
      prepareRunImpl: (item, workflowRepos, workflowIo, opts) =>
        prepareRun(item, workflowRepos, workflowIo, {
          ...opts,
          workflowRunner: async () => {
            await queuedBlocker.promise
          },
        }),
    })
    assert.equal(queued.ok, true)
    if (!queued.ok) return
    const queuedPromise = queued.start()

    await waitFor(
      () =>
        repos.getRun(queued.runId)?.status === "queued"
        && repos.getRun(queued.runId)?.worker_instance_id == null,
      "expected the queued fresh start to wait behind the fresh+resume pair",
    )

    freshBlocker.resolve()
    await freshPromise

    await waitFor(
      () => repos.getRun(queued.runId)?.status === "running",
      "expected the queued fresh start to begin after capacity freed from either source",
    )

    resumeBlocker.resolve()
    queuedBlocker.resolve()
    await resumePromise
    await queuedPromise
    await delay(25)
  } finally {
    controller.dispose()
    close()
  }
})

test("REQ-1 AC-1.2 admits queued work on reconciliation after a missed direct release signal", async () => {
  const { repos, workspace, close } = tempRepos("be2-admission-reconcile-")
  const scheduled = fakeScheduler()
  const controller = createWorkerAdmissionController(repos, {
    effectiveWorkerCap: 1,
    source: "override",
    overrideCap: 1,
    rawDerivedCap: 1,
    totalMemoryBytes: null,
    workerMemoryBytes: null,
  }, {
    scheduler: scheduled.scheduler,
    reconciliationIntervalMs: 1_000,
  })
  const blocker = deferred()
  const queuedBlocker = deferred()

  try {
    const first = prepareForegroundIdeaRun(repos, makeIo(), {
      title: "first",
      description: "first",
      workspaceKey: workspace.key,
      admissionController: controller,
      workerLeaseScheduler: scheduled.scheduler,
      prepareRunImpl: (item, workflowRepos, workflowIo, opts) =>
        prepareRun(item, workflowRepos, workflowIo, {
          ...opts,
          workflowRunner: async () => {
            await blocker.promise
          },
        }),
    })
    assert.equal(first.ok, true)
    if (!first.ok) return

    const firstPromise = first.start()

    await waitFor(
      () => repos.listRunningRuns().length === 1,
      "expected the first run to consume the only worker slot",
    )

    const second = prepareForegroundIdeaRun(repos, makeIo(), {
      title: "second",
      description: "second",
      workspaceKey: workspace.key,
      admissionController: controller,
      workerLeaseScheduler: scheduled.scheduler,
      prepareRunImpl: (item, workflowRepos, workflowIo, opts) =>
        prepareRun(item, workflowRepos, workflowIo, {
          ...opts,
          workflowRunner: async () => {
            await queuedBlocker.promise
          },
        }),
    })
    assert.equal(second.ok, true)
    if (!second.ok) return
    const secondPromise = second.start()

    await waitFor(
      () => repos.getRun(second.runId)?.status === "queued",
      "expected the second run to wait for capacity",
    )

    repos.updateRun(first.runId, { status: "completed" })
    scheduled.intervals.find(interval => interval.ms === 1_000)?.callback()

    await waitFor(
      () => repos.getRun(second.runId)?.status === "running",
      "expected reconciliation to admit the queued run",
    )

    blocker.resolve()
    queuedBlocker.resolve()
    await firstPromise
    await secondPromise
    await delay(25)
  } finally {
    controller.dispose()
    close()
  }
})

test("REQ-1 AC-1.7 exposes the effective worker cap through /ready", () => {
  const { db, repos, close } = tempRepos("be2-admission-ready-")
  const controller = createWorkerAdmissionController(repos, {
    effectiveWorkerCap: 3,
    source: "override",
    overrideCap: 3,
    rawDerivedCap: 3,
    totalMemoryBytes: null,
    workerMemoryBytes: null,
  })

  try {
    const response = buildReadyResponse(db, repos, {
      startupRecoveryComplete: true,
      shutdownInFlight: false,
    })

    assert.equal(response.status, 200)
    assert.equal(response.body.effectiveWorkerCap, 3)
  } finally {
    controller.dispose()
    close()
  }
})

test("REQ-2 AC-2.1 AC-2.5 startup auto-resume re-enters through the same worker cap as fresh work", async () => {
  const { repos, workspace, close } = tempRepos("be2-admission-startup-recovery-")
  const scheduled = fakeScheduler()
  const controller = createWorkerAdmissionController(repos, {
    effectiveWorkerCap: 1,
    source: "override",
    overrideCap: 1,
    rawDerivedCap: 1,
    totalMemoryBytes: null,
    workerMemoryBytes: null,
  }, {
    scheduler: scheduled.scheduler,
    reconciliationIntervalMs: 1_000,
  })
  const staleRunBlocker = deferred()
  const freshRunBlocker = deferred()

  try {
    const item = repos.createItem({ workspaceId: workspace.id, title: "startup stale", description: "startup stale" })
    const workspaceFsId = `startup-recovery-${Date.now()}`
    const staleRun = repos.createRun({
      workspaceId: workspace.id,
      itemId: item.id,
      title: item.title,
      owner: "cli",
      workspaceFsId,
    })
    repos.updateRun(staleRun.id, { current_stage: "execution" })
    const ctx = { workspaceId: workspaceFsId, workspaceRoot: workspace.root_path!, runId: staleRun.id }
    mkdirSync(dirname(layout.runFile(ctx)), { recursive: true })
    writeFileSync(layout.runFile(ctx), `${JSON.stringify({ id: staleRun.id }, null, 2)}\n`)
    claimWorkerLease(repos, {
      runId: staleRun.id,
      workerInstanceId: "cli-stale",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })

    const recovery = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
      autoResume: {
        enabled: true,
        recoveryThreshold: controller.resolution.effectiveWorkerCap,
        resumeRun: async run => {
          const result = await autoResumeRunOnStartup(repos, {
            runId: run.id,
            summary: "Startup auto-resumed the stale run after confirming no human input is pending.",
            resumeRunImpl: async input => {
              repos.clearRunRecovery(input.runId)
              repos.updateRun(input.runId, { status: "running", current_stage: "execution" })
              await staleRunBlocker.promise
              repos.updateRun(input.runId, { status: "completed" })
            },
          })
          assert.equal(result.ok, true)
        },
      },
    })

    assert.deepEqual(recovery.outcomes.map(outcome => outcome.outcome), ["auto_resumed"])
    await waitFor(
      () => repos.getRun(staleRun.id)?.status === "running",
      "expected the stale run to auto-resume into the only worker slot",
    )

    const fresh = prepareForegroundIdeaRun(repos, makeIo(), {
      title: "fresh after restart",
      description: "fresh after restart",
      workspaceKey: workspace.key,
      admissionController: controller,
      workerLeaseScheduler: scheduled.scheduler,
      prepareRunImpl: (runItem, workflowRepos, workflowIo, opts) =>
        prepareRun(runItem, workflowRepos, workflowIo, {
          ...opts,
          workflowRunner: async () => {
            await freshRunBlocker.promise
          },
        }),
    })
    assert.equal(fresh.ok, true)
    if (!fresh.ok) return
    const freshPromise = fresh.start()

    await waitFor(
      () =>
        repos.getRun(fresh.runId)?.status === "queued"
        && repos.getRun(fresh.runId)?.worker_instance_id == null,
      "expected new work to queue behind the auto-resumed stale run",
    )

    staleRunBlocker.resolve()

    await waitFor(
      () => repos.getRun(fresh.runId)?.status === "running",
      "expected the queued fresh run to start after the recovered run released capacity",
    )

    freshRunBlocker.resolve()
    await freshPromise
    await delay(25)
  } finally {
    controller.dispose()
    close()
  }
})

test("REQ-2 AC-2.4 AC-2.6 manual resume of one held-back run queues only that run and leaves siblings untouched", async () => {
  const { repos, workspace, close } = tempRepos("be2-admission-held-back-resume-")
  const scheduled = fakeScheduler()
  const controller = createWorkerAdmissionController(repos, {
    effectiveWorkerCap: 1,
    source: "override",
    overrideCap: 1,
    rawDerivedCap: 1,
    totalMemoryBytes: null,
    workerMemoryBytes: null,
  }, {
    scheduler: scheduled.scheduler,
    reconciliationIntervalMs: 1_000,
  })
  const activeBlocker = deferred()
  const resumedBlocker = deferred()

  try {
    const active = prepareForegroundIdeaRun(repos, makeIo(), {
      title: "active slot holder",
      description: "active slot holder",
      workspaceKey: workspace.key,
      admissionController: controller,
      workerLeaseScheduler: scheduled.scheduler,
      prepareRunImpl: (item, workflowRepos, workflowIo, opts) =>
        prepareRun(item, workflowRepos, workflowIo, {
          ...opts,
          workflowRunner: async () => {
            await activeBlocker.promise
          },
        }),
    })
    assert.equal(active.ok, true)
    if (!active.ok) return
    const activePromise = active.start()

    await waitFor(
      () => repos.listRunningRuns().length === 1,
      "expected the active run to occupy the only worker slot",
    )
    const activeWorkerInstanceId = repos.getRun(active.runId)?.worker_instance_id
    if (!activeWorkerInstanceId) {
      assert.fail("expected the active run to own a worker lease")
    }

    const heldBackOne = await seedRecoverableRun(repos, workspace, {
      title: "held back one",
      workspaceFsId: `held-back-one-${Date.now()}`,
      recoveryStatus: "failed",
      recoverySummary: "CLI worker heartbeat is stale — no live worker; resume or abandon.",
    })
    const heldBackTwo = await seedRecoverableRun(repos, workspace, {
      title: "held back two",
      workspaceFsId: `held-back-two-${Date.now()}`,
      recoveryStatus: "failed",
      recoverySummary: "CLI worker heartbeat is stale — no live worker; resume or abandon.",
    })

    let autoResumeCalls = 0
    const recovery = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: activeWorkerInstanceId,
      now: 1_700_000_130_001,
      autoResume: {
        enabled: true,
        recoveryThreshold: 1,
        resumeRun: async () => {
          autoResumeCalls += 1
        },
      },
    })

    assert.equal(autoResumeCalls, 0)
    assert.deepEqual(recovery.outcomes, [{
      runId: heldBackOne.run.id,
      outcome: "skipped",
      reason: "recovery_threshold_exceeded",
      heldBackRunIds: [heldBackOne.run.id, heldBackTwo.run.id],
    }])

    const prepared = await prepareForegroundResumeRun(repos, makeIo(), {
      runId: heldBackOne.run.id,
      summary: "Resume only this held-back run.",
      admissionController: controller,
      workerLeaseScheduler: scheduled.scheduler,
      resumeRunImpl: async input => {
        repos.clearRunRecovery(input.runId)
        repos.updateRun(input.runId, { status: "running", current_stage: "execution" })
        await resumedBlocker.promise
        repos.updateRun(input.runId, { status: "completed" })
      },
    })
    assert.equal(prepared.ok, true)
    if (!prepared.ok) return
    const resumedPromise = prepared.start()

    await waitFor(
      () => repos.getRun(heldBackOne.run.id)?.status === "queued",
      "expected the manually resumed held-back run to queue behind occupied capacity",
    )
    assert.equal(repos.getRun(heldBackTwo.run.id)?.status, "failed")
    assert.equal(repos.getRun(heldBackTwo.run.id)?.recovery_status, "failed")

    activeBlocker.resolve()
    await activePromise

    await waitFor(
      () => repos.getRun(heldBackOne.run.id)?.status === "running",
      "expected the targeted held-back run to start after capacity freed",
    )
    assert.equal(repos.getRun(heldBackTwo.run.id)?.status, "failed")
    assert.equal(repos.getRun(heldBackTwo.run.id)?.recovery_status, "failed")

    resumedBlocker.resolve()
    await resumedPromise
    await delay(25)
  } finally {
    controller.dispose()
    close()
  }
})
