import { join } from "node:path"

export type WorkflowContext = {
  workspaceId: string
  runId: string
  // Present in top-level workflow runs; absent in pure-layout call sites
  // (e.g., resume, stageRuntime) that only need workspaceId/runId to resolve
  // filesystem paths. Branch/repo helpers require them and will throw.
  itemSlug?: string
  baseBranch?: string
  // Absolute path of the target workspace on disk. When set, the workflow
  // operates against a real git repo at this path (base-branch detection,
  // realGit branch ops); when absent, it falls back to the simulated repo.
  workspaceRoot?: string
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-z0-9/-]/gi, "-").toLowerCase()
}

function sanitizeStageId(stageId: string): string {
  return stageId.split("/").map(sanitizeSegment).join("/")
}

function requireItemSlug(ctx: WorkflowContext): string {
  if (!ctx.itemSlug?.trim()) throw new Error("WorkflowContext.itemSlug is required for item-scoped worktree paths")
  return sanitizeSegment(ctx.itemSlug)
}

function root(): string {
  return join(process.cwd(), ".beerengineer", "workspaces")
}

function worktreesRoot(): string {
  return join(process.cwd(), ".beerengineer", "worktrees")
}

function workspaceDir(workspaceId: string): string {
  return join(root(), workspaceId)
}

function runDir(ctx: WorkflowContext): string {
  return join(workspaceDir(ctx.workspaceId), "runs", ctx.runId)
}

function stageDir(ctx: WorkflowContext, stageId: string): string {
  return join(runDir(ctx), "stages", sanitizeStageId(stageId))
}

export const layout = {
  workspaceDir,
  worktreesRoot,
  workspaceFile(workspaceId: string): string {
    return join(workspaceDir(workspaceId), "workspace.json")
  },
  runDir,
  runFile(ctx: WorkflowContext): string {
    return join(runDir(ctx), "run.json")
  },
  stageDir,
  stageRunFile(ctx: WorkflowContext, stageId: string): string {
    return join(stageDir(ctx, stageId), "run.json")
  },
  stageLogFile(ctx: WorkflowContext, stageId: string): string {
    return join(stageDir(ctx, stageId), "log.jsonl")
  },
  stageArtifactsDir(ctx: WorkflowContext, stageId: string): string {
    return join(stageDir(ctx, stageId), "artifacts")
  },
  repoStateWorkspaceFile(workspaceId: string): string {
    return join(workspaceDir(workspaceId), "repo-state.json")
  },
  repoStateRunFile(ctx: WorkflowContext): string {
    return join(runDir(ctx), "repo-state.json")
  },
  handoffDir(ctx: WorkflowContext): string {
    return join(runDir(ctx), "handoffs")
  },
  handoffFile(ctx: WorkflowContext, projectId: string): string {
    return join(layout.handoffDir(ctx), `${projectId.toLowerCase()}-merge-handoff.json`)
  },
  itemWorktreeRootDir(ctx: WorkflowContext): string {
    return join(worktreesRoot(), ctx.workspaceId, "items", requireItemSlug(ctx))
  },
  itemWorktreeDir(ctx: WorkflowContext): string {
    return join(layout.itemWorktreeRootDir(ctx), "worktree")
  },
  itemStoriesRootDir(ctx: WorkflowContext): string {
    return join(layout.itemWorktreeRootDir(ctx), "stories")
  },
  executionWaveDir(ctx: WorkflowContext, waveNumber: number): string {
    return join(stageDir(ctx, "execution"), "waves", `wave-${waveNumber}`)
  },
  executionStoryDir(ctx: WorkflowContext, waveNumber: number, storyId: string): string {
    return join(layout.executionWaveDir(ctx, waveNumber), "stories", storyId)
  },
  executionStoryWorktreeDir(ctx: WorkflowContext, waveNumber: number, storyId: string): string {
    return join(
      layout.itemStoriesRootDir(ctx),
      `${sanitizeSegment(ctx.runId)}__${sanitizeSegment(storyId)}`,
      "worktree",
    )
  },
  executionTestWriterDir(ctx: WorkflowContext, waveNumber: number, storyId: string): string {
    return join(layout.executionStoryDir(ctx, waveNumber, storyId), "test-writer")
  },
  executionRalphDir(ctx: WorkflowContext, waveNumber: number, storyId: string): string {
    return join(layout.executionStoryDir(ctx, waveNumber, storyId), "ralph")
  },
  waveSummaryFile(ctx: WorkflowContext, waveNumber: number): string {
    return join(layout.executionWaveDir(ctx, waveNumber), "wave-summary.json")
  },
}
