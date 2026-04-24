import { parseLogData } from "../api/http.js"
import type { StageLogRow } from "../db/repositories.js"
import type { WorkflowEvent } from "./io.js"
import { levelOf, type CanonicalMessageType, type MessagingLevel } from "./messagingLevel.js"

export type MessageEntry = {
  id: string
  ts: string
  runId: string
  stageRunId: string | null
  type: CanonicalMessageType
  level: MessagingLevel
  force: boolean
  payload: Record<string, unknown>
}

function parseRecoveryScope(
  value: unknown,
  runId: string,
): Extract<WorkflowEvent, { type: "run_blocked" }>["scope"] {
  if (typeof value !== "object" || value === null) return { type: "run", runId }
  const scope = value as Record<string, unknown>
  if (scope.type === "stage" && typeof scope.stageId === "string") {
    return { type: "stage", runId, stageId: scope.stageId }
  }
  if (scope.type === "story" && typeof scope.waveNumber === "number" && typeof scope.storyId === "string") {
    return { type: "story", runId, waveNumber: scope.waveNumber, storyId: scope.storyId }
  }
  return { type: "run", runId }
}

function eventFromStageLog(row: StageLogRow): WorkflowEvent | null {
  const data = (parseLogData(row.data_json) as Record<string, unknown> | undefined) ?? {}
  switch (row.event_type) {
    case "run_started":
      return {
        type: "run_started",
        runId: row.run_id,
        itemId: typeof data.itemId === "string" ? data.itemId : "",
        title: typeof data.title === "string" ? data.title : row.message,
      }
    case "run_finished":
      return {
        type: "run_finished",
        runId: row.run_id,
        itemId: typeof data.itemId === "string" ? data.itemId : "",
        title: typeof data.title === "string" ? data.title : "",
        status: data.status === "failed" ? "failed" : "completed",
        error: typeof data.error === "string" ? data.error : undefined,
      }
    case "stage_started":
      return {
        type: "stage_started",
        runId: row.run_id,
        stageRunId: row.stage_run_id ?? (typeof data.stageRunId === "string" ? data.stageRunId : ""),
        stageKey: typeof data.stageKey === "string" ? data.stageKey : row.message.replace(/^stage\s+|\s+started$/g, ""),
        projectId: typeof data.projectId === "string" ? data.projectId : null,
      }
    case "stage_completed":
      return {
        type: "stage_completed",
        runId: row.run_id,
        stageRunId: row.stage_run_id ?? (typeof data.stageRunId === "string" ? data.stageRunId : ""),
        stageKey: typeof data.stageKey === "string" ? data.stageKey : "",
        status: data.status === "failed" ? "failed" : "completed",
        error: typeof data.error === "string" ? data.error : undefined,
      }
    case "prompt_requested":
      return {
        type: "prompt_requested",
        runId: row.run_id,
        promptId: typeof data.promptId === "string" ? data.promptId : "",
        prompt: typeof data.prompt === "string" ? data.prompt : row.message,
        stageRunId: row.stage_run_id ?? null,
      }
    case "prompt_answered":
      return {
        type: "prompt_answered",
        runId: row.run_id,
        promptId: typeof data.promptId === "string" ? data.promptId : "",
        answer: row.message,
      }
    case "loop_iteration":
      return {
        type: "loop_iteration",
        runId: row.run_id,
        stageRunId: row.stage_run_id ?? null,
        n: typeof data.n === "number" ? data.n : 0,
        phase:
          data.phase === "user-message" || data.phase === "review-feedback" || data.phase === "review"
            ? data.phase
            : "begin",
        stageKey: typeof data.stageKey === "string" ? data.stageKey : null,
      }
    case "tool_called":
      return {
        type: "tool_called",
        runId: row.run_id,
        stageRunId: row.stage_run_id ?? null,
        name: typeof data.name === "string" ? data.name : row.message,
        argsPreview: typeof data.argsPreview === "string" ? data.argsPreview : undefined,
        provider: typeof data.provider === "string" ? data.provider : undefined,
      }
    case "tool_result":
      return {
        type: "tool_result",
        runId: row.run_id,
        stageRunId: row.stage_run_id ?? null,
        name: typeof data.name === "string" ? data.name : row.message,
        argsPreview: typeof data.argsPreview === "string" ? data.argsPreview : undefined,
        resultPreview: typeof data.resultPreview === "string" ? data.resultPreview : undefined,
        provider: typeof data.provider === "string" ? data.provider : undefined,
        isError: data.isError === true,
      }
    case "llm_thinking":
      return {
        type: "llm_thinking",
        runId: row.run_id,
        stageRunId: row.stage_run_id ?? null,
        text: row.message,
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      }
    case "llm_tokens":
      return {
        type: "llm_tokens",
        runId: row.run_id,
        stageRunId: row.stage_run_id ?? null,
        in: typeof data.in === "number" ? data.in : 0,
        out: typeof data.out === "number" ? data.out : 0,
        cached: typeof data.cached === "number" ? data.cached : undefined,
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      }
    case "artifact_written":
      return {
        type: "artifact_written",
        runId: row.run_id,
        stageRunId: row.stage_run_id ?? null,
        label: typeof data.label === "string" ? data.label : row.message,
        kind: typeof data.kind === "string" ? data.kind : "",
        path: typeof data.path === "string" ? data.path : "",
      }
    case "log":
      return {
        type: "log",
        runId: row.run_id,
        message: row.message,
        level: data.level === "warn" || data.level === "error" ? data.level : "info",
      }
    case "chat_message":
      return {
        type: "chat_message",
        runId: row.run_id,
        stageRunId: row.stage_run_id ?? null,
        role: typeof data.role === "string" ? data.role : "assistant",
        source:
          data.source === "reviewer" || data.source === "system" || data.source === "cli" || data.source === "api" || data.source === "webhook"
            ? data.source
            : "stage-agent",
        text: row.message,
        requiresResponse: data.requiresResponse === true,
      }
    case "presentation":
      return {
        type: "presentation",
        runId: row.run_id,
        stageRunId: row.stage_run_id ?? null,
        kind:
          data.kind === "header" || data.kind === "step" || data.kind === "ok" || data.kind === "warn" || data.kind === "dim" || data.kind === "finding"
            ? data.kind
            : "dim",
        text: row.message,
        meta: (typeof data.meta === "object" && data.meta) ? (data.meta as { source?: string; severity?: string }) : undefined,
      }
    case "project_created":
      return {
        type: "project_created",
        runId: row.run_id,
        itemId: typeof data.itemId === "string" ? data.itemId : "",
        projectId: typeof data.projectId === "string" ? data.projectId : "",
        code: typeof data.code === "string" ? data.code : "",
        name: typeof data.name === "string" ? data.name : row.message,
        summary: typeof data.summary === "string" ? data.summary : "",
        position: typeof data.position === "number" ? data.position : 0,
      }
    case "run_blocked":
      return {
        type: "run_blocked",
        runId: row.run_id,
        itemId: typeof data.itemId === "string" ? data.itemId : "",
        title: typeof data.title === "string" ? data.title : "",
        scope: parseRecoveryScope(data.scope, row.run_id),
        cause: typeof data.cause === "string" ? data.cause : "",
        summary: row.message,
        branch: typeof data.branch === "string" ? data.branch : undefined,
      }
    case "run_failed":
      return {
        type: "run_failed",
        runId: row.run_id,
        scope: parseRecoveryScope(data.scope, row.run_id),
        cause: typeof data.cause === "string" ? data.cause : "",
        summary: row.message,
      }
    case "external_remediation_recorded":
      return {
        type: "external_remediation_recorded",
        runId: row.run_id,
        remediationId: typeof data.remediationId === "string" ? data.remediationId : "",
        scope: parseRecoveryScope(data.scope, row.run_id),
        summary: row.message,
        branch: typeof data.branch === "string" ? data.branch : undefined,
      }
    case "run_resumed":
      return {
        type: "run_resumed",
        runId: row.run_id,
        remediationId: typeof data.remediationId === "string" ? data.remediationId : "",
        scope: parseRecoveryScope(data.scope, row.run_id),
      }
    default:
      return null
  }
}

function payloadOf(event: WorkflowEvent, rawType: string): Record<string, unknown> {
  return { ...event, rawType }
}

export function projectWorkflowEvent(
  event: WorkflowEvent,
  input: { id: string; ts?: number | string },
): MessageEntry {
  const info = levelOf(event)
  const tsValue = typeof input.ts === "string" ? input.ts : new Date(input.ts ?? Date.now()).toISOString()
  return {
    id: input.id,
    ts: tsValue,
    runId: "runId" in event ? (event.runId ?? "") : "",
    stageRunId: "stageRunId" in event ? (event.stageRunId ?? null) : null,
    type: info.type,
    level: info.level,
    force: info.force,
    payload: payloadOf(event, event.type),
  }
}

export function projectStageLogRow(row: StageLogRow): MessageEntry | null {
  const event = eventFromStageLog(row)
  if (!event) return null
  return projectWorkflowEvent(event, { id: row.id, ts: row.created_at })
}
