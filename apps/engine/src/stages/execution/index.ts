import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { branchNameStory, ensureWaveBranch, mergeWaveBranchIntoProject } from "../../core/repoSimulation.js"
import {
  abandonStoryBranchReal,
  detectRealGitMode,
  ensureStoryBranchReal,
  ensureStoryWorktreeReal,
  ensureWaveBranchReal,
  mergeStoryIntoWaveReal,
  mergeWaveIntoProjectReal,
  removeStoryWorktreeReal,
} from "../../core/realGit.js"
import { writeRecoveryRecord } from "../../core/recovery.js"
import { runStage } from "../../core/stageRuntime.js"
import {
  createTestWriterReview,
  createTestWriterStage,
  resolveMergeResolverHarness,
  type ResolvedHarness,
  type RunLlmConfig,
} from "../../llm/registry.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { renderTestPlanMarkdown } from "../../render/testPlan.js"
import { runRalphStory, writeWaveSummary, type StoryArtifacts } from "./ralphRuntime.js"
import { layout } from "../../core/workspaceLayout.js"
import type { StoryTestPlanArtifact, TestWriterState } from "./types.js"
import type {
  AcceptanceCriterion,
  ArchitectureArtifact,
  StoryExecutionContext,
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

export type ExecutionLlmOptions = {
  stage?: RunLlmConfig
  executionCoder?: RunLlmConfig
}

function requireField<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null) {
    throw new Error(`WorkflowContext.${name} is required during execution stage`)
  }
  return value
}

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return undefined
  }
}

export async function execution(ctx: WithPlan, resume?: ExecutionResumeOptions, llm?: ExecutionLlmOptions): Promise<WaveSummary[]> {
  stagePresent.header(`execution — ${ctx.project.name}`)

  const storyById = new Map(ctx.prd.stories.map(story => [story.id, story]))

  const summaries: WaveSummary[] = []
  const completedWaveIds = new Set<string>()
  for (const wave of ctx.plan.plan.waves) {
    if (resume?.waveNumber && wave.number < resume.waveNumber) {
      const persisted = await readJsonIfExists<WaveSummary>(layout.waveSummaryFile(ctx, wave.number))
      if (!persisted) {
        throw new Error(`missing_checkpoint:wave:${wave.number}`)
      }
      summaries.push(persisted)
      completedWaveIds.add(wave.id)
      continue
    }

    assertWaveDependenciesSatisfied(wave, completedWaveIds)
    summaries.push(await executeWave(ctx, wave, storyById, resume, llm))
    completedWaveIds.add(wave.id)
    if (resume?.waveNumber === wave.number) resume = undefined
  }

  stagePresent.ok("All waves complete\n")
  return summaries
}

export function assertWaveSucceeded(wave: WaveDefinition, summary: WaveSummary): void {
  if (summary.storiesBlocked.length === 0) return
  throw new Error(
    `Wave ${wave.id} blocked stories: ${summary.storiesBlocked.join(", ")}.`,
  )
}

function assertWaveDependenciesSatisfied(
  wave: WaveDefinition,
  completedWaveIds: Set<string>,
): void {
  const missing = wave.dependencies.filter(dep => !completedWaveIds.has(dep))
  if (missing.length > 0) {
    throw new Error(
      `Wave ${wave.id} depends on ${missing.join(", ")}, but those waves did not complete first.`,
    )
  }
}

