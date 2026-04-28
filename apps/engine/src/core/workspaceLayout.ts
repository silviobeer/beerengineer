import { join, resolve } from "node:path"

export type WorkflowContext = {
  workspaceId: string
  runId: string
  // Present in top-level workflow runs; absent in pure-layout call sites
  // (e.g., resume, stageRuntime) that only need workspaceId/runId to resolve
  // filesystem paths. Branch/repo helpers require them and will throw.
  itemSlug?: string
  baseBranch?: string
  // Absolute path of the target workspace on disk. The workflow operates
  // against a real git repo at this path (base-branch detection, branch
  // ops). Required at run-start time — simulation has been removed.
  workspaceRoot?: string
}

type WorkspaceScopedContext = Pick<WorkflowContext, "workspaceId" | "workspaceRoot">

function sanitizeSegment(segment: string): string {
  return segment.replaceAll(/[^a-z0-9/-]/gi, "-").toLowerCase()
}

function sanitizeStageId(stageId: string): string {
  return stageId.split("/").map(sanitizeSegment).join("/")
}

function requireItemSlug(ctx: WorkflowContext): string {
  if (!ctx.itemSlug?.trim()) throw new Error("WorkflowContext.itemSlug is required for item-scoped worktree paths")
  return sanitizeSegment(ctx.itemSlug)
}

function requireWorkspaceRoot(workspaceRoot: string | undefined): string {
  const normalized = workspaceRoot?.trim()
  if (!normalized) {
    throw new Error("workspace layout requires WorkflowContext.workspaceRoot for persisted artefacts")
  }
  return resolve(normalized)
}

function artefactsRoot(workspaceRoot: string): string {
  return join(requireWorkspaceRoot(workspaceRoot), ".beerengineer")
}

function root(workspaceRoot: string): string {
  return join(artefactsRoot(workspaceRoot), "workspaces")
}

function worktreesRoot(workspaceRoot: string): string {
  return join(artefactsRoot(workspaceRoot), "worktrees")
}

function workspaceDir(ctx: WorkspaceScopedContext): string {
  return join(root(requireWorkspaceRoot(ctx.workspaceRoot)), ctx.workspaceId)
}

function runDir(ctx: WorkflowContext): string {
  return join(workspaceDir(ctx), "runs", ctx.runId)
}

function stageDir(ctx: WorkflowContext, stageId: string): string {
  return join(runDir(ctx), "stages", sanitizeStageId(stageId))
}

export const layout = {
  artefactsRoot,
  workspaceRoot: requireWorkspaceRoot,
  workspaceDir,
  worktreesRoot,
  workspaceConfigFile(workspaceRoot: string): string {
    return join(artefactsRoot(workspaceRoot), "workspace.json")
  },
  workspaceFile(ctx: WorkspaceScopedContext): string {
    return join(workspaceDir(ctx), "workspace.json")
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
  repoStateWorkspaceFile(ctx: WorkspaceScopedContext): string {
    return join(workspaceDir(ctx), "repo-state.json")
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
    return join(worktreesRoot(requireWorkspaceRoot(ctx.workspaceRoot)), ctx.workspaceId, "items", requireItemSlug(ctx))
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
  executionStoryLegacyWorktreeDir(ctx: WorkflowContext, waveNumber: number, storyId: string): string {
    return join(
      layout.itemStoriesRootDir(ctx),
      `${sanitizeSegment(ctx.runId)}-${sanitizeSegment(storyId)}`,
      "worktree",
    )
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
