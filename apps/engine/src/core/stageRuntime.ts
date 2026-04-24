import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type {
  ReviewContext,
  ReviewAgentAdapter,
  StageAgentAdapter,
  StageContext,
  StageAgentResponse,
} from "./adapters.js"
import { emitEvent, getActiveRun } from "./runContext.js"
import { writeRecoveryRecord, type RecoveryCause } from "./recovery.js"
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
  /** Count of user replies to the stage agent. Paired with `stageAgentTurnCount`. */
  userTurnCount: number
  stageAgentTurnCount: number
  reviewIteration: number
  stageAgentSessionId?: string | null
  reviewerSessionId?: string | null
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
  onApproved(artifact: TArtifact, run: StageRun<TState, TArtifact>): Promise<TResult>
  persistArtifacts(run: StageRun<TState, TArtifact>, artifact: TArtifact): Promise<StageArtifactContent[]>
  maxReviews: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function emitChatMessage<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
  role: string,
  source: "stage-agent" | "reviewer" | "system",
  text: string,
  requiresResponse = false,
): void {
  emitEvent({
    type: "chat_message",
    runId: run.runId,
    stageRunId: getActiveRun()?.stageRunId ?? null,
    role,
    source,
    text,
    requiresResponse,
  })
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

export async function persistWorkflowRunState(
  ctx: WorkflowContext,
  stageId: string,
  status: StageStatus | "completed",
): Promise<void> {
  const dir = layout.runDir(ctx)
  await mkdir(dir, { recursive: true })
  await writeFile(
    layout.runFile(ctx),
    JSON.stringify(
      {
        id: ctx.runId,
        workspaceId: ctx.workspaceId,
        currentStage: stageId,
        status,
        updatedAt: nowIso(),
      },
      null,
      2,
    ),
  )
  await writeWorkspaceRecord(ctx, stageId, status === "completed" ? "approved" : status)
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
  await persistWorkflowRunState(ctx, run.stage, run.status)
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
    userTurnCount: 0,
    stageAgentTurnCount: 0,
    reviewIteration: 0,
    stageAgentSessionId: null,
    reviewerSessionId: null,
    state: definition.createInitialState(),
    logs: [],
    files: [],
    createdAt: startedAt,
    updatedAt: startedAt,
  }
}

function reviewHistory<TState, TArtifact>(run: StageRun<TState, TArtifact>): ReviewContext["priorFeedback"] {
  return run.logs.flatMap(entry => {
    const cycle = typeof entry.data?.cycle === "number" ? entry.data.cycle : undefined
    const outcome = entry.data?.reviewOutcome
    if (!cycle || (outcome !== "revise" && outcome !== "block")) return []
    return [{ cycle, outcome, text: entry.message }]
  })
}

function buildStageContext<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
  phase: StageContext["phase"],
): StageContext {
  const priorFeedback = reviewHistory(run)
  return {
    turnCount: run.stageAgentTurnCount + 1,
    phase,
    ...(phase === "review-feedback" ? { priorFeedback } : {}),
  }
}

function buildReviewContext<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
  maxReviews: number,
): ReviewContext {
  const cycle = run.reviewIteration
  return {
    cycle,
    maxReviews,
    isFinalCycle: cycle >= maxReviews,
    priorFeedback: reviewHistory(run),
  }
}

function syncSessions<TState, TArtifact, TResult>(definition: StageDefinition<TState, TArtifact, TResult>, run: StageRun<TState, TArtifact>): void {
  run.stageAgentSessionId = definition.stageAgent.getSessionId?.() ?? run.stageAgentSessionId ?? null
  run.reviewerSessionId = definition.reviewer.getSessionId?.() ?? run.reviewerSessionId ?? null
}

async function recordStageBlocked<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
  cause: RecoveryCause,
  summary: string,
  extra?: { detail?: string; findings?: Array<{ source: string; severity: string; message: string }> },
): Promise<void> {
  const ctx: WorkflowContext = { workspaceId: run.workspaceId, runId: run.runId }
  const record = await writeRecoveryRecord(ctx, {
    status: cause === "system_error" ? "failed" : "blocked",
    cause,
    scope: { type: "stage", runId: run.runId, stageId: run.stage },
    summary,
    detail: extra?.detail,
    evidencePaths: [layout.stageRunFile(ctx, run.stage), layout.stageLogFile(ctx, run.stage)],
    findings: extra?.findings,
  })
  const activeRun = getActiveRun()
  if (record.status === "failed") {
    emitEvent({
      type: "run_failed",
      runId: run.runId,
      scope: { type: "stage", runId: run.runId, stageId: run.stage },
      cause,
      summary,
    })
    return
  }
  emitEvent({
    type: "run_blocked",
    runId: run.runId,
    itemId: activeRun?.itemId ?? "unknown-item",
    title: activeRun?.title ?? activeRun?.itemId ?? "unknown-item",
    scope: { type: "stage", runId: run.runId, stageId: run.stage },
    cause,
    summary,
  })
}

