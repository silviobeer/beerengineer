import { EventEmitter } from "node:events"
import type { ExternalRemediationRow, ItemRow, Repos, RunRow } from "../db/repositories.js"
import { recordAnswer } from "./conversation.js"
import {
  MergeConflictResolutionInspectionError,
  isStructuredMergeConflictRecoveryRun,
  readMergeConflictRecoveryArtifact,
  validateMergeConflictResolution,
} from "./mergeConflictRecovery.js"
import { loadResumeReadiness } from "./resume.js"
import { resolveWorkflowContextForRun } from "./workflowContextResolver.js"
import type { WorkflowResumeInput } from "../workflow.js"

export type ItemAction =
  | "start_brainstorm"
  | "start_visual_companion"
  | "start_frontend_design"
  | "promote_to_requirements"
  | "start_implementation"
  | "import_prepared"
  | "rerun_design_prep"
  | "resume_run"
  | "promote_to_base"
  | "confirm_merge_resolved"
  | "cancel_promotion"
  | "mark_done"

export type VisibleItemAction =
  | "import_prepared"
  | "start_visual_companion"
  | "start_frontend_design"
  | "promote_to_requirements"
  | "cancel_promotion"
  | "confirm_merge_resolved"
  | "promote_to_base"

export const ITEM_ACTIONS: readonly ItemAction[] = [
  "start_brainstorm",
  "start_visual_companion",
  "start_frontend_design",
  "promote_to_requirements",
  "start_implementation",
  "import_prepared",
  "rerun_design_prep",
  "resume_run",
  "promote_to_base",
  "confirm_merge_resolved",
  "cancel_promotion",
  "mark_done"
] as const

export const VISIBLE_ACTION_FACTS_FRESHNESS = Object.freeze({
  strategy: "workspace_sse",
  invalidatedBy: [
    "item_column_changed",
    "prompt_requested",
    "prompt_answered",
    "run_started",
    "run_resumed",
    "run_blocked",
    "run_failed",
    "run_finished",
    "phase_started",
    "phase_completed",
    "phase_failed",
  ],
} satisfies {
  strategy: "workspace_sse"
  invalidatedBy: string[]
})

export type ResumePayload = {
  summary: string
  branch?: string
  commitSha?: string
  reviewNotes?: string
}

/**
 * Result of `perform()`. Two successful shapes:
 *  - `kind: "state"` — a pure column/phase transition applied in place
 *    (promote_to_requirements, mark_done).
 *  - `kind: "needs_spawn"` — the action starts or resumes a workflow. The
 *    service records intent (column change, remediation row) but the run
 *    itself must be executed by the CLI. The HTTP caller returns this marker
 *    so the UI layer can spawn `beerengineer item-action ...`.
 */
export type ItemActionResult =
  | { ok: true; kind: "state"; itemId: string; column: ItemRow["current_column"]; phaseStatus: ItemRow["phase_status"] }
  | {
      ok: true
      kind: "needs_spawn"
      itemId: string
      action: ItemAction
      column: ItemRow["current_column"]
      phaseStatus: ItemRow["phase_status"]
      runId?: string
      remediationId?: string
    }
  | {
      ok: true
      kind: "resume_run"
      itemId: string
      runId: string
      summary: string
      promptAnswer?: string
      branch?: string
      reviewNotes?: string
      resume?: WorkflowResumeInput
      column: ItemRow["current_column"]
      phaseStatus: ItemRow["phase_status"]
    }
  | { ok: false; status: 404; error: "item_not_found" }
  | {
      ok: false
      status: 409
      error: "invalid_transition" | "not_resumable" | "resume_in_progress" | "merge_resolution_incomplete" | "manual_resolution_commit_required"
      message?: string
      current: { column: string; phaseStatus: string }
      action: ItemAction
    }
  | { ok: false; status: 422; error: "remediation_required"; action: ItemAction }

export type ItemActionEvent =
  | { type: "item_column_changed"; itemId: string; from: ItemRow["current_column"]; to: ItemRow["current_column"]; phaseStatus: ItemRow["phase_status"] }

