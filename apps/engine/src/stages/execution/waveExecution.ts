import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { branchNameStory, branchNameWave, branchNameProject } from "../../core/branchNames.js"
import { createGitAdapter, type GitAdapter } from "../../core/gitAdapter.js"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { writeRecoveryRecord } from "../../core/recovery.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { assignPort, releasePort } from "../../core/portAllocator.js"
import { layout, requireItemRunScopedContext } from "../../core/workspaceLayout.js"
import { resolveMergeResolverHarness } from "../../llm/registry.js"
import { runRalphStory, writeWaveSummary, type RalphCycleBoundaryResult, type StoryArtifacts } from "./ralphRuntime.js"
import { runSetupStory } from "./setupStory.js"
import { buildStoryExecutionContext, createScreenOwners, executionStageLlmForStory } from "./storyContext.js"
import { writeStoryTestPlan } from "./testWriter.js"
import { createWaveCoordinator, type WaveCoordinator } from "./waveCoordinator.js"
import { isDbRelevantWave, provisionWaveIfDbRelevant } from "./supabaseWaveGate.js"
import { canStartDbRelevantWave } from "./dbWaveScheduler.js"
import { cleanupSuccessfulBranch } from "../../core/supabase/cleanupOrchestrator.js"
import type { SupabaseWorkflowHook } from "../../core/supabase/workflowHook.js"
import { recordSupabaseProvisioningBlockedRun } from "../../core/supabase/provisioningRecovery.js"
import type { ExecutionLlmOptions } from "./index.js"
import type { StoryTestPlanArtifact } from "./types.js"
import type {
  StoryImplementationArtifact,
  UserStory,
  WaveDefinition,
  WaveSummary,
  WithArchitecture,
  WithPlan,
} from "../../types.js"

type StoryResult = { storyId: string; implementation: StoryImplementationArtifact }
type ExecutionResumeOptions = {
  waveNumber?: number
  storyId?: string
  rerunTestWriter?: boolean
}

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return undefined
  }
}

export function parallelStoriesFlagEnabled(): boolean {
  const raw = process.env.BEERENGINEER_EXECUTION_PARALLEL_STORIES
  if (typeof raw !== "string") return false
  const normalized = raw.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes"
}

export async function execution(
  ctx: WithPlan,
  resume?: ExecutionResumeOptions,
  llm?: ExecutionLlmOptions,
  git: GitAdapter = createGitAdapter(ctx),
  supabaseHook?: SupabaseWorkflowHook,
): Promise<WaveSummary[]> {
  stagePresent.header(`execution — ${ctx.project.name}`)

  const storyById = new Map(ctx.prd.stories.map(story => [story.id, story]))
  const screenOwners = createScreenOwners(ctx)
  const orderedWaves = [...ctx.plan.plan.waves].sort((left, right) => {
    const leftRank = left.kind === "setup" ? 0 : 1
    const rightRank = right.kind === "setup" ? 0 : 1
    return leftRank - rightRank || left.number - right.number
  })

  const summaries: WaveSummary[] = []
  const completedWaveIds = new Set<string>()
  // BUG-PROJ4-QA-005 wiring point 3: sequential DB-relevant wave tracking.
  // At most one DB-relevant wave can be active at a time per item.
  const activeDbRelevantWaveIds: string[] = []

  for (const wave of orderedWaves) {
    if (resume?.waveNumber && wave.number < resume.waveNumber) {
      const persisted = await readJsonIfExists<WaveSummary>(layout.waveSummaryFile(ctx, wave.number))
      if (!persisted) throw new Error(`missing_checkpoint:wave:${wave.number}`)
      summaries.push(persisted)
      completedWaveIds.add(wave.id)
      continue
    }

    // Sequential DB-wave scheduling (architecture decision 5).
    if (supabaseHook && isDbRelevantWave(wave)) {
      const scheduleResult = canStartDbRelevantWave({
        dbRelevant: true,
        activeDbRelevantWaveIds,
      })
      if (!scheduleResult.ok) {
        // This should never happen in sequential execution (one wave at a time),
        // but guard defensively in case parallelism is introduced later.
        throw new Error(`[supabase] ${scheduleResult.message} (wave=${wave.id})`)
      }
      activeDbRelevantWaveIds.push(wave.id)
    }

    assertWaveDependenciesSatisfied(wave, completedWaveIds)
    summaries.push(await executeWave(ctx, wave, storyById, screenOwners, git, resume, llm, supabaseHook))
    completedWaveIds.add(wave.id)

    // Remove from active list once the wave is complete.
    const idx = activeDbRelevantWaveIds.indexOf(wave.id)
    if (idx !== -1) activeDbRelevantWaveIds.splice(idx, 1)

    if (resume?.waveNumber === wave.number) resume = undefined
  }

  stagePresent.ok("All waves complete\n")
  return summaries
}

