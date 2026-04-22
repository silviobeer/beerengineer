import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type {
  ReviewAgentAdapter,
  StageAgentAdapter,
  StageAgentResponse,
} from "./adapters.js"
import { emitEvent, getActiveRun } from "./runContext.js"
import { layout, type WorkflowContext } from "./workspaceLayout.js"

export type StageStatus =
  | "not_started"
  | "chat_in_progress"
  | "waiting_for_user"
  | "artifact_ready"
  | "in_review"
  | "revision_requested"
  | "approved"
  | "blocked"
  | "failed"

export type StageLogType =
  | "status_changed"
  | "stage_message"
  | "user_message"
  | "artifact_created"
  | "review_pass"
  | "review_revise"
  | "file_written"
  | "iteration"
  | "branch_event"

export type StageLogEntry = {
  at: string
  type: StageLogType
  message: string
  data?: Record<string, unknown>
}

export type StageArtifactFile = {
  kind: "json" | "md" | "txt"
  label: string
  path: string
}

export type StageArtifactContent = {
  kind: StageArtifactFile["kind"]
  label: string
  fileName: string
  content: string
}

export type StageRun<TState, TArtifact> = {
  id: string
  workspaceId: string
  runId: string
  workspaceDir: string
  runDir: string
  stage: string
  stageDir: string
  stageArtifactsDir: string
  status: StageStatus
  iteration: number
  reviewIteration: number
  state: TState
  artifact?: TArtifact
  logs: StageLogEntry[]
  files: StageArtifactFile[]
  createdAt: string
  updatedAt: string
}

export type StageDefinition<TState, TArtifact, TResult> = {
  stageId: string
  stageAgentLabel: string
  reviewerLabel: string
  workspaceId: string
  runId: string
  createInitialState(): TState
  stageAgent: StageAgentAdapter<TState, TArtifact>
  reviewer: ReviewAgentAdapter<TState, TArtifact>
  askUser(prompt: string): Promise<string>
  showMessage(role: string, text: string): void
  onApproved(artifact: TArtifact, run: StageRun<TState, TArtifact>): Promise<TResult>
  persistArtifacts(run: StageRun<TState, TArtifact>, artifact: TArtifact): Promise<StageArtifactContent[]>
  maxReviews: number
}

function nowIso(): string {
  return new Date().toISOString()
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
  const dir = layout.workspaceDir(ctx.workspaceId)
  await mkdir(dir, { recursive: true })
  await writeFile(
    layout.workspaceFile(ctx.workspaceId),
    JSON.stringify(
      {
        id: ctx.workspaceId,
        status,
        currentStage: stageId,
        currentRunId: ctx.runId,
        updatedAt: nowIso(),
      },
      null,
      2,
    ),
  )
}

async function persistRun<TState, TArtifact>(run: StageRun<TState, TArtifact>): Promise<void> {
  const ctx: WorkflowContext = { workspaceId: run.workspaceId, runId: run.runId }
  await mkdir(run.stageDir, { recursive: true })
  await writeFile(layout.stageRunFile(ctx, run.stage), JSON.stringify(run, null, 2))
  await writeFile(
    layout.stageLogFile(ctx, run.stage),
    `${run.logs.map(entry => JSON.stringify(entry)).join("\n")}${run.logs.length > 0 ? "\n" : ""}`,
  )
  await mkdir(run.runDir, { recursive: true })
  await writeFile(
    layout.runFile(ctx),
    JSON.stringify(
      {
        id: run.runId,
        workspaceId: run.workspaceId,
        currentStage: run.stage,
        status: run.status,
        updatedAt: nowIso(),
      },
      null,
      2,
    ),
  )
  await writeWorkspaceRecord(ctx, run.stage, run.status)
}

function pushLog<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
  entry: Omit<StageLogEntry, "at">,
): void {
  run.logs.push({ at: nowIso(), ...entry })
  run.updatedAt = nowIso()
}

