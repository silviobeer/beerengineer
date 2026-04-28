import { join, resolve } from "node:path";
function sanitizeSegment(segment) {
    return segment.replaceAll(/[^a-z0-9/-]/gi, "-").toLowerCase();
}
function sanitizeStageId(stageId) {
    return stageId.split("/").map(sanitizeSegment).join("/");
}
function requireItemSlug(ctx) {
    if (!ctx.itemSlug?.trim())
        throw new Error("WorkflowContext.itemSlug is required for item-scoped worktree paths");
    return sanitizeSegment(ctx.itemSlug);
}
function requireWorkspaceRoot(workspaceRoot) {
    const normalized = workspaceRoot?.trim();
    if (!normalized) {
        throw new Error("workspace layout requires WorkflowContext.workspaceRoot for persisted artefacts");
    }
    return resolve(normalized);
}
function artefactsRoot(workspaceRoot) {
    return join(requireWorkspaceRoot(workspaceRoot), ".beerengineer");
}
function root(workspaceRoot) {
    return join(artefactsRoot(workspaceRoot), "workspaces");
}
function worktreesRoot(workspaceRoot) {
    return join(artefactsRoot(workspaceRoot), "worktrees");
}
function workspaceDir(ctx) {
    return join(root(requireWorkspaceRoot(ctx.workspaceRoot)), ctx.workspaceId);
}
function runDir(ctx) {
    return join(workspaceDir(ctx), "runs", ctx.runId);
}
function stageDir(ctx, stageId) {
    return join(runDir(ctx), "stages", sanitizeStageId(stageId));
}
export const layout = {
    artefactsRoot,
    workspaceRoot: requireWorkspaceRoot,
    workspaceDir,
    worktreesRoot,
    workspaceConfigFile(workspaceRoot) {
        return join(artefactsRoot(workspaceRoot), "workspace.json");
    },
    workspaceFile(ctx) {
        return join(workspaceDir(ctx), "workspace.json");
    },
    runDir,
    runFile(ctx) {
        return join(runDir(ctx), "run.json");
    },
    stageDir,
    stageRunFile(ctx, stageId) {
        return join(stageDir(ctx, stageId), "run.json");
    },
    stageLogFile(ctx, stageId) {
        return join(stageDir(ctx, stageId), "log.jsonl");
    },
    stageArtifactsDir(ctx, stageId) {
        return join(stageDir(ctx, stageId), "artifacts");
    },
    repoStateWorkspaceFile(ctx) {
        return join(workspaceDir(ctx), "repo-state.json");
    },
    repoStateRunFile(ctx) {
        return join(runDir(ctx), "repo-state.json");
    },
    handoffDir(ctx) {
        return join(runDir(ctx), "handoffs");
    },
    handoffFile(ctx, projectId) {
        return join(layout.handoffDir(ctx), `${projectId.toLowerCase()}-merge-handoff.json`);
    },
    itemWorktreeRootDir(ctx) {
        return join(worktreesRoot(requireWorkspaceRoot(ctx.workspaceRoot)), ctx.workspaceId, "items", requireItemSlug(ctx));
    },
    itemWorktreeDir(ctx) {
        return join(layout.itemWorktreeRootDir(ctx), "worktree");
    },
    itemStoriesRootDir(ctx) {
        return join(layout.itemWorktreeRootDir(ctx), "stories");
    },
    executionWaveDir(ctx, waveNumber) {
        return join(stageDir(ctx, "execution"), "waves", `wave-${waveNumber}`);
    },
    executionStoryDir(ctx, waveNumber, storyId) {
        return join(layout.executionWaveDir(ctx, waveNumber), "stories", storyId);
    },
    executionStoryLegacyWorktreeDir(ctx, waveNumber, storyId) {
        return join(layout.itemStoriesRootDir(ctx), `${sanitizeSegment(ctx.runId)}-${sanitizeSegment(storyId)}`, "worktree");
    },
    executionStoryWorktreeDir(ctx, waveNumber, storyId) {
        return join(layout.itemStoriesRootDir(ctx), `${sanitizeSegment(ctx.runId)}__${sanitizeSegment(storyId)}`, "worktree");
    },
    executionTestWriterDir(ctx, waveNumber, storyId) {
        return join(layout.executionStoryDir(ctx, waveNumber, storyId), "test-writer");
    },
    executionRalphDir(ctx, waveNumber, storyId) {
        return join(layout.executionStoryDir(ctx, waveNumber, storyId), "ralph");
    },
    waveSummaryFile(ctx, waveNumber) {
        return join(layout.executionWaveDir(ctx, waveNumber), "wave-summary.json");
    },
};