export function assertWaveSucceeded(wave: WaveDefinition, summary: WaveSummary): void {
  if (summary.storiesBlocked.length === 0) return
  throw new Error(`Wave ${wave.id} blocked stories: ${summary.storiesBlocked.join(", ")}.`)
}

function assertWaveDependenciesSatisfied(
  wave: WaveDefinition,
  completedWaveIds: Set<string>,
): void {
  const missing = wave.dependencies.filter(dep => !completedWaveIds.has(dep))
  if (missing.length > 0) {
    throw new Error(`Wave ${wave.id} depends on ${missing.join(", ")}, but those waves did not complete first.`)
  }
}

function expectedSharedFilesForWave(wave: WaveDefinition): string[] {
  const entries = wave.kind === "setup"
    ? (wave.tasks ?? []).flatMap(task => task.sharedFiles ?? [])
    : wave.stories.flatMap(story => story.sharedFiles ?? [])
  return Array.from(new Set(entries)).sort((left, right) => left.localeCompare(right))
}

async function executeWave(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  storyById: Map<string, UserStory>,
  screenOwners: ReturnType<typeof createScreenOwners>,
  git: GitAdapter,
  resume?: ExecutionResumeOptions,
  llm?: ExecutionLlmOptions,
  supabaseHook?: SupabaseWorkflowHook,
): Promise<WaveSummary> {
  const waveEntries = wave.kind === "setup"
    ? (wave.tasks ?? []).map(task => ({ id: task.id, title: task.title }))
    : wave.stories
  const parallelEligible = wave.kind !== "setup" && wave.internallyParallelizable
  const parallelEnabled = parallelEligible && parallelStoriesFlagEnabled()
  let tag = "(stories executed sequentially)"
  if (parallelEligible) {
    tag = parallelEnabled
      ? "(stories executed in parallel — BEERENGINEER_EXECUTION_PARALLEL_STORIES is enabled)"
      : "(stories eligible for parallel execution but executed sequentially by default)"
  }
  stagePresent.step(`\nWave ${wave.number} ${tag}: ${waveEntries.map(s => s.id).join(", ")}`)
  git.ensureWaveBranch(ctx.project.id, wave.number)

  // BUG-PROJ4-QA-005 wiring point 1: provision → poll → handoff → validate
  // for DB-relevant waves BEFORE dispatching workers.
  let waveBranchRef: string | undefined
  let waveHandoffPath: string | undefined
  if (supabaseHook && isDbRelevantWave(wave)) {
    const activeRun = getActiveRun()
    const context = {
      workspaceId: supabaseHook.workspaceId,
      workspaceRoot: ctx.workspaceRoot,
      projectRef: supabaseHook.projectRef,
      dbMode: supabaseHook.dbMode,
      parentBranchRef: supabaseHook.parentBranchRef,
      runId: activeRun?.runId ?? ctx.runId,
      itemId: activeRun?.itemId,
      projectId: ctx.project.id,
      waveId: wave.id,
    }
    stagePresent.dim(`[supabase] provisioning wave branch for wave ${wave.id}`)
    const provisionResult = await provisionWaveIfDbRelevant({
      wave,
      adapter: supabaseHook.adapter,
      context,
      repos: supabaseHook.repos,
      handoffClient: supabaseHook.handoffClient,
    })
    if (!provisionResult.ok) {
      // Mark retained-for-diagnosis and abort the wave — do not dispatch workers.
      const runId = activeRun?.runId ?? ctx.runId
      if (runId) supabaseHook.repos.setRunSupabaseLifecycleState(runId, "retained-for-diagnosis")
      stagePresent.warn(`[supabase] wave ${wave.id} provision/validate failed: ${provisionResult.failureCause}`)
      // Build a summary with all stories blocked so the run transitions correctly.
      const blockedSummary: WaveSummary = {
        waveId: wave.id,
        waveBranch: branchNameWave(ctx, ctx.project.id, wave.number),
        projectBranch: branchNameProject(ctx, ctx.project.id),
        storiesMerged: [],
        storiesBlocked: waveEntries.map(s => s.id),
      }
      await recordSupabaseProvisioningBlockedRun({
        repos: supabaseHook.repos,
        ctx,
        runId,
        wave,
        projectRef: supabaseHook.projectRef,
        failure: provisionResult,
        itemId: activeRun?.itemId ?? "unknown-item",
        title: activeRun?.title ?? activeRun?.itemId ?? "unknown-item",
      })
      assertWaveSucceeded(wave, blockedSummary) // throws
    } else {
      waveBranchRef = (provisionResult as { branchRef: string }).branchRef || undefined
      waveHandoffPath = (provisionResult as { handoffPath: string }).handoffPath || undefined
      stagePresent.dim(`[supabase] wave branch provisioned and validated: ${waveBranchRef}`)
    }
  }

  const mergeResolverHarness = llm?.executionCoder
    ? (() => {
        const resolved = resolveMergeResolverHarness(llm.executionCoder)
        if (resolved.kind === "fake") return { harness: "fake" as const }
        return { harness: resolved.harness, runtime: resolved.runtime, model: resolved.model }
      })()
    : undefined
  const expectedSharedFiles = expectedSharedFilesForWave(wave)
  let waveBranchOpQueue: Promise<unknown> = Promise.resolve()
  const enqueueWaveBranchOp = <T>(op: () => T | Promise<T>): Promise<T> => {
    const next = waveBranchOpQueue.then(op, op)
    // Keep the queue usable after an individual branch operation fails.
    waveBranchOpQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
  const waveCoordinator = parallelEnabled
    ? createWaveCoordinator(waveEntries.map(entry => entry.id))
    : undefined

  const run = async (story: Pick<UserStory, "id" | "title">) => {
    const resolved = wave.kind === "setup"
      ? { id: story.id, title: story.title, acceptanceCriteria: [] }
      : resolveStory(story, storyById)
    let storyWorktreeRoot: string | undefined
    let result: StoryResult | undefined
    try {
      storyWorktreeRoot =
        git.ensureStoryWorktree(
          ctx.project.id,
          wave.number,
          resolved.id,
          layout.executionStoryWorktreeDir(requireItemRunScopedContext(ctx), wave.number, resolved.id),
        ) ?? undefined
      if (storyWorktreeRoot && ctx.workspaceRoot) {
        assignPort(storyWorktreeRoot, branchNameStory(ctx, ctx.project.id, wave.number, resolved.id), ctx.workspaceRoot)
      }
      if (git.enabled && !storyWorktreeRoot) {
        git.ensureStoryBranch(ctx.project.id, wave.number, resolved.id)
      }
      result = await implementStory(ctx, wave, resolved, screenOwners, {
        rerunTestWriter: resume?.storyId === story.id ? Boolean(resume.rerunTestWriter) : false,
        worktreeRoot: storyWorktreeRoot,
        onCycleBoundary: createStoryRebaseBoundary(ctx, wave, resolved, git, enqueueWaveBranchOp, waveCoordinator),
      }, llm)
      if (result.implementation.status === "passed") {
        await enqueueWaveBranchOp(() =>
          git.mergeStoryIntoWave(ctx.project.id, wave.number, resolved.id, {
            mergeResolver: mergeResolverHarness,
            resolverLogDir: layout.executionWaveDir(ctx, wave.number),
            expectedSharedFiles,
          }),
        )
        waveCoordinator?.notifyMergedStory(resolved.id)
      }
      if (result.implementation.status === "blocked") {
        await enqueueWaveBranchOp(() => git.abandonStoryBranch(ctx.project.id, wave.number, resolved.id))
      }
      return result
    } finally {
      if (storyWorktreeRoot) {
        try {
          releasePort(storyWorktreeRoot)
          git.removeStoryWorktree(storyWorktreeRoot)
        } catch (err) {
          stagePresent.dim(`worktree cleanup failed for ${storyWorktreeRoot}: ${(err as Error).message}`)
        }
      }
    }
  }

  const results = parallelEnabled
    ? await runStoriesInParallel(waveEntries, run)
    : await sequentially(waveEntries, run)
  const summary = await writeWaveSummary(ctx, wave, ctx.project.id, results)
  stagePresent.ok(`Wave ${wave.number} complete — merged: ${summary.storiesMerged.length}, blocked: ${summary.storiesBlocked.length}`)
  if (summary.storiesBlocked.length > 0) await recordBlockedWave(ctx, wave, summary)
  assertWaveSucceeded(wave, summary)
  await git.mergeWaveIntoProject(ctx.project.id, wave.number, {
    mergeResolver: mergeResolverHarness,
    resolverLogDir: layout.executionWaveDir(ctx, wave.number),
  })

  // BUG-PROJ4-QA-005 wiring point 5: cleanup after successful wave completion.
  if (supabaseHook && isDbRelevantWave(wave) && waveBranchRef) {
    const activeRun = getActiveRun()
    const runId = activeRun?.runId ?? ctx.runId
    const run = runId ? supabaseHook.repos.getRun(runId) : undefined
    const lifecycleState = run?.supabase_branch_lifecycle_state ?? null
    try {
      await cleanupSuccessfulBranch({
        repos: supabaseHook.repos,
        adapter: supabaseHook.adapter,
        workspaceId: supabaseHook.workspaceId,
        projectRef: supabaseHook.projectRef,
        branchRef: waveBranchRef,
        branchName: run?.supabase_branch_name ?? null,
        runId,
        waveId: wave.id,
        lifecycleState,
        policy: supabaseHook.cleanupPolicy,
        ttlHours: supabaseHook.cleanupTtlHours,
        handoffPath: waveHandoffPath ?? null,
      })
    } catch (err) {
      // Cleanup failure is non-fatal — wave already succeeded; log and continue.
      stagePresent.dim(`[supabase] cleanup failed for wave ${wave.id}: ${(err as Error).message}`)
    }
  }

  return summary
}

async function recordBlockedWave(ctx: WithArchitecture, wave: WaveDefinition, summary: WaveSummary): Promise<void> {
  const blockedSummary = `Wave ${wave.id} blocked stories: ${summary.storiesBlocked.join(", ")}.`
  await writeRecoveryRecord(ctx, {
    status: "blocked",
    cause: "stage_error",
    scope: { type: "stage", runId: ctx.runId, stageId: "execution" },
    summary: blockedSummary,
    detail: `wave=${wave.number} merged=${summary.storiesMerged.length} blocked=${summary.storiesBlocked.length}`,
    evidencePaths: [layout.executionWaveDir(ctx, wave.number)],
  })
  const active = getActiveRun()
  if (!active) {
    stagePresent.dim(
      `run_blocked emitted without active run context for runId=${ctx.runId} wave=${wave.number}; event will appear as unknown-item`,
    )
  }
  emitEvent({
    type: "run_blocked",
    runId: ctx.runId,
    itemId: active?.itemId ?? "unknown-item",
    title: active?.title ?? active?.itemId ?? "unknown-item",
    scope: { type: "stage", runId: ctx.runId, stageId: "execution" },
    cause: "stage_error",
    summary: blockedSummary,
  })
}

function blockedPlaceholder(
  story: Pick<UserStory, "id" | "title">,
  reason: string,
): StoryImplementationArtifact {
  return {
    story: { id: story.id, title: story.title },
    mode: "ralph-wiggum",
    status: "blocked",
    implementationGoal: "",
    maxIterations: 0,
    maxReviewCycles: 0,
    currentReviewCycle: 0,
    iterations: [],
    changedFiles: [],
    finalSummary: `Story blocked due to runtime error: ${reason}`,
  }
}

async function sequentially<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (const item of items) out.push(await fn(item))
  return out
}

