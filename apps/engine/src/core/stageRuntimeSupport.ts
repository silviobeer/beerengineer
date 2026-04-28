import type {
  ReviewContext,
  StageContext,
} from "./adapters.js"
import { emitEvent, getActiveRun } from "./runContext.js"
import type { StageDefinition, StageRun } from "./stageRuntime.js"

export function emitChatMessage<TState, TArtifact>(
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

export function emitLoopIteration<TState, TArtifact>(
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

export function reviewHistory<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
): ReviewContext["priorFeedback"] {
  return run.logs.flatMap(entry => {
    const cycle = typeof entry.data?.cycle === "number" ? entry.data.cycle : undefined
    const outcome = entry.data?.reviewOutcome
    if (!cycle || (outcome !== "revise" && outcome !== "block")) return []
    return [{ cycle, outcome, text: entry.message }]
  })
}

export function buildStageContext<TState, TArtifact>(
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

export function buildReviewContext<TState, TArtifact>(
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

export function syncSessions<TState, TArtifact, TResult>(
  definition: StageDefinition<TState, TArtifact, TResult>,
  run: StageRun<TState, TArtifact>,
): void {
  run.stageAgentSessionId = definition.stageAgent.getSessionId?.() ?? run.stageAgentSessionId ?? null
  run.reviewerSessionId = definition.reviewer.getSessionId?.() ?? run.reviewerSessionId ?? null
}

export function emitArtifactWrittenEvents<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
  pushLog: (
    currentRun: StageRun<TState, TArtifact>,
    entry: { type: "file_written"; message: string },
  ) => void,
): void {
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

export function emitReviewFeedbackEvent<TState, TArtifact>(
  run: StageRun<TState, TArtifact>,
  feedback: string,
): void {
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