async function executeWave(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  storyById: Map<string, UserStory>,
  resume?: ExecutionResumeOptions,
  llm?: ExecutionLlmOptions,
): Promise<WaveSummary> {
  // A wave is a serial integration boundary. `internallyParallelizable`
  // means only that its stories are dependency-independent and may execute
  // concurrently inside the wave once the runtime supports that mode.
  const tag = wave.internallyParallelizable
    ? "(stories eligible for parallel execution inside the wave; currently executed sequentially with isolated worktrees)"
    : "(stories executed sequentially)"
  stagePresent.step(`\nWave ${wave.number} ${tag}: ${wave.stories.map(s => s.id).join(", ")}`)
  await ensureWaveBranch(ctx, ctx.project.id, wave.number)

  const realGit = detectRealGitMode(ctx)
  if (realGit.enabled) {
    ensureWaveBranchReal(realGit, ctx, ctx.project.id, wave.number)
  }

  const mergeResolverHarness: { provider: ResolvedHarness["provider"]; model?: string } | undefined =
    llm?.executionCoder
      ? (() => {
          const resolved = resolveMergeResolverHarness(llm.executionCoder!)
          return { provider: resolved.provider, model: resolved.model }
        })()
      : undefined

  // Wave-branch merges/abandons must happen one at a time even when story
  // implementations run in parallel — concurrent `git merge` into the wave
  // branch races on the same ref. The chain serialises just the git ops while
  // story implementations and worktree cleanup stay fully concurrent.
  let waveBranchOpQueue: Promise<void> = Promise.resolve()
  const enqueueWaveBranchOp = (op: () => void): Promise<void> => {
    waveBranchOpQueue = waveBranchOpQueue.then(async () => op())
    return waveBranchOpQueue
  }

  const run = async (story: Pick<UserStory, "id" | "title">) => {
    const resolved = resolveStory(story, storyById)
    let storyWorktreeRoot: string | undefined
    let result: StoryResult | undefined
    try {
      storyWorktreeRoot = realGit.enabled
        ? ensureStoryWorktreeReal(
            realGit,
            ctx,
            ctx.project.id,
            wave.number,
            resolved.id,
            layout.executionStoryWorktreeDir(ctx, wave.number, resolved.id),
          )
        : undefined
      // `ensureStoryWorktreeReal` already creates the story branch if
      // missing and checks it out inside the worktree. Calling
      // `ensureStoryBranchReal` here would `git checkout <story>` in the
      // main workspace, which git refuses because the branch is already
      // used by the worktree — crashes the run with
      // "is already used by worktree at …". Only run the main-workspace
      // checkout when worktrees are disabled.
      if (realGit.enabled && !storyWorktreeRoot) {
        ensureStoryBranchReal(realGit, ctx, ctx.project.id, wave.number, resolved.id)
      }
      result = await implementStory(ctx, wave, resolved, {
        rerunTestWriter: resume != null && resume.storyId === story.id ? Boolean(resume.rerunTestWriter) : false,
        worktreeRoot: storyWorktreeRoot,
      }, llm)
      // Gate real-git merge on the same condition as the simulated merge
      // (ralphRuntime only sim-merges when the story outcome is "passed"). This
      // keeps the two state machines from diverging on anything other than
      // "passed" (e.g. ready_for_review left behind by a crashed cycle).
      // Serialise via `enqueueWaveBranchOp` so concurrent stories cannot race
      // on the wave branch.
      if (realGit.enabled && result.implementation.status === "passed") {
        await enqueueWaveBranchOp(() =>
          mergeStoryIntoWaveReal(realGit, ctx, ctx.project.id, wave.number, resolved.id, {
            mergeResolver: mergeResolverHarness,
            resolverLogDir: layout.executionWaveDir(ctx, wave.number),
          }),
        )
      }
      if (realGit.enabled && result.implementation.status === "blocked") {
        await enqueueWaveBranchOp(() =>
          abandonStoryBranchReal(realGit, ctx, ctx.project.id, wave.number, resolved.id),
        )
      }
      return result
    } finally {
      if (realGit.enabled && storyWorktreeRoot) {
        // Swallow cleanup errors so they cannot mask a primary failure from
        // `implementStory` / branch ops. The primary error carries the real
        // debugging signal; worktree-removal failures are surfaced via logs
        // and cleaned up by `gcManagedStoryWorktreesReal` on the next run.
        try {
          removeStoryWorktreeReal(realGit, storyWorktreeRoot)
        } catch (err) {
          stagePresent.dim(`worktree cleanup failed for ${storyWorktreeRoot}: ${(err as Error).message}`)
        }
      }
    }
  }

  // Stories within a wave are independent by plan-construction (the planner
  // keeps cross-story dependencies in different waves). Default to running
  // them in parallel — each lives in its own worktree + branch, and the
  // wave-branch merge step serialises through `enqueueWaveBranchOp` above.
  // Set BEERENGINEER_SEQUENTIAL_STORIES=1 to force the legacy sequential path.
  const parallel = process.env.BEERENGINEER_SEQUENTIAL_STORIES !== "1"
  const results = parallel
    ? await runStoriesInParallel(wave.stories, run)
    : await sequentially(wave.stories, run)

  const summary = await writeWaveSummary(ctx, wave, ctx.project.id, results)
  stagePresent.ok(
    `Wave ${wave.number} complete — merged: ${summary.storiesMerged.length}, blocked: ${summary.storiesBlocked.length}`,
  )
  if (summary.storiesBlocked.length > 0) {
    // assertWaveSucceeded throws below — write a stage-scope recovery record
    // first so resume_run sees a `blocked` recovery instead of a 409.
    await writeRecoveryRecord(ctx, {
      status: "blocked",
      cause: "stage_error",
      scope: { type: "stage", runId: ctx.runId, stageId: "execution" },
      summary: `Wave ${wave.id} blocked stories: ${summary.storiesBlocked.join(", ")}.`,
      detail: `wave=${wave.number} merged=${summary.storiesMerged.length} blocked=${summary.storiesBlocked.length}`,
      evidencePaths: [layout.executionWaveDir(ctx, wave.number)],
    })
  }
  assertWaveSucceeded(wave, summary)
  await mergeWaveBranchIntoProject(ctx, ctx.project.id, wave.number)
  if (realGit.enabled) {
    mergeWaveIntoProjectReal(realGit, ctx, ctx.project.id, wave.number, {
      mergeResolver: mergeResolverHarness,
      resolverLogDir: layout.executionWaveDir(ctx, wave.number),
    })
  }
  return summary
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

/**
 * Run all stories in a wave concurrently. Failures inside individual stories
 * are converted to a "blocked" StoryResult so a single bad story cannot abort
 * the rest of the wave, matching the behaviour of the existing per-story
 * try/finally + error wrappers in the sequential path.
 */
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
  const id = ref.id ?? `scaffold-${(ref.title ?? "story").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "story"}`
  stagePresent.warn(`Story ${ref.id ?? "<unnamed>"} is referenced by the plan but missing from the PRD — synthesizing scaffold ACs as ${id}.`)
  return { id, title: ref.title ?? id, acceptanceCriteria: [] }
}

