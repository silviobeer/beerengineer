import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { computeScreenOwners, type ScreenOwnerMap } from "../../core/screenOwners.js"
import { projectDesignGuidance } from "../../core/designPrep.js"
import { branchNameStory } from "../../core/branchNames.js"
import { commitAll } from "../../core/git.js"
import { createGitAdapter, type GitAdapter } from "../../core/gitAdapter.js"
import { writeRecoveryRecord } from "../../core/recovery.js"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { runStage } from "../../core/stageRuntime.js"
import {
  createTestWriterReview,
  createTestWriterStage,
  executionCoderPolicy,
  resolveHarness,
  resolveMergeResolverHarness,
  type RunLlmConfig,
} from "../../llm/registry.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { assignPort, releasePort } from "../../core/portAllocator.js"
import { runCoderHarness } from "../../llm/hosted/execution/coderHarness.js"
import { renderArchitectureSummary } from "../../render/artifactDigests.js"
import { renderTestPlanMarkdown } from "../../render/testPlan.js"
import { runRalphStory, writeWaveSummary, type StoryArtifacts } from "./ralphRuntime.js"
import { layout } from "../../core/workspaceLayout.js"
import type { StoryTestPlanArtifact, TestWriterState } from "./types.js"
import type {
  AcceptanceCriterion,
  ArchitectureArtifact,
  StoryReference,
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

/**
 * Parse the BEERENGINEER_EXECUTION_PARALLEL_STORIES feature flag.
 * Truthy values: `1`, `true`, `yes` (case-insensitive). Anything else
 * (including missing/empty) is treated as falsy → sequential execution.
 *
 * Sequential is the safe default: it eliminates merge-conflict cascades
 * when multiple stories in a parallel-eligible wave both touch the same
 * infrastructure file (package.json, design-tokens.css, package-lock.json,
 * tsconfig, etc.). Operators enable parallel mode only when paired with
 * the rebase-on-merge runtime (Fix 2) and a planner that has scrubbed
 * shared-file collisions via the post-validator (Fix 3).
 */
export function parallelStoriesFlagEnabled(): boolean {
  const raw = process.env.BEERENGINEER_EXECUTION_PARALLEL_STORIES
  if (typeof raw !== "string") return false
  const normalized = raw.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes"
}

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return undefined
  }
}

