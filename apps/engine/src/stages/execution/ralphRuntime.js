import { mkdir } from "node:fs/promises";
import { branchNameProject, branchNameStory, branchNameWave, } from "../../core/branchNames.js";
import { layout } from "../../core/workspaceLayout.js";
import { runRalphLoop } from "./ralphStoryLoop.js";
import { newImplementation, ralphPaths, readPersistedStoryState, writeJson, } from "./ralphRuntimeShared.js";
export async function runRalphStory(storyContext, runtimeContext, llm) {
    const paths = ralphPaths(runtimeContext, storyContext);
    await mkdir(paths.dir, { recursive: true });
    const persisted = await readPersistedStoryState(paths);
    const implementation = persisted.implementation ?? newImplementation(storyContext);
    if (implementation.status === "passed" || implementation.status === "blocked") {
        return { implementation, review: persisted.review };
    }
    return runRalphLoop({
        ctx: { runtimeContext, storyContext, paths, llm },
        implementation,
        storyReview: persisted.review,
        pendingRemediation: persisted.pendingRemediation,
    });
}
export async function writeWaveSummary(runtimeContext, wave, projectId, summaries) {
    const summary = {
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
    };
    const path = layout.waveSummaryFile(runtimeContext, wave.number);
    await mkdir(layout.executionWaveDir(runtimeContext, wave.number), { recursive: true });
    await writeJson(path, summary);
    return summary;
}