async function runStoriesInParallel(
  stories: Array<Pick<UserStory, "id" | "title">>,
  run: (story: Pick<UserStory, "id" | "title">) => Promise<StoryResult>,
): Promise<StoryResult[]> {
  const settled = await Promise.allSettled(stories.map(story => run(story)))
  return settled.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value
    const story = stories[index]
    const reason = entry.reason instanceof Error ? entry.reason.message : String(entry.reason)
    stagePresent.warn(`Story ${story.id} threw during parallel execution: ${reason}`)
    return { storyId: story.id, implementation: blockedPlaceholder(story, reason) }
  })
}

function resolveStory(
  ref: Pick<UserStory, "id" | "title">,
  storyById: Map<string, UserStory>,
): UserStory {
  const full = storyById.get(ref.id)
  if (full) return full
  const id = ref.id ?? `scaffold-${(ref.title ?? "story").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "") || "story"}`
  stagePresent.warn(`Story ${ref.id ?? "<unnamed>"} is referenced by the plan but missing from the PRD — synthesizing scaffold ACs as ${id}.`)
  return { id, title: ref.title ?? id, acceptanceCriteria: [] }
}

async function implementStory(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  story: UserStory,
  screenOwners: ReturnType<typeof createScreenOwners>,
  opts: {
    rerunTestWriter?: boolean
    worktreeRoot?: string
    onCycleBoundary?: (args: { cycle: number }) => Promise<RalphCycleBoundaryResult> | RalphCycleBoundaryResult
  } = {},
  llm?: ExecutionLlmOptions,
): Promise<StoryResult> {
  stagePresent.step(`  Story ${story.id}: ${story.title}`)
  if (wave.kind === "setup") {
    return runSetupStory(ctx, wave, story, screenOwners, opts, llm)
  }

  const persistedImplementation = await readJsonIfExists<StoryImplementationArtifact>(
    join(layout.executionRalphDir(ctx, wave.number, story.id), "implementation.json"),
  )
  if (persistedImplementation?.status === "passed") {
    stagePresent.dim(`  Status: ${persistedImplementation.status}`)
    return { storyId: story.id, implementation: persistedImplementation }
  }

  const testPlanPath = join(layout.executionTestWriterDir(ctx, wave.number, story.id), "test-plan.json")
  const storyStageLlm = executionStageLlmForStory(llm?.stage, opts.worktreeRoot)
  const testPlan = opts.rerunTestWriter
    ? await writeStoryTestPlan(ctx, wave, story, storyStageLlm)
    : (await readJsonIfExists<StoryTestPlanArtifact>(testPlanPath)) ?? await writeStoryTestPlan(ctx, wave, story, storyStageLlm)
  stagePresent.dim(`  Test plan: ${testPlan.testPlan.testCases.map(tc => tc.id).join(", ")}`)
  const storyContext = buildStoryExecutionContext(ctx, wave, ctx.architecture, testPlan, {
    worktreeRoot: opts.worktreeRoot,
    screenOwners,
  })
  const executionLlm = executionStageLlmForStory(llm?.executionCoder, opts.worktreeRoot)
  const result: StoryArtifacts = await runRalphStory(storyContext, ctx, executionLlm, {
    onCycleBoundary: opts.onCycleBoundary,
  })
  stagePresent.dim(`  Status: ${result.implementation.status}`)
  return { storyId: story.id, implementation: result.implementation }
}

function createStoryRebaseBoundary(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  story: UserStory,
  git: GitAdapter,
  enqueueWaveBranchOp: <T>(op: () => T | Promise<T>) => Promise<T>,
  waveCoordinator: WaveCoordinator | undefined,
): ((args: { cycle: number }) => Promise<RalphCycleBoundaryResult>) | undefined {
  if (!waveCoordinator || wave.kind === "setup") return undefined
  return async ({ cycle }) => {
    if (!waveCoordinator.shouldRebase(story.id)) return { ok: true }
    stagePresent.dim(`  Rebase ${story.id} onto updated wave ${wave.number} before review cycle ${cycle + 1}`)
    const result = await enqueueWaveBranchOp(() => git.rebaseStoryOntoWave(ctx.project.id, wave.number, story.id))
    if (result.ok) {
      waveCoordinator.markRebased(story.id)
      return { ok: true }
    }
    waveCoordinator.abandonStory(story.id, result.reason)
    return result
  }
}