async function implementStory(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  story: UserStory,
  opts: { rerunTestWriter?: boolean; worktreeRoot?: string } = {},
  llm?: ExecutionLlmOptions,
): Promise<StoryResult> {
  stagePresent.step(`  Story ${story.id}: ${story.title}`)

  const persistedImplementation = await readJsonIfExists<StoryImplementationArtifact>(
    join(layout.executionRalphDir(ctx, wave.number, story.id), "implementation.json"),
  )
  if (persistedImplementation?.status === "passed") {
    stagePresent.dim(`  Status: ${persistedImplementation.status}`)
    return { storyId: story.id, implementation: persistedImplementation }
  }

  const testPlanPath = join(layout.executionTestWriterDir(ctx, wave.number, story.id), "test-plan.json")
  const storyStageLlm = executionStageLlmForStory(llm?.stage, opts.worktreeRoot)
  const testPlan = !opts.rerunTestWriter
    ? (await readJsonIfExists<StoryTestPlanArtifact>(testPlanPath)) ?? await writeStoryTestPlan(ctx, wave, story, storyStageLlm)
    : await writeStoryTestPlan(ctx, wave, story, storyStageLlm)
  stagePresent.dim(`  Test plan: ${testPlan.testPlan.testCases.map(tc => tc.id).join(", ")}`)
  const storyContext = buildStoryExecutionContext(ctx, wave, ctx.architecture, testPlan, opts.worktreeRoot)
  const executionLlm = executionStageLlmForStory(llm?.executionCoder, opts.worktreeRoot)
  const result: StoryArtifacts = await runRalphStory(storyContext, ctx, executionLlm)
  stagePresent.dim(`  Status: ${result.implementation.status}`)
  return { storyId: story.id, implementation: result.implementation }
}