function setStatus<TState, TArtifact>(run: StageRun<TState, TArtifact>, status: StageStatus): void {
  run.status = status
  pushLog(run, { type: "status_changed", message: `Status -> ${status}` })
}

export function createStageRun<TState, TArtifact>(
  definition: Pick<
    StageDefinition<TState, TArtifact, unknown>,
    "stageId" | "workspaceId" | "runId" | "createInitialState"
  >,
): StageRun<TState, TArtifact> {
  const ctx: WorkflowContext = { workspaceId: definition.workspaceId, runId: definition.runId }
  const startedAt = nowIso()
  return {
    id: startedAt.replace(/[:.]/g, "-"),
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    workspaceDir: layout.workspaceDir(ctx.workspaceId),
    runDir: layout.runDir(ctx),
    stage: definition.stageId,
    stageDir: layout.stageDir(ctx, definition.stageId),
    stageArtifactsDir: layout.stageArtifactsDir(ctx, definition.stageId),
    status: "not_started",
    iteration: 0,
    reviewIteration: 0,
    state: definition.createInitialState(),
    logs: [],
    files: [],
    createdAt: startedAt,
    updatedAt: startedAt,
  }
}

export async function runStage<TState, TArtifact, TResult>(
  definition: StageDefinition<TState, TArtifact, TResult>,
): Promise<{ result: TResult; run: StageRun<TState, TArtifact> }> {
  const run = createStageRun<TState, TArtifact>(definition)

  await persistRun(run)
  setStatus(run, "chat_in_progress")

  let response: StageAgentResponse<TArtifact> = await definition.stageAgent.step({
    kind: "begin",
    state: run.state,
  })

  while (true) {
    if (response.kind === "message") {
      setStatus(run, "waiting_for_user")
      pushLog(run, { type: "stage_message", message: response.message })
      await persistRun(run)
      definition.showMessage(definition.stageAgentLabel, response.message)

      const userMessage = await definition.askUser("  du > ")
      pushLog(run, { type: "user_message", message: userMessage })
      run.iteration++
      setStatus(run, "chat_in_progress")
      response = await definition.stageAgent.step({
        kind: "user-message",
        state: run.state,
        userMessage,
      })
      continue
    }

    run.artifact = response.artifact
    setStatus(run, "artifact_ready")
    pushLog(run, { type: "artifact_created", message: "Artefakt erzeugt." })

    const artifactContents = await definition.persistArtifacts(run, response.artifact)
    run.files = await writeArtifactFiles(run.stageArtifactsDir, artifactContents)
    for (const file of run.files) {
      pushLog(run, { type: "file_written", message: `${file.label}: ${file.path}` })
      const activeRun = getActiveRun()
      if (activeRun) {
        emitEvent({
          type: "artifact_written",
          runId: activeRun.runId,
          stageRunId: activeRun.stageRunId ?? null,
          label: file.label,
          kind: file.kind,
          path: file.path,
        })
      }
    }

    setStatus(run, "in_review")
    run.reviewIteration++
    await persistRun(run)

    const review = await definition.reviewer.review({
      artifact: response.artifact,
      state: run.state,
    })

    if (review.kind === "pass") {
      pushLog(run, { type: "review_pass", message: "Review bestanden." })
      setStatus(run, "approved")
      await persistRun(run)
      const result = await definition.onApproved(response.artifact, run)
      return { result, run }
    }

    if (review.kind === "block") {
      setStatus(run, "blocked")
      await persistRun(run)
      throw new Error(review.reason)
    }

    pushLog(run, { type: "review_revise", message: review.feedback })
    if (run.reviewIteration >= definition.maxReviews) {
      setStatus(run, "blocked")
      await persistRun(run)
      throw new Error(`Blocked: kein Pass nach ${definition.maxReviews} Reviews`)
    }

    setStatus(run, "revision_requested")
    await persistRun(run)
    definition.showMessage(definition.reviewerLabel, review.feedback)
    response = await definition.stageAgent.step({
      kind: "review-feedback",
      state: run.state,
      reviewFeedback: review.feedback,
    })
  }
}