export async function execution(
  ctx: WithPlan,
  resume?: ExecutionResumeOptions,
  llm?: ExecutionLlmOptions,
  git: GitAdapter = createGitAdapter(ctx),
): Promise<WaveSummary[]> {
  stagePresent.header(`execution — ${ctx.project.name}`)

  const storyById = new Map(ctx.prd.stories.map(story => [story.id, story]))
  const screenOwners = computeScreenOwners(ctx.prd, ctx.plan, ctx.wireframes)
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
      if (!persisted) {
        throw new Error(`missing_checkpoint:wave:${wave.number}`)
      }
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
  screenOwners: ScreenOwnerMap,
  git: GitAdapter,
  resume?: ExecutionResumeOptions,
  llm?: ExecutionLlmOptions,
): Promise<WaveSummary> {
  const waveEntries: Array<Pick<UserStory, "id" | "title">> = wave.kind === "setup"
    ? (wave.tasks ?? []).map(task => ({ id: task.id, title: task.title }))
    : wave.stories
  // A wave is a serial integration boundary. `internallyParallelizable`
  // means only that its stories are dependency-independent and may execute
  // concurrently inside the wave once the operator opts in via the
  // BEERENGINEER_EXECUTION_PARALLEL_STORIES feature flag. Default is
  // sequential — the safe path that prevents merge-conflict cascades when
  // multiple stories touch overlapping infra files (package.json,
  // design-tokens.css, etc.) within the same wave.
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

  const mergeResolverHarness:
    | { harness: "claude" | "codex" | "opencode" | "fake"; runtime?: "cli" | "sdk"; model?: string }
    | undefined = llm?.executionCoder
    ? (() => {
        const executionCoder = llm.executionCoder
        if (executionCoder === undefined) return undefined
        const resolved = resolveMergeResolverHarness(executionCoder)
        if (resolved.kind === "fake") return { harness: "fake" as const }
        return { harness: resolved.harness, runtime: resolved.runtime, model: resolved.model }
      })()
    : undefined
  const expectedSharedFiles = expectedSharedFilesForWave(wave)

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
      // `ensureStoryWorktree` already creates the story branch if missing
      // and checks it out inside the worktree. Calling `ensureStoryBranch`
      // here would `git checkout <story>` in the main workspace, which git
      // refuses because the branch is already used by the worktree — crashes
      // the run with "is already used by worktree at …". Only run the
      // main-workspace checkout when worktrees are disabled (i.e. enabled
      // but no worktree root was returned).
      if (git.enabled && !storyWorktreeRoot) {
        git.ensureStoryBranch(ctx.project.id, wave.number, resolved.id)
      }
      result = await implementStory(ctx, wave, resolved, screenOwners, {
        rerunTestWriter: resume?.storyId === story.id ? Boolean(resume.rerunTestWriter) : false,
        worktreeRoot: storyWorktreeRoot,
      }, llm)
      // Gate real-git merge on the same condition as the simulated merge
      // (ralphRuntime only sim-merges when the story outcome is "passed"). This
      // keeps the two state machines from diverging on anything other than
      // "passed" (e.g. ready_for_review left behind by a crashed cycle).
      // Serialise via `enqueueWaveBranchOp` so concurrent stories cannot race
      // on the wave branch.
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
        await enqueueWaveBranchOp(() =>
          git.abandonStoryBranch(ctx.project.id, wave.number, resolved.id),
        )
      }
      return result
    } finally {
      if (storyWorktreeRoot) {
        // Swallow cleanup errors so they cannot mask a primary failure from
        // `implementStory` / branch ops. The primary error carries the real
        // debugging signal; worktree-removal failures are surfaced via logs
        // and cleaned up by `gcManagedStoryWorktrees` on the next run.
        try {
          releasePort(storyWorktreeRoot)
          git.removeStoryWorktree(storyWorktreeRoot)
        } catch (err) {
          stagePresent.dim(`worktree cleanup failed for ${storyWorktreeRoot}: ${(err as Error).message}`)
        }
      }
    }
  }

  // Stories within a wave run sequentially by default. Each story branches
  // from the *current* wave HEAD (after prior story merges), so a later
  // story sees earlier stories' commits — preventing scaffold-vs-scaffold
  // merge-conflict cascades when multiple stories touch the same infra
  // files. The legacy parallel path (Promise.allSettled) is opt-in via
  // BEERENGINEER_EXECUTION_PARALLEL_STORIES. The wave-branch merge step
  // serialises through `enqueueWaveBranchOp` regardless of mode.
  const results = parallelEnabled
    ? await runStoriesInParallel(waveEntries, run)
    : await sequentially(waveEntries, run)

  const summary = await writeWaveSummary(ctx, wave, ctx.project.id, results)
  stagePresent.ok(
    `Wave ${wave.number} complete — merged: ${summary.storiesMerged.length}, blocked: ${summary.storiesBlocked.length}`,
  )
  if (summary.storiesBlocked.length > 0) {
    // assertWaveSucceeded throws below — write a stage-scope recovery record
    // first so resume_run sees a `blocked` recovery instead of a 409. The
    // disk record alone is not enough: runOrchestrator's run_blocked handler
    // is what syncs `runs.recovery_status` in the DB, so emit the event too.
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
      // run_blocked needs an itemId for triage. If we ever land here, the
      // event will surface as "unknown-item" — log loudly so it's not silent.
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
  assertWaveSucceeded(wave, summary)
  git.mergeWaveIntoProject(ctx.project.id, wave.number, {
    mergeResolver: mergeResolverHarness,
    resolverLogDir: layout.executionWaveDir(ctx, wave.number),
  })
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
  const id = ref.id ?? `scaffold-${(ref.title ?? "story").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "") || "story"}`
  stagePresent.warn(`Story ${ref.id ?? "<unnamed>"} is referenced by the plan but missing from the PRD — synthesizing scaffold ACs as ${id}.`)
  return { id, title: ref.title ?? id, acceptanceCriteria: [] }
}

