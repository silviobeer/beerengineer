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
import { isWorktreePortPoolExhaustedError } from "./portAllocator.js"
import { layout, type WorkflowContext } from "./workspaceLayout.js"
import { NON_INTERACTIVE_NO_ANSWER_SENTINEL } from "./constants.js"

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
  workspaceRoot: string
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
  workspaceRoot: string
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
  source: "stage-agent" | "reviewer" | "system" | "cli" | "api" | "webhook",
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

function emitLoopIteration<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
  phase: "begin" | "user-message" | "review-feedback" | "review",
  n: number,
): void {
  const activeRun = getActiveRun()
  if (!activeRun) return
  emitEvent({
    type: "loop_iteration",
    runId: activeRun.runId,
    stageRunId: activeRun.stageRunId ?? null,
    n,
    phase,
    stageKey: run.stage,
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
  const dir = layout.workspaceDir(ctx)
  await mkdir(dir, { recursive: true })
  await writeFile(
    layout.workspaceFile(ctx),
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
  const ctx: WorkflowContext = { workspaceId: run.workspaceId, workspaceRoot: run.workspaceRoot, runId: run.runId }
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
    "stageId" | "workspaceId" | "workspaceRoot" | "runId" | "createInitialState"
  >,
): StageRun<TState, TArtifact> {
  const ctx: WorkflowContext = {
    workspaceId: definition.workspaceId,
    workspaceRoot: definition.workspaceRoot,
    runId: definition.runId,
  }
  const startedAt = nowIso()
  return {
    id: startedAt.replaceAll(/[:.]/g, "-"),
    workspaceId: ctx.workspaceId,
    workspaceRoot: ctx.workspaceRoot!,
    runId: ctx.runId,
    workspaceDir: layout.workspaceDir(ctx),
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
  const ctx: WorkflowContext = { workspaceId: run.workspaceId, workspaceRoot: run.workspaceRoot, runId: run.runId }
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
      const cause: RecoveryCause = isWorktreePortPoolExhaustedError(err)
        ? "worktree_port_pool_exhausted"
        : "system_error"
      await recordStageBlocked(run, cause, (err as Error).message)
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
  emitLoopIteration(run, "begin", run.stageAgentTurnCount + 1)
  run.stageAgentTurnCount++
  syncSessions(definition, run)
  await persistRun(run)

  while (true) {
    if (response.kind === "message") {
      response = await continueStageAfterUserMessage(definition, run, response.message)
      continue
    }

    run.artifact = response.artifact
    setStatus(run, "artifact_ready")
    pushLog(run, { type: "artifact_created", message: "Artifact created." })

    await persistRunArtifacts(definition, run, response.artifact)

    setStatus(run, "in_review")
    run.reviewIteration++
    await persistRun(run)

    const review = await definition.reviewer.review({
      artifact: response.artifact,
      state: run.state,
      reviewContext: buildReviewContext(run, definition.maxReviews),
    })
    emitLoopIteration(run, "review", run.reviewIteration)
    syncSessions(definition, run)
    await persistRun(run)

    const nextStep = await handleReviewOutcome(definition, run, response.artifact, review)
    if (nextStep.kind === "approved") {
      return { result: nextStep.result, run }
    }
    response = nextStep.response
    emitLoopIteration(run, "review-feedback", run.stageAgentTurnCount + 1)
    run.stageAgentTurnCount++
    syncSessions(definition, run)
    await persistRun(run)
  }
}

async function persistRunArtifacts<TState, TArtifact, TResult>(
  definition: StageDefinition<TState, TArtifact, TResult>,
  run: StageRun<TState, TArtifact>,
  artifact: TArtifact,
): Promise<void> {
  const artifactContents = await definition.persistArtifacts(run, artifact)
  run.files = await writeArtifactFiles(run.stageArtifactsDir, artifactContents)
  emitArtifactWrittenEvents(run)
}

function emitArtifactWrittenEvents<TState, TArtifact>(run: StageRun<TState, TArtifact>): void {
  for (const file of run.files) {
    pushLog(run, { type: "file_written", message: `${file.label}: ${file.path}` })
    const activeRun = getActiveRun()
    if (!activeRun) continue
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

async function handleReviewOutcome<TState, TArtifact, TResult>(
  definition: StageDefinition<TState, TArtifact, TResult>,
  run: StageRun<TState, TArtifact>,
  artifact: TArtifact,
  review: Awaited<ReturnType<StageDefinition<TState, TArtifact, TResult>["reviewer"]["review"]>>,
): Promise<
  | { kind: "approved"; result: TResult }
  | { kind: "revise"; response: StageAgentResponse<TArtifact> }
> {
  if (review.kind === "pass") {
    pushLog(run, { type: "review_pass", message: "Review passed." })
    setStatus(run, "approved")
    await persistRun(run)
    return { kind: "approved", result: await definition.onApproved(artifact, run) }
  }

  if (review.kind === "block") {
    await blockReviewRun(run, review.reason)
  }
  if (review.kind !== "revise") {
    throw new Error(`Unsupported review outcome: ${String((review as { kind: string }).kind)}`)
  }

  return {
    kind: "revise",
    response: await requestRevision(definition, run, review.feedback),
  }
}

async function blockReviewRun<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
  reason: string,
): Promise<never> {
  pushLog(run, { type: "status_changed", message: reason, data: { cycle: run.reviewIteration, reviewOutcome: "block" } })
  setStatus(run, "blocked")
  await persistRun(run)
  await recordStageBlocked(run, "review_block", reason)
  throw new Error(reason)
}

async function requestRevision<TState, TArtifact, TResult>(
  definition: StageDefinition<TState, TArtifact, TResult>,
  run: StageRun<TState, TArtifact>,
  feedback: string,
): Promise<StageAgentResponse<TArtifact>> {
  pushLog(run, { type: "review_revise", message: feedback, data: { cycle: run.reviewIteration, reviewOutcome: "revise" } })
  if (run.reviewIteration >= definition.maxReviews) {
    setStatus(run, "blocked")
    await persistRun(run)
    const summary = `Blocked: no pass after ${definition.maxReviews} reviews`
    await recordStageBlocked(run, "review_limit", summary, { detail: feedback })
    throw new Error(summary)
  }

  setStatus(run, "revision_requested")
  await persistRun(run)
  emitChatMessage(run, definition.reviewerLabel, "reviewer", feedback)
  emitReviewFeedbackEvent(run, feedback)
  return definition.stageAgent.step({
    kind: "review-feedback",
    state: run.state,
    reviewFeedback: feedback,
    stageContext: buildStageContext(run, "review-feedback"),
  })
}

async function continueStageAfterUserMessage<TState, TArtifact, TResult>(
  definition: StageDefinition<TState, TArtifact, TResult>,
  run: StageRun<TState, TArtifact>,
  message: string,
): Promise<StageAgentResponse<TArtifact>> {
  setStatus(run, "waiting_for_user")
  pushLog(run, { type: "stage_message", message })
  await persistRun(run)
  emitChatMessage(run, definition.stageAgentLabel, "stage-agent", message, true)

  // Pass the agent's message as the prompt text so `pending_prompts` and
  // every transcript projection show real content instead of a "you >"
  // placeholder. Terminal renderers already displayed the chat_message
  // event above, so the CLI can safely suppress duplicate echo when it
  // sees the same text come back through `prompt_requested`.
  const userMessage = await definition.askUser(message)
  if (userMessage === NON_INTERACTIVE_NO_ANSWER_SENTINEL) {
    throw new Error(
      `Stage "${run.stage}" emitted a prompt but this is a non-interactive run with no stdin answers queued. ` +
      "Pipe answers via stdin (one per line), use the API (POST /runs/:id/answer) after the run " +
      "emits a pending_prompt event, or provide all required inputs up-front (e.g. --references)."
    )
  }
  pushLog(run, { type: "user_message", message: userMessage })
  run.userTurnCount++
  setStatus(run, "chat_in_progress")
  const response = await definition.stageAgent.step({
    kind: "user-message",
    state: run.state,
    userMessage,
    stageContext: buildStageContext(run, "user-message"),
  })
  emitLoopIteration(run, "user-message", run.stageAgentTurnCount + 1)
  run.stageAgentTurnCount++
  syncSessions(definition, run)
  await persistRun(run)
  return response
}

function emitReviewFeedbackEvent<TState, TArtifact>(run: StageRun<TState, TArtifact>, feedback: string): void {
  const activeRunForReview = getActiveRun()
  if (!activeRunForReview) return
  emitEvent({
    type: "review_feedback",
    runId: activeRunForReview.runId,
    stageRunId: activeRunForReview.stageRunId ?? null,
    stageKey: run.stage,
    cycle: run.reviewIteration,
    feedback,
  })
}