export async function runStage<TState, TArtifact, TResult>(
  definition: StageDefinition<TState, TArtifact, TResult>,
): Promise<{ result: TResult; run: StageRun<TState, TArtifact> }> {
  const run = createStageRun<TState, TArtifact>(definition)

  await persistRun(run)
  setStatus(run, "chat_in_progress")

  try {
    return await runStageBody(definition, run)
  } catch (err) {
    // Unhandled exceptions (adapter errors, etc.) become `failed` recovery
    // records. Reviewer-driven blocks already wrote their own record before
    // throwing — we detect that by checking run.status.
    if (run.status !== "blocked" && run.status !== "failed") {
      setStatus(run, "failed")
      await persistRun(run)
      await recordStageBlocked(run, "system_error", (err as Error).message)
    }
    throw err
  }
}

async function runStageBody<TState, TArtifact, TResult>(
  definition: StageDefinition<TState, TArtifact, TResult>,
  run: StageRun<TState, TArtifact>,
): Promise<{ result: TResult; run: StageRun<TState, TArtifact> }> {
  definition.stageAgent.setSessionId?.(run.stageAgentSessionId ?? null)
  definition.reviewer.setSessionId?.(run.reviewerSessionId ?? null)

  let response: StageAgentResponse<TArtifact> = await definition.stageAgent.step({
    kind: "begin",
    state: run.state,
    stageContext: buildStageContext(run, "begin"),
  })
  run.stageAgentTurnCount++
  syncSessions(definition, run)
  await persistRun(run)

  while (true) {
    if (response.kind === "message") {
      setStatus(run, "waiting_for_user")
      pushLog(run, { type: "stage_message", message: response.message })
      await persistRun(run)
      emitChatMessage(run, definition.stageAgentLabel, "stage-agent", response.message, true)

      const userMessage = await definition.askUser("  you > ")
      pushLog(run, { type: "user_message", message: userMessage })
      run.userTurnCount++
      setStatus(run, "chat_in_progress")
      response = await definition.stageAgent.step({
        kind: "user-message",
        state: run.state,
        userMessage,
        stageContext: buildStageContext(run, "user-message"),
      })
      run.stageAgentTurnCount++
      syncSessions(definition, run)
      await persistRun(run)
      continue
    }

    run.artifact = response.artifact
    setStatus(run, "artifact_ready")
    pushLog(run, { type: "artifact_created", message: "Artifact created." })

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
      reviewContext: buildReviewContext(run, definition.maxReviews),
    })
    syncSessions(definition, run)
    await persistRun(run)

    if (review.kind === "pass") {
      pushLog(run, { type: "review_pass", message: "Review passed." })
      setStatus(run, "approved")
      await persistRun(run)
      const result = await definition.onApproved(response.artifact, run)
      return { result, run }
    }

    if (review.kind === "block") {
      pushLog(run, { type: "status_changed", message: review.reason, data: { cycle: run.reviewIteration, reviewOutcome: "block" } })
      setStatus(run, "blocked")
      await persistRun(run)
      await recordStageBlocked(run, "review_block", review.reason)
      throw new Error(review.reason)
    }

    pushLog(run, { type: "review_revise", message: review.feedback, data: { cycle: run.reviewIteration, reviewOutcome: "revise" } })
    if (run.reviewIteration >= definition.maxReviews) {
      setStatus(run, "blocked")
      await persistRun(run)
      const summary = `Blocked: no pass after ${definition.maxReviews} reviews`
      await recordStageBlocked(run, "review_limit", summary, { detail: review.feedback })
      throw new Error(summary)
    }

    setStatus(run, "revision_requested")
    await persistRun(run)
    emitChatMessage(run, definition.reviewerLabel, "reviewer", review.feedback)
    response = await definition.stageAgent.step({
      kind: "review-feedback",
      state: run.state,
      reviewFeedback: review.feedback,
      stageContext: buildStageContext(run, "review-feedback"),
    })
    run.stageAgentTurnCount++
    syncSessions(definition, run)
    await persistRun(run)
  }
}