async function implementStory(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  story: UserStory,
  screenOwners: ScreenOwnerMap,
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

export function executionStageLlmForStory(llm: RunLlmConfig | undefined, worktreeRoot?: string): RunLlmConfig | undefined {
  return llm && worktreeRoot ? { ...llm, workspaceRoot: worktreeRoot } : llm
}

export function buildStoryExecutionContext(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  architecture: ArchitectureArtifact,
  testPlan: StoryTestPlanArtifact,
  opts: {
    worktreeRoot?: string
    screenOwners: ScreenOwnerMap
    kind?: "feature" | "setup"
    setupContract?: StoryExecutionContext["setupContract"]
    references?: StoryReference[]
  },
): StoryExecutionContext {
  const ownerMockups = resolveStoryMockups(ctx, wave, testPlan.story.id, opts.screenOwners)
  const architectureSummary = renderArchitectureSummary(architecture)
  return {
    kind: opts.kind ?? "feature",
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
    setupContract: opts.setupContract,
    architectureSummary,
    wave: {
      id: wave.id,
      number: wave.number,
      goal: wave.goal,
      dependencies: wave.dependencies,
    },
    storyBranch: branchNameStory(ctx, ctx.project.id, wave.number, testPlan.story.id),
    worktreeRoot: opts.worktreeRoot,
    design: opts.kind === "setup" ? ctx.design : projectDesignGuidance(ctx.design),
    mockupHtmlByScreen: ownerMockups,
    references: opts.references,
    testPlan,
  }
}

function resolveStoryMockups(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  storyId: string,
  owners: ScreenOwnerMap,
): Record<string, string> | undefined {
  const mockups = ctx.design?.mockupHtmlPerScreen
  if (!mockups) return undefined
  const plannedStory = wave.stories.find(entry => entry.id === storyId)
  const ownedScreens = (plannedStory?.screenIds ?? [])
    .filter(screenId => owners[screenId] === storyId && mockups[screenId])
    .slice(0, 3)
  if (ownedScreens.length === 0) return undefined
  return Object.fromEntries(
    ownedScreens.flatMap(screenId => {
      const mockup = mockups[screenId]
      return mockup === undefined ? [] : [[screenId, mockup] as const]
    }),
  )
}

function setupTaskReferences(
  ctx: WithArchitecture,
  storyId: string,
  explicitReferences: StoryReference[] | undefined,
): StoryReference[] | undefined {
  const references = [...(explicitReferences ?? [])]
  const designTokensPath = join(layout.stageArtifactsDir(ctx, "frontend-design"), "design-tokens.css")
  // Setup tasks own scaffold files. When the frontend-design stage has
  // produced design-tokens.css, expose it to *every* setup task so the
  // scaffold worker can copy it once into the worktree. Previously the
  // reference was only added for design-named stories, which let later
  // feature stories re-derive their own tokens and collide on merge.
  const alreadyAttached = references.some(ref => ref.name === "design-tokens.css")
  if (existsSync(designTokensPath) && !alreadyAttached) {
    references.push({
      kind: "file",
      name: "design-tokens.css",
      path: designTokensPath,
      instruction: "Copy this file to apps/ui/app/design-tokens.css and import it from the UI layout. Subsequent feature stories must consume this file unmodified.",
    })
  }
  const _storyId = storyId
  if (_storyId === "") return references.length > 0 ? references : undefined
  return references.length > 0 ? references : undefined
}

function setupTaskForWave(wave: WaveDefinition, storyId: string) {
  return wave.tasks?.find(task => task.id === storyId)
}

function setupTestPlan(
  ctx: WithArchitecture,
  story: UserStory,
  contract: NonNullable<StoryExecutionContext["setupContract"]>,
): StoryTestPlanArtifact {
  return {
    project: { id: ctx.project.id, name: ctx.project.name },
    story: { id: story.id, title: story.title },
    acceptanceCriteria: [],
    testPlan: {
      summary: `Satisfy setup contract for ${story.id}.`,
      testCases: [],
      fixtures: contract.expectedFiles,
      edgeCases: contract.postChecks,
      assumptions: contract.requiredScripts,
    },
  }
}

function runShell(command: string, cwd: string): { ok: boolean; output: string } {
  const result = spawnSync("bash", ["-lc", command], { cwd, encoding: "utf8" })
  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
  }
}