export function executionStageLlmForStory(llm: RunLlmConfig | undefined, worktreeRoot?: string): RunLlmConfig | undefined {
  return llm && worktreeRoot ? { ...llm, workspaceRoot: worktreeRoot } : llm
}

function buildStoryExecutionContext(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  architecture: ArchitectureArtifact,
  testPlan: StoryTestPlanArtifact,
  worktreeRoot?: string,
): StoryExecutionContext {
  return {
    item: {
      slug: requireField(ctx.itemSlug, "itemSlug"),
      baseBranch: requireField(ctx.baseBranch, "baseBranch"),
    },
    primaryWorkspaceRoot: ctx.workspaceRoot,
    project: { id: ctx.project.id, name: ctx.project.name },
    conceptSummary: ctx.project.concept.summary,
    story: {
      id: testPlan.story.id,
      title: testPlan.story.title,
      acceptanceCriteria: testPlan.acceptanceCriteria,
    },
    architectureSummary: {
      summary: architecture.architecture.summary,
      systemShape: architecture.architecture.systemShape,
      constraints: architecture.architecture.constraints,
      relevantComponents: architecture.architecture.components.map(component => ({
        name: component.name,
        responsibility: component.responsibility,
      })),
    },
    wave: {
      id: wave.id,
      number: wave.number,
      goal: wave.goal,
      dependencies: wave.dependencies,
    },
    storyBranch: branchNameStory(ctx, ctx.project.id, wave.number, testPlan.story.id),
    worktreeRoot,
    testPlan,
  }
}

async function writeStoryTestPlan(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  story: UserStory,
  llm?: RunLlmConfig,
): Promise<StoryTestPlanArtifact> {
  const acs: AcceptanceCriterion[] = story.acceptanceCriteria.length > 0
    ? story.acceptanceCriteria
    : [
        { id: "AC-01", text: `${story.id} core flow works`, priority: "must", category: "functional" },
        { id: "AC-02", text: `${story.id} validation covers error cases`, priority: "must", category: "validation" },
      ]

  const { result } = await runStage({
    stageId: `execution/waves/${wave.number}/stories/${story.id}/test-writer`,
    stageAgentLabel: "LLM-6a (Test Writer)",
    reviewerLabel: "Test-Review-LLM",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): TestWriterState => ({
      projectId: ctx.project.id,
      wave,
      story: { id: story.id, title: story.title },
      acceptanceCriteria: acs,
      revisionCount: 0,
    }),
    stageAgent: createTestWriterStage(ctx.project, llm),
    reviewer: createTestWriterReview(llm),
    askUser: async () => "",
    async persistArtifacts(_run, artifact) {
      return [
        {
          kind: "json",
          label: "Test Plan JSON",
          fileName: "test-plan.json",
          content: JSON.stringify(artifact, null, 2),
        },
        {
          kind: "md",
          label: "Test Plan Markdown",
          fileName: "test-plan.md",
          content: renderTestPlanMarkdown(artifact),
        },
      ]
    },
    async onApproved(artifact) {
      return artifact
    },
    // Test-writer is a review-heavy step on realistic features. Haiku frequently
    // needs 3+ cycles for the plan to converge (coverage + dedup feedback).
    // Cap at 4 to keep runaway budget bounded while allowing realistic refinement.
    maxReviews: 4,
  })

  return result
}
