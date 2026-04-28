import { branchNameStory } from "../../core/branchNames.js"
import { computeScreenOwners, type ScreenOwnerMap } from "../../core/screenOwners.js"
import { projectDesignGuidance } from "../../core/designPrep.js"
import { renderArchitectureSummary } from "../../render/artifactDigests.js"
import type { RunLlmConfig } from "../../llm/registry.js"
import type {
  ArchitectureArtifact,
  StoryExecutionContext,
  StoryReference,
  StoryTestPlanArtifact,
  WaveDefinition,
  WithArchitecture,
  WithPlan,
} from "../../types.js"

function requireField<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null) {
    throw new Error(`WorkflowContext.${name} is required during execution stage`)
  }
  return value
}

export function executionStageLlmForStory(
  llm: RunLlmConfig | undefined,
  worktreeRoot?: string,
): RunLlmConfig | undefined {
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
    architectureSummary: renderArchitectureSummary(architecture),
    wave: {
      id: wave.id,
      number: wave.number,
      goal: wave.goal,
      dependencies: wave.dependencies,
    },
    storyBranch: branchNameStory(ctx, ctx.project.id, wave.number, testPlan.story.id),
    worktreeRoot: opts.worktreeRoot,
    design: opts.kind === "setup" ? ctx.design : projectDesignGuidance(ctx.design),
    mockupHtmlByScreen: resolveStoryMockups(ctx, wave, testPlan.story.id, opts.screenOwners),
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

export function createScreenOwners(ctx: WithPlan): ScreenOwnerMap {
  return computeScreenOwners(ctx.prd, ctx.plan, ctx.wireframes)
}