export type ItemActionsService = {
  perform(itemId: string, action: ItemAction, input?: { resume?: ResumePayload }): Promise<ItemActionResult>
  on(event: "event", listener: (ev: ItemActionEvent) => void): void
  off(event: "event", listener: (ev: ItemActionEvent) => void): void
  dispose(): void
}

type Transition =
  | { kind: "reject" }
  | { kind: "state"; to: { column: ItemRow["current_column"]; phase: ItemRow["phase_status"] } }
  | { kind: "start-run"; column: ItemRow["current_column"] }
  | { kind: "resume" }
  | { kind: "confirm-merge-resolved" }
  | { kind: "answer-prompt-or-resume"; promoteAnswer: string; resumeWhenNoPrompt: boolean }

type ColumnKey = ItemRow["current_column"]
type PhaseKey = ItemRow["phase_status"]
type ConfirmMergeResolutionContext = {
  recoverable: RunRow
  ctx: NonNullable<ReturnType<typeof resolveWorkflowContextForRun>> & { workspaceRoot: string }
}

/**
 * Action / state transition matrix. Keys are `${column}/${phase}` or a
 * wildcard `${column}/*`. Lookup tries the specific key first, then wildcard.
 */
export const ITEM_ACTION_MATRIX: Record<ItemAction, Record<string, Transition>> = {
  start_brainstorm: {
    "idea/draft": { kind: "start-run", column: "brainstorm" }
  },
  start_visual_companion: {
    // Manually opt into design-prep after brainstorm has produced its concept.
    "brainstorm/completed": { kind: "start-run", column: "frontend" },
    "brainstorm/review_required": { kind: "start-run", column: "frontend" },
    // Also reachable from inside the frontend column (e.g. "redo wireframes").
    "frontend/review_required": { kind: "start-run", column: "frontend" },
    "frontend/completed": { kind: "start-run", column: "frontend" }
  },
  start_frontend_design: {
    // Frontend-design needs a completed visual-companion to seed wireframes.
    // The action service itself doesn't gate on `current_stage`; runService
    // verifies that visual-companion artifacts exist before spawning.
    "frontend/review_required": { kind: "start-run", column: "frontend" },
    "frontend/completed": { kind: "start-run", column: "frontend" }
  },
  promote_to_requirements: {
    "brainstorm/*": { kind: "state", to: { column: "requirements", phase: "draft" } },
    // Skip-design or post-design promotion both land in requirements/draft.
    "frontend/*": { kind: "state", to: { column: "requirements", phase: "draft" } }
  },
  start_implementation: {
    "requirements/*": { kind: "start-run", column: "implementation" }
  },
  import_prepared: {
    "idea/*": { kind: "start-run", column: "implementation" },
    "brainstorm/*": { kind: "start-run", column: "implementation" },
    "frontend/*": { kind: "start-run", column: "implementation" },
    "requirements/*": { kind: "start-run", column: "implementation" }
  },
  rerun_design_prep: {
    "brainstorm/*": { kind: "start-run", column: "frontend" },
    "frontend/*": { kind: "start-run", column: "frontend" },
    "requirements/*": { kind: "start-run", column: "frontend" },
    "implementation/*": { kind: "start-run", column: "frontend" },
    "done/*": { kind: "start-run", column: "frontend" },
  },
  resume_run: {
    "brainstorm/*": { kind: "resume" },
    "frontend/*": { kind: "resume" },
    "requirements/*": { kind: "resume" },
    "implementation/completed": { kind: "resume" },
    "implementation/running": { kind: "resume" },
    "implementation/failed": { kind: "resume" },
    "merge/review_required": { kind: "resume" }
  },
  promote_to_base: {
    "merge/review_required": { kind: "answer-prompt-or-resume", promoteAnswer: "promote", resumeWhenNoPrompt: true }
  },
  confirm_merge_resolved: {
    "merge/review_required": { kind: "confirm-merge-resolved" }
  },
  cancel_promotion: {
    "merge/review_required": { kind: "answer-prompt-or-resume", promoteAnswer: "cancel", resumeWhenNoPrompt: false }
  },
  mark_done: {
    "implementation/review_required": { kind: "state", to: { column: "done", phase: "completed" } }
  }
}

