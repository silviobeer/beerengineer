import { mkdir } from "node:fs/promises"
import {
  branchNameProject,
  branchNameStory,
  branchNameWave,
} from "../../core/branchNames.js"
import { layout, type WorkflowContext } from "../../core/workspaceLayout.js"
import type { RunLlmConfig } from "../../llm/registry.js"
import type { StoryExecutionContext, StoryImplementationArtifact, WaveSummary } from "../../types.js"
import { runRalphLoop } from "./ralphStoryLoop.js"
import {
  newImplementation,
  ralphPaths,
  readPersistedStoryState,
  writeJson,
  type StoryArtifacts,
} from "./ralphRuntimeShared.js"

export type { StoryArtifacts } from "./ralphRuntimeShared.js"

export async function runRalphStory(
  storyContext: StoryExecutionContext,
  runtimeContext: WorkflowContext,
  llm?: RunLlmConfig,
): Promise<StoryArtifacts> {
  const paths = ralphPaths(runtimeContext, storyContext)
  await mkdir(paths.dir, { recursive: true })
  const persisted = await readPersistedStoryState(paths)
  const implementation = persisted.implementation ?? newImplementation(storyContext)
  if (implementation.status === "passed" || implementation.status === "blocked") {
    return { implementation, review: persisted.review }
  }
  return runRalphLoop({
    ctx: { runtimeContext, storyContext, paths, llm },
    implementation,
    storyReview: persisted.review,
    pendingRemediation: persisted.pendingRemediation,
  })
}

export async function writeWaveSummary(
  runtimeContext: WorkflowContext,
  wave: { id: string; number: number },
  projectId: string,
  summaries: Array<{ storyId: string; implementation: StoryImplementationArtifact }>,
): Promise<WaveSummary> {
  const summary: WaveSummary = {
    waveId: wave.id,
    waveBranch: branchNameWave(runtimeContext, projectId, wave.number),
    projectBranch: branchNameProject(runtimeContext, projectId),
    storiesMerged: summaries
      .filter(({ implementation }) => implementation.status === "passed")
      .map(({ storyId, implementation }) => ({
        storyId,
        branch: branchNameStory(runtimeContext, projectId, wave.number, storyId),
        commitCount: implementation.iterations.length,
        filesIntegrated: implementation.changedFiles,
      })),
    storiesBlocked: summaries
      .filter(({ implementation }) => implementation.status === "blocked")
      .map(({ storyId }) => storyId),
  }

  const path = layout.waveSummaryFile(runtimeContext, wave.number)
  await mkdir(layout.executionWaveDir(runtimeContext, wave.number), { recursive: true })
  await writeJson(path, summary)
  return summary
}
