import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { layout, type WorkflowContext } from "./workspaceLayout.js"
import type {
  StageArtifactContent,
  StageArtifactFile,
  StageRun,
  StageStatus,
} from "./stageRuntime.js"

export function nowIso(): string {
  return new Date().toISOString()
}

export function workflowContextForRun<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
): WorkflowContext {
  return { workspaceId: run.workspaceId, workspaceRoot: run.workspaceRoot, runId: run.runId }
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2))
}

function workflowRunSnapshot(
  ctx: WorkflowContext,
  stageId: string,
  status: StageStatus | "completed",
) {
  return {
    id: ctx.runId,
    workspaceId: ctx.workspaceId,
    currentStage: stageId,
    status,
    updatedAt: nowIso(),
  }
}

export async function writeArtifactFiles(
  baseDir: string,
  artifacts: StageArtifactContent[],
): Promise<StageArtifactFile[]> {
  await mkdir(baseDir, { recursive: true })
  const files: StageArtifactFile[] = []
  for (const artifact of artifacts) {
    const path = join(baseDir, artifact.fileName)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, artifact.content)
    files.push({ kind: artifact.kind, label: artifact.label, path })
  }
  return files
}

async function writeWorkspaceRecord(
  ctx: WorkflowContext,
  stageId: string,
  status: StageStatus,
): Promise<void> {
  await writeJsonFile(
    layout.workspaceFile(ctx),
    {
      id: ctx.workspaceId,
      status,
      currentStage: stageId,
      currentRunId: ctx.runId,
      updatedAt: nowIso(),
    },
  )
}

export async function persistWorkflowRunState(
  ctx: WorkflowContext,
  stageId: string,
  status: StageStatus | "completed",
): Promise<void> {
  await writeJsonFile(layout.runFile(ctx), workflowRunSnapshot(ctx, stageId, status))
  await writeWorkspaceRecord(ctx, stageId, status === "completed" ? "approved" : status)
}

export async function persistRun<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
): Promise<void> {
  const ctx = workflowContextForRun(run)
  await writeJsonFile(layout.stageRunFile(ctx, run.stage), run)
  await writeFile(
    layout.stageLogFile(ctx, run.stage),
    `${run.logs.map(entry => JSON.stringify(entry)).join("\n")}${run.logs.length > 0 ? "\n" : ""}`,
  )
  await persistWorkflowRunState(ctx, run.stage, run.status)
}