export function lookupTransition(action: ItemAction, column: ColumnKey, phase: PhaseKey): Transition {
  const table = ITEM_ACTION_MATRIX[action]
  return table[`${column}/${phase}`] ?? table[`${column}/*`] ?? { kind: "reject" }
}

export function visibleActionsForItem(input: {
  column: ColumnKey
  phase: string
  currentStage?: string | null
  hasOpenPrompt?: boolean
  hasReviewGateWaiting?: boolean
  hasBlockedRun?: boolean
  hasMergeConflictBlockedRun?: boolean
}): VisibleItemAction[] {
  const phase = input.phase
  const stage = input.currentStage ?? null

  if ((input.column === "idea" || input.column === "requirements") && phase !== "running") {
    return ["import_prepared"]
  }
  if (input.column === "brainstorm" && (phase === "completed" || phase === "review_required")) {
    return ["start_visual_companion", "import_prepared"]
  }
  if (input.column === "frontend" && (phase === "completed" || phase === "review_required")) {
    if (stage === "visual-companion") return ["start_frontend_design"]
    if (stage === "frontend-design" || stage == null) return ["promote_to_requirements"]
    return []
  }
  if (input.column === "merge") {
    const actions: VisibleItemAction[] = []
    if (input.hasReviewGateWaiting) actions.push("cancel_promotion")
    if (input.hasMergeConflictBlockedRun) actions.push("confirm_merge_resolved")
    if (input.hasReviewGateWaiting || input.hasBlockedRun || input.hasOpenPrompt) actions.push("promote_to_base")
    return actions
  }
  return []
}

export function isItemAction(v: unknown): v is ItemAction {
  return typeof v === "string" && (ITEM_ACTIONS as readonly string[]).includes(v)
}

export type { Transition }