function verifySetupContract(
  workspaceRoot: string,
  contract: NonNullable<StoryExecutionContext["setupContract"]>,
): string[] {
  const failures: string[] = []
  for (const expectedFile of contract.expectedFiles) {
    // Skip prose entries the planner sometimes emits (e.g. "test runner
    // config file"); only literal path-shaped strings are checked. A real
    // filename has no spaces; directory entries end with "/".
    if (/\s/.test(expectedFile)) continue
    if (!existsSync(join(workspaceRoot, expectedFile))) {
      failures.push(`missing expected file: ${expectedFile}`)
    }
  }

  if (contract.requiredScripts.length > 0) {
    const packageJsonPath = join(workspaceRoot, "package.json")
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> }
      for (const script of contract.requiredScripts) {
        if (!packageJson.scripts?.[script]) {
          failures.push(`missing required package.json script: ${script}`)
          continue
        }
        const run = runShell(`npm run ${script}`, workspaceRoot)
        if (!run.ok) {
          const outputSuffix = run.output ? `\n${run.output}` : ""
          failures.push(`script failed: npm run ${script}${outputSuffix}`)
        }
      }
    } else {
      failures.push("missing package.json required to verify setup scripts")
    }
  }

  // postChecks are descriptive contract assertions, not shell commands —
  // the planner emits prose like "Project dependencies install locally".
  // Shape-verification (expectedFiles + requiredScripts) is the executable
  // gate; postChecks are passed to the coder/reviewer as context only.
  for (const postCheck of contract.postChecks) {
    const trimmed = postCheck.trim()
    if (!trimmed.startsWith("$ ") && !trimmed.startsWith("sh: ")) continue
    const cmd = trimmed.replace(/^\$\s+|^sh:\s+/, "")
    const run = runShell(cmd, workspaceRoot)
    if (!run.ok) {
      const outputSuffix = run.output ? `\n${run.output}` : ""
      failures.push(`post-check failed: ${cmd}${outputSuffix}`)
    }
  }
  return failures
}

