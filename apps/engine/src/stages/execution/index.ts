import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { runStage } from "../../core/stageRuntime.js"
import { createTestWriterReview, createTestWriterStage, defaultStageConfig } from "../../llm/registry.js"
import { print } from "../../print.js"
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

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return undefined
  }
}

export async function execution(ctx: WithPlan, resume?: ExecutionResumeOptions): Promise<WaveSummary[]> {
  print.header(`execution — ${ctx.project.name}`)

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
    summaries.push(await executeWave(ctx, wave, storyById, resume))
    completedWaveIds.add(wave.id)
    if (resume?.waveNumber === wave.number) resume = undefined
  }

  print.ok("All waves complete\n")
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
): Promise<WaveSummary> {
  const tag = wave.parallel ? "(parallel)" : "(sequential)"
  print.step(`\nWave ${wave.number} ${tag}: ${wave.stories.map(s => s.id).join(", ")}`)

  const run = (story: Pick<UserStory, "id" | "title">) =>
    implementStory(ctx, wave, resolveStory(story, storyById), {
      rerunTestWriter: resume?.storyId === story.id ? Boolean(resume.rerunTestWriter) : false,
    })

  const results = wave.parallel
    ? await runParallelStories(wave.stories, run)
    : await sequentially(wave.stories, run)

  const summary = await writeWaveSummary({ workspaceId: ctx.workspaceId, runId: ctx.runId }, wave, results)
  print.ok(
    `Wave ${wave.number} complete — merged: ${summary.storiesMerged.length}, blocked: ${summary.storiesBlocked.length}`,
  )
  assertWaveSucceeded(wave, summary)
  return summary
}

async function runParallelStories(
  stories: WaveDefinition["stories"],
  run: (story: Pick<UserStory, "id" | "title">) => Promise<StoryResult>,
): Promise<StoryResult[]> {
  const settled = await Promise.allSettled(stories.map(run))
  return settled.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value
    const story = stories[index]
    print.warn(`Story ${story.id} crashed: ${(outcome.reason as Error).message}`)
    return {
      storyId: story.id,
      implementation: blockedPlaceholder(story, (outcome.reason as Error).message),
    }
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

function resolveStory(
  ref: Pick<UserStory, "id" | "title">,
  storyById: Map<string, UserStory>,
): UserStory {
  const full = storyById.get(ref.id)
  if (full) return full
  print.warn(`Story ${ref.id} is referenced by the plan but missing from the PRD — synthesizing scaffold ACs.`)
  return { id: ref.id, title: ref.title, acceptanceCriteria: [] }
}

async function implementStory(
  ctx: WithArchitecture,
  wave: WaveDefinition,
  story: UserStory,
  opts: { rerunTestWriter?: boolean } = {},
): Promise<StoryResult> {
  print.step(`  Story ${story.id}: ${story.title}`)

  const persistedImplementation = await readJsonIfExists<StoryImplementationArtifact>(
    join(layout.executionRalphDir(ctx, wave.number, story.id), "implementation.json"),
  )
  if (persistedImplementation?.status === "passed") {
    print.dim(`  Status: ${persistedImplementation.status}`)
    return { storyId: story.id, implementation: persistedImplementation }
  }

  const testPlanPath = join(layout.executionTestWriterDir(ctx, wave.number, story.id), "test-plan.json")
  const testPlan = !opts.rerunTestWriter
    ? (await readJsonIfExists<StoryTestPlanArtifact>(testPlanPath)) ?? await writeStoryTestPlan(ctx, wave, story)
    : await writeStoryTestPlan(ctx, wave, story)
  print.dim(`  Test plan: ${testPlan.testPlan.testCases.map(tc => tc.id).join(", ")}`)
  const storyContext = buildStoryExecutionContext(ctx.project, wave, ctx.architecture, testPlan)
  const result: StoryArtifacts = await runRalphStory(storyContext, { workspaceId: ctx.workspaceId, runId: ctx.runId })
  print.dim(`  Status: ${result.implementation.status}`)
  return { storyId: story.id, implementation: result.implementation }
}

function buildStoryExecutionContext(
  project: WithArchitecture["project"],
  wave: WaveDefinition,
  architecture: ArchitectureArtifact,
  testPlan: StoryTestPlanArtifact,
): StoryExecutionContext {
  return {
    project: { id: project.id, name: project.name },
    conceptSummary: project.concept.summary,
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
    stageAgent: createTestWriterStage(defaultStageConfig.stageAgent.provider, ctx.project),
    reviewer: createTestWriterReview(defaultStageConfig.reviewer.provider),
    askUser: async () => "",
    showMessage: print.llm,
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