export function createItemActionsService(repos: Repos): ItemActionsService {
  const emitter = new EventEmitter()

  const emit = (ev: ItemActionEvent): void => {
    emitter.emit("event", ev)
  }

  const applyStateTransition = (
    item: ItemRow,
    to: { column: ColumnKey; phase: PhaseKey }
  ): ItemActionResult => {
    const from = item.current_column
    repos.setItemColumn(item.id, to.column, to.phase)
    emit({ type: "item_column_changed", itemId: item.id, from, to: to.column, phaseStatus: to.phase })
    return { ok: true, kind: "state", itemId: item.id, column: to.column, phaseStatus: to.phase }
  }

  const recordStartRunIntent = (
    item: ItemRow,
    action: ItemAction,
    column: ColumnKey
  ): ItemActionResult => {
    const from = item.current_column
    repos.setItemColumn(item.id, column, "running")
    emit({ type: "item_column_changed", itemId: item.id, from, to: column, phaseStatus: "running" })
    return {
      ok: true,
      kind: "needs_spawn",
      itemId: item.id,
      action,
      column,
      phaseStatus: "running",
    }
  }

  const latestResumableRun = (item: ItemRow): RunRow | undefined => {
    return repos.latestActiveRunForItem(item.id) ?? repos.latestRecoverableRunForItem(item.id)
  }

  const notResumableResult = (
    item: ItemRow,
    action: ItemAction,
    reason: "resume_in_progress" | "not_resumable",
  ): Extract<ItemActionResult, { ok: false; status: 409 }> => ({
    ok: false,
    status: 409,
    error: reason,
    current: { column: item.current_column, phaseStatus: item.phase_status },
    action,
  })

  const invalidTransition = (
    item: ItemRow,
    action: ItemAction,
    overrides: Partial<Extract<ItemActionResult, { ok: false; status: 409 }>> = {},
  ): Extract<ItemActionResult, { ok: false; status: 409 }> => ({
    ok: false,
    status: 409,
    error: "invalid_transition",
    current: { column: item.current_column, phaseStatus: item.phase_status },
    action,
    ...overrides,
  })

  const promptSupportsAnswer = (runId: string, expected: string): { runId: string; promptId: string } | null => {
    const open = repos.getOpenPrompt(runId)
    if (!open?.actions_json) return null
    try {
      const actions = JSON.parse(open.actions_json) as Array<{ value?: unknown }>
      const supported = actions.some(action => typeof action?.value === "string" && action.value === expected)
      return supported ? { runId, promptId: open.id } : null
    } catch {
      return null
    }
  }

  const recordResumeIntent = async (
    item: ItemRow,
    action: ItemAction,
    input: { resume?: ResumePayload } | undefined
  ): Promise<ItemActionResult> => {
    const active = latestResumableRun(item)
    if (!active) {
      return {
        ok: false,
        status: 409,
        error: "invalid_transition",
        current: { column: item.current_column, phaseStatus: item.phase_status },
        action,
      }
    }

    const readiness = await loadResumeReadiness(repos, active.id)
    if (readiness.kind === "not_resumable") {
      return {
        ok: false,
        status: 409,
        error: readiness.reason === "resume_in_progress" ? "resume_in_progress" : "not_resumable",
        current: { column: item.current_column, phaseStatus: item.phase_status },
        action,
      }
    }

    // Run exists but has no recovery record — nothing to remediate, just
    // point the caller at the run. Matches legacy behavior.
    if (readiness.kind !== "ready") {
      return {
        ok: true,
        kind: "needs_spawn",
        itemId: item.id,
        action,
        column: item.current_column,
        phaseStatus: item.phase_status,
        runId: active.id,
      }
    }

    if (!input?.resume) {
      return { ok: false, status: 422, error: "remediation_required", action }
    }

    let scopeRef: string | null = null
    if (readiness.record.scope.type === "stage") scopeRef = readiness.record.scope.stageId
    else if (readiness.record.scope.type === "story") {
      scopeRef = `${readiness.record.scope.waveNumber}/${readiness.record.scope.storyId}`
    }
    const remediation: ExternalRemediationRow = repos.createExternalRemediation({
      runId: active.id,
      scope: readiness.record.scope.type,
      scopeRef,
      summary: input.resume.summary,
      branch: input.resume.branch,
      commitSha: input.resume.commitSha,
      reviewNotes: input.resume.reviewNotes,
      source: "api",
    })

    return {
      ok: true,
      kind: "needs_spawn",
      itemId: item.id,
      action,
      column: item.current_column,
      phaseStatus: item.phase_status,
      runId: active.id,
      remediationId: remediation.id,
    }
  }

  const recordPromptOrResumeIntent = async (
    item: ItemRow,
    action: ItemAction,
    transition: Extract<Transition, { kind: "answer-prompt-or-resume" }>,
  ): Promise<ItemActionResult> => {
    const liveRun = repos.latestActiveRunForItem(item.id)
    const supportedPrompt = liveRun ? promptSupportsAnswer(liveRun.id, transition.promoteAnswer) : null
    if (supportedPrompt) {
      const answered = recordAnswer(repos, {
        runId: supportedPrompt.runId,
        promptId: supportedPrompt.promptId,
        answer: transition.promoteAnswer,
        source: "api",
      })
      if (!answered.ok) {
        return invalidTransition(item, action)
      }
      return {
        ok: true,
        kind: "state",
        itemId: item.id,
        column: item.current_column,
        phaseStatus: item.phase_status,
      }
    }

    if (!transition.resumeWhenNoPrompt) {
      return invalidTransition(item, action)
    }

    const recoverable = repos.latestRecoverableRunForItem(item.id)
    if (recoverable?.recovery_status !== "blocked" || recoverable.recovery_scope_ref !== "merge-gate") {
      return invalidTransition(item, action)
    }

    const readiness = await loadResumeReadiness(repos, recoverable.id)
    if (readiness.kind === "not_resumable") {
      return {
        ok: false,
        status: 409,
        error: readiness.reason === "resume_in_progress" ? "resume_in_progress" : "not_resumable",
        current: { column: item.current_column, phaseStatus: item.phase_status },
        action,
      }
    }
    if (readiness.kind !== "ready" && readiness.kind !== "no_recovery") {
      return {
        ok: false,
        status: 409,
        error: "not_resumable",
        current: { column: item.current_column, phaseStatus: item.phase_status },
        action,
      }
    }

    return {
      ok: true,
      kind: "resume_run",
      itemId: item.id,
      runId: recoverable.id,
      summary: `Operator resumed promotion of ${item.code} to base branch`,
      promptAnswer: transition.promoteAnswer,
      column: item.current_column,
      phaseStatus: item.phase_status,
    }
  }

  const loadConfirmMergeResolutionContext = async (
    item: ItemRow,
    action: ItemAction,
  ): Promise<ConfirmMergeResolutionContext | ItemActionResult> => {
    const recoverable = repos.latestRecoverableRunForItem(item.id)
    if (!isStructuredMergeConflictRecoveryRun(recoverable)) return invalidTransition(item, action)

    const readiness = await loadResumeReadiness(repos, recoverable.id)
    if (readiness.kind === "not_resumable") {
      return notResumableResult(item, action, readiness.reason === "resume_in_progress" ? "resume_in_progress" : "not_resumable")
    }
    if (readiness.kind !== "ready") return invalidTransition(item, action)

    const ctx = resolveWorkflowContextForRun(repos, recoverable)
    if (!ctx?.workspaceRoot) return invalidTransition(item, action)

    return { recoverable, ctx: { ...ctx, workspaceRoot: ctx.workspaceRoot } }
  }

  const validateConfirmedMergeResolution = async (
    item: ItemRow,
    action: ItemAction,
    ctx: ConfirmMergeResolutionContext["ctx"],
  ): Promise<ItemActionResult | null> => {
    const artifact = await readMergeConflictRecoveryArtifact(ctx)
    if (!artifact) return invalidTransition(item, action)

    try {
      const validation = validateMergeConflictResolution(ctx.workspaceRoot, artifact)
      if (!validation.ok) {
        return invalidTransition(item, action, {
          error: validation.error,
          message: validation.message,
        })
      }
      return null
    } catch (error) {
      if (error instanceof MergeConflictResolutionInspectionError) {
        return invalidTransition(item, action, { message: error.message })
      }
      throw error
    }
  }

  const confirmMergeResolved = async (
    item: ItemRow,
    action: ItemAction,
  ): Promise<ItemActionResult> => {
    const context = await loadConfirmMergeResolutionContext(item, action)
    if ("ok" in context) return context

    const validationFailure = await validateConfirmedMergeResolution(item, action, context.ctx)
    if (validationFailure) return validationFailure

    return {
      ok: true,
      kind: "resume_run",
      itemId: item.id,
      runId: context.recoverable.id,
      summary: `Operator confirmed manual merge resolution for ${item.code}.`,
      resume: {
        scope: { type: "stage", runId: context.recoverable.id, stageId: "merge-gate" },
        currentStage: "merge-gate",
        skipMergeGate: true,
      },
      column: item.current_column,
      phaseStatus: item.phase_status,
    }
  }

  return {
    async perform(itemId, action, input): Promise<ItemActionResult> {
      const item = repos.getItem(itemId)
      if (!item) return { ok: false, status: 404, error: "item_not_found" }

      const transition = lookupTransition(action, item.current_column, item.phase_status)
      switch (transition.kind) {
        case "reject":
          return {
            ok: false,
            status: 409,
            error: "invalid_transition",
            current: { column: item.current_column, phaseStatus: item.phase_status },
            action,
          }
        case "state":
          return applyStateTransition(item, transition.to)
        case "start-run":
          return recordStartRunIntent(item, action, transition.column)
        case "resume":
          return recordResumeIntent(item, action, input)
        case "confirm-merge-resolved":
          return confirmMergeResolved(item, action)
        case "answer-prompt-or-resume":
          return recordPromptOrResumeIntent(item, action, transition)
      }
    },
    on(event, listener) {
      emitter.on(event, listener)
    },
    off(event, listener) {
      emitter.off(event, listener)
    },
    dispose() {
      emitter.removeAllListeners()
    }
  }
}
