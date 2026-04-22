import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ensureWaveBranch, mergeWaveBranchIntoProject } from "../../core/repoSimulation.js"
import { runStage } from "../../core/stageRuntime.js"
import { createTestWriterReview, createTestWriterStage, type RunLlmConfig } from "../../llm/registry.js"
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
  const tag = wave.parallel ? "(planned parallel, executed sequentially)" : "(sequential)"
  stagePresent.step(`\nWave ${wave.number} ${tag}: ${wave.stories.map(s => s.id).join(", ")}`)
  await ensureWaveBranch(ctx, ctx.project.id, wave.number)

  const run = (story: Pick<UserStory, "id" | "title">) =>
    implementStory(ctx, wave, resolveStory(story, storyById), {
      rerunTestWriter: resume?.storyId === story.id ? Boolean(resume.rerunTestWriter) : false,
    }, llm)

  const results = await sequentially(wave.stories, run)

  const summary = await writeWaveSummary(ctx, wave, ctx.project.id, results)
  stagePresent.ok(
    `Wave ${wave.number} complete — merged: ${summary.storiesMerged.length}, blocked: ${summary.storiesBlocked.length}`,
  )
  assertWaveSucceeded(wave, summary)
  await mergeWaveBranchIntoProject(ctx, ctx.project.id, wave.number)
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

function resolveStory(
  ref: Pick<UserStory, "id" | "title">,
  storyById: Map<string, UserStory>,
): UserStory {
  const full = storyById.get(ref.id)
  if (full) return full
  stagePresent.warn(`Story ${ref.id} is referenced by the plan but missing from the PRD — synthesizing scaffold ACs.`)
  return { id: ref.id, title: ref.title, acceptanceCriteria: [] }
}

async function implementStory(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  story: UserStory,
  opts: { rerunTestWriter?: boolean } = {},
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
  const testPlan = !opts.rerunTestWriter
    ? (await readJsonIfExists<StoryTestPlanArtifact>(testPlanPath)) ?? await writeStoryTestPlan(ctx, wave, story, llm?.stage)
    : await writeStoryTestPlan(ctx, wave, story, llm?.stage)
  stagePresent.dim(`  Test plan: ${testPlan.testPlan.testCases.map(tc => tc.id).join(", ")}`)
  const storyContext = buildStoryExecutionContext(ctx, wave, ctx.architecture, testPlan)
  const result: StoryArtifacts = await runRalphStory(storyContext, ctx, llm?.executionCoder)
  stagePresent.dim(`  Status: ${result.implementation.status}`)
  return { storyId: story.id, implementation: result.implementation }
}

function buildStoryExecutionContext(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  architecture: ArchitectureArtifact,
  testPlan: StoryTestPlanArtifact,
): StoryExecutionContext {
  return {
    item: {
      slug: ctx.itemSlug ?? ctx.workspaceId.replace(/-[^-]+$/, ""),
      baseBranch: ctx.baseBranch ?? "main",
    },
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
    maxReviews: 2,
  })

  return result
}