export async function runSetupStory(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  story: UserStory,
  screenOwners: ScreenOwnerMap,
  opts: { worktreeRoot?: string },
  llm?: ExecutionLlmOptions,
): Promise<StoryResult> {
  const persistedImplementation = await readJsonIfExists<StoryImplementationArtifact>(
    join(layout.executionRalphDir(ctx, wave.number, story.id), "implementation.json"),
  )
  if (persistedImplementation?.status === "passed") {
    return { storyId: story.id, implementation: persistedImplementation }
  }
  const task = setupTaskForWave(wave, story.id)
  if (!task) throw new Error(`Setup wave ${wave.id} is missing task metadata for ${story.id}`)

  const testPlan = setupTestPlan(ctx, story, task.contract)
  const storyContext = buildStoryExecutionContext(ctx, wave, ctx.architecture, testPlan, {
    worktreeRoot: opts.worktreeRoot,
    screenOwners,
    kind: "setup",
    setupContract: task.contract,
    references: setupTaskReferences(ctx, story.id, task.references),
  })
  const workspaceRoot = storyContext.worktreeRoot ?? process.cwd()
  const executionLlm = executionStageLlmForStory(llm?.executionCoder, opts.worktreeRoot)
  const implementation: StoryImplementationArtifact = {
    story: { id: story.id, title: story.title },
    mode: "ralph-wiggum",
    status: "in_progress",
    implementationGoal: storyContext.testPlan.testPlan.summary,
    maxIterations: 3,
    maxReviewCycles: 3,
    currentReviewCycle: 0,
    iterations: [],
    coderSessionId: null,
    priorAttempts: [],
    changedFiles: [],
    finalSummary: "",
  }
  const dir = layout.executionRalphDir(ctx, wave.number, story.id)
  const implementationPath = join(dir, "implementation.json")
  const baselinePath = join(dir, "coder-baseline.json")
  await mkdir(dir, { recursive: true })

  for (let attempt = 1; attempt <= implementation.maxReviewCycles; attempt++) {
    let changedFiles: string[] = []
    let notes: string[] = []
    let summary = `Setup attempt ${attempt} completed.`
    if (executionLlm) {
      const coderResult = await runCoderHarness({
        harness: resolveHarness({
          workspaceRoot: executionLlm.workspaceRoot,
          harnessProfile: executionLlm.harnessProfile,
          runtimePolicy: executionLlm.runtimePolicy,
          role: "coder",
          stage: "execution",
        }),
        runtimePolicy: executionCoderPolicy(executionLlm.runtimePolicy),
        baselinePath,
        storyContext,
        sessionId: implementation.coderSessionId ?? null,
        iterationContext: {
          iteration: attempt,
          maxIterations: implementation.maxIterations,
          reviewCycle: attempt,
          maxReviewCycles: implementation.maxReviewCycles,
          priorAttempts: implementation.priorAttempts ?? [],
        },
      })
      implementation.coderSessionId = coderResult.sessionId
      changedFiles = coderResult.changedFiles
      notes = coderResult.implementationNotes
      summary = coderResult.summary
    }

    const failures = verifySetupContract(workspaceRoot, task.contract)
    implementation.changedFiles = Array.from(new Set([...implementation.changedFiles, ...changedFiles]))
    implementation.iterations.push({
      number: attempt,
      reviewCycle: attempt - 1,
      action: "Apply setup contract",
      checks: [{
        name: "setup-contract",
        kind: "review-gate",
        status: failures.length === 0 ? "pass" : "fail",
        summary: failures.length === 0 ? "Setup contract satisfied." : failures.join("; "),
      }],
      result: failures.length === 0 ? "done" : "review_feedback_applied",
      notes: [...notes, ...failures],
    })
    implementation.priorAttempts?.push({
      iteration: attempt,
      summary,
      outcome: failures.length === 0 ? "passed" : "failed",
    })
    implementation.currentReviewCycle = attempt - 1
    if (failures.length === 0) {
      implementation.status = "passed"
      implementation.finalSummary = "Setup contract satisfied."
      // Commit whatever the coder placed in the worktree so that
      // mergeStoryIntoWave carries real content onto the wave branch.
      // No-op when the tree is already clean (idempotent).
      if (opts.worktreeRoot) {
        const sha = commitAll(opts.worktreeRoot, `Setup task ${task.id}: ${task.title}`)
        if (sha) {
          stagePresent.dim(`  Committed setup worktree ${task.id}: ${sha.slice(0, 8)}`)
        }
      }
      break
    }
    implementation.finalSummary = failures.join("; ")
  }

  if (implementation.status !== "passed") {
    implementation.status = "blocked"
    implementation.finalSummary ||= "Setup contract did not converge within the review cap."
  }
  await writeFile(implementationPath, `${JSON.stringify(implementation, null, 2)}\n`)
  stagePresent.dim(`  Status: ${implementation.status}`)
  return { storyId: story.id, implementation }
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
    workspaceRoot: ctx.workspaceRoot!,
    runId: ctx.runId,
    createInitialState: (): TestWriterState => ({
      projectId: ctx.project.id,
      wave,
      story: { id: story.id, title: story.title },
      acceptanceCriteria: acs,
      design: projectDesignGuidance(ctx.design),
      architectureSummary: renderArchitectureSummary(ctx.architecture),
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
