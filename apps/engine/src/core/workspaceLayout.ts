import { join } from "node:path"

export type WorkflowContext = {
  workspaceId: string
  runId: string
  itemSlug?: string
  baseBranch?: string
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-z0-9/-]/gi, "-").toLowerCase()
}

function sanitizeStageId(stageId: string): string {
  return stageId.split("/").map(sanitizeSegment).join("/")
}

function root(): string {
  return join(process.cwd(), ".beerengineer", "workspaces")
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
  executionWaveDir(ctx: WorkflowContext, waveNumber: number): string {
    return join(stageDir(ctx, "execution"), "waves", `wave-${waveNumber}`)
  },
  executionStoryDir(ctx: WorkflowContext, waveNumber: number, storyId: string): string {
    return join(layout.executionWaveDir(ctx, waveNumber), "stories", storyId)
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
