import { existsSync } from "node:fs";
import { join } from "node:path";
import { layout } from "./workspaceLayout.js";
import { resolveWorkflowContextForRun } from "./workflowContextResolver.js";
// Derives the on-disk workspace id used by the workflow runtime. Must stay in
// lockstep with WorkflowContext.workspaceId assembly in workflow.ts; changing
// it would orphan every existing item's artifacts on disk.
export function latestCompletedRunForItem(repos, itemId) {
    return repos
        .listRuns()
        .filter(run => run.item_id === itemId && run.status === "completed")
        .sort((a, b) => b.created_at - a.created_at)[0];
}
export function latestRunForItemWithStageArtifact(repos, itemId, stageId, artifactFileName) {
    return repos
        .listRuns()
        .filter(run => run.item_id === itemId)
        .sort((a, b) => b.created_at - a.created_at)
        .find((run) => {
        const ctx = resolveWorkflowContextForRun(repos, run);
        if (!ctx)
            return false;
        return existsSync(join(layout.stageArtifactsDir(ctx, stageId), artifactFileName));
    });
}
