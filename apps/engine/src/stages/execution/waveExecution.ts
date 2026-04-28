import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { branchNameStory } from "../../core/branchNames.js"
import { createGitAdapter, type GitAdapter } from "../../core/gitAdapter.js"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { writeRecoveryRecord } from "../../core/recovery.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { assignPort, releasePort } from "../../core/portAllocator.js"
import { layout } from "../../core/workspaceLayout.js"
import { resolveMergeResolverHarness } from "../../llm/registry.js"
import { runRalphStory, writeWaveSummary, type StoryArtifacts } from "./ralphRuntime.js"
import { runSetupStory } from "./setupStory.js"
import { buildStoryExecutionContext, createScreenOwners, executionStageLlmForStory } from "./storyContext.js"
import { writeStoryTestPlan } from "./testWriter.js"
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
  for (const wave of orderedWaves) {
    if (resume?.waveNumber && wave.number < resume.waveNumber) {
      const persisted = await readJsonIfExists<WaveSummary>(layout.waveSummaryFile(ctx, wave.number))
      if (!persisted) throw new Error(`missing_checkpoint:wave:${wave.number}`)
      summaries.push(persisted)
      completedWaveIds.add(wave.id)
      continue
    }

    assertWaveDependenciesSatisfied(wave, completedWaveIds)
    summaries.push(await executeWave(ctx, wave, storyById, screenOwners, git, resume, llm))
    completedWaveIds.add(wave.id)
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

  const mergeResolverHarness = llm?.executionCoder
    ? (() => {
        const resolved = resolveMergeResolverHarness(llm.executionCoder)
        if (resolved.kind === "fake") return { harness: "fake" as const }
        return { harness: resolved.harness, runtime: resolved.runtime, model: resolved.model }
      })()
    : undefined
  const expectedSharedFiles = expectedSharedFilesForWave(wave)
  let waveBranchOpQueue: Promise<void> = Promise.resolve()
  const enqueueWaveBranchOp = (op: () => void): Promise<void> => {
    waveBranchOpQueue = waveBranchOpQueue.then(async () => op())
    return waveBranchOpQueue
  }

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
          layout.executionStoryWorktreeDir(ctx, wave.number, resolved.id),
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
      }, llm)
      if (result.implementation.status === "passed") {
        await enqueueWaveBranchOp(() =>
          git.mergeStoryIntoWave(ctx.project.id, wave.number, resolved.id, {
            mergeResolver: mergeResolverHarness,
            resolverLogDir: layout.executionWaveDir(ctx, wave.number),
            expectedSharedFiles,
          }),
        )
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
  git.mergeWaveIntoProject(ctx.project.id, wave.number, {
    mergeResolver: mergeResolverHarness,
    resolverLogDir: layout.executionWaveDir(ctx, wave.number),
  })
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
  opts: { rerunTestWriter?: boolean; worktreeRoot?: string } = {},
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
  const result: StoryArtifacts = await runRalphStory(storyContext, ctx, executionLlm)
  stagePresent.dim(`  Status: ${result.implementation.status}`)
  return { storyId: story.id, implementation: result.implementation }
}
