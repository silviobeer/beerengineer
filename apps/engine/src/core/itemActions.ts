import { EventEmitter } from "node:events"
import type { ItemRow, Repos, RunRow } from "../db/repositories.js"
import { createApiIOSession, type ApiIOSession } from "./ioApi.js"
import { prepareRun } from "./runOrchestrator.js"

export type ItemAction =
  | "start_brainstorm"
  | "promote_to_requirements"
  | "start_implementation"
  | "resume_run"
  | "mark_done"

export const ITEM_ACTIONS: readonly ItemAction[] = [
  "start_brainstorm",
  "promote_to_requirements",
  "start_implementation",
  "resume_run",
  "mark_done"
] as const

export type ItemActionResult =
  | { ok: true; itemId: string; runId?: string; column: ItemRow["current_column"]; phaseStatus: ItemRow["phase_status"] }
  | { ok: false; status: 404; error: "item_not_found" }
  | { ok: false; status: 409; error: "invalid_transition"; current: { column: string; phaseStatus: string }; action: ItemAction }

export type ItemActionEvent =
  | { type: "item_column_changed"; itemId: string; from: ItemRow["current_column"]; to: ItemRow["current_column"]; phaseStatus: ItemRow["phase_status"] }
  | { type: "run_started"; runId: string; itemId: string; startedAt: number }
  | { type: "stage_started"; runId: string; itemId: string; stage: string }

export type ItemActionsService = {
  /** Perform an action against an item. */
  perform(itemId: string, action: ItemAction): Promise<ItemActionResult>
  /** Subscribe to board-level events emitted by this service. */
  on(event: "event", listener: (ev: ItemActionEvent) => void): void
  off(event: "event", listener: (ev: ItemActionEvent) => void): void
  /** Consumed by the API server when it needs to attach an SSE session to a
   *  newly-started run (so the run console can still receive events). */
  sessions: Map<string, ApiIOSession>
  dispose(): void
}

type Transition =
  | { kind: "reject" }
  | { kind: "state"; to: { column: ItemRow["current_column"]; phase: ItemRow["phase_status"] } }
  | { kind: "start-run"; column: ItemRow["current_column"] }
  | { kind: "resume" }

type ColumnKey = ItemRow["current_column"]
type PhaseKey = ItemRow["phase_status"]

/**
 * The transition matrix from the plan. Keys are `${column}/${phase}` or a
 * wildcard `${column}/*`. Lookup tries the specific key first, then wildcard.
 */
const MATRIX: Record<ItemAction, Record<string, Transition>> = {
  start_brainstorm: {
    "idea/draft": { kind: "start-run", column: "brainstorm" }
  },
  promote_to_requirements: {
    "brainstorm/*": { kind: "state", to: { column: "requirements", phase: "draft" } }
  },
  start_implementation: {
    "requirements/*": { kind: "start-run", column: "implementation" }
  },
  resume_run: {
    "brainstorm/*": { kind: "resume" },
    "requirements/*": { kind: "resume" },
    "implementation/running": { kind: "resume" }
  },
  mark_done: {
    "implementation/review_required": { kind: "state", to: { column: "done", phase: "completed" } }
  }
}

function lookupTransition(action: ItemAction, column: ColumnKey, phase: PhaseKey): Transition {
  const table = MATRIX[action]
  return table[`${column}/${phase}`] ?? table[`${column}/*`] ?? { kind: "reject" }
}

export function isItemAction(v: unknown): v is ItemAction {
  return typeof v === "string" && (ITEM_ACTIONS as readonly string[]).includes(v)
}

export type ItemActionsOptions = {
  /** Called after a new run + session have been created for a start-run
   *  action. Lets the HTTP layer attach an SSE listener to the session. */
  onSessionStart?: (info: { session: ApiIOSession; runId: string; itemId: string }) => void
  /**
   * Override how a start-run action creates the run. Tests inject a stub to
   * avoid actually firing the workflow (which would hang on `ask()`).
   */
  startRun?: (item: ItemRow) => { runId: string; session?: ApiIOSession }
}

export function createItemActionsService(repos: Repos, opts: ItemActionsOptions = {}): ItemActionsService {
  const emitter = new EventEmitter()
  const sessions = new Map<string, ApiIOSession>()

  const emit = (ev: ItemActionEvent): void => {
    emitter.emit("event", ev)
  }

  const performStateTransition = (
    item: ItemRow,
    to: { column: ColumnKey; phase: PhaseKey }
  ): ItemActionResult => {
    const from = item.current_column
    repos.setItemColumn(item.id, to.column, to.phase)
    emit({ type: "item_column_changed", itemId: item.id, from, to: to.column, phaseStatus: to.phase })
    return { ok: true, itemId: item.id, column: to.column, phaseStatus: to.phase }
  }

  const startRunForItem = (
    item: ItemRow,
    action: ItemAction,
    target: { column: ColumnKey; phase: PhaseKey }
  ): { runId: string; column: ColumnKey; phaseStatus: PhaseKey } => {
    const from = item.current_column
    repos.setItemColumn(item.id, target.column, target.phase)
    emit({ type: "item_column_changed", itemId: item.id, from, to: target.column, phaseStatus: target.phase })

    if (opts.startRun) {
      const result = opts.startRun(item)
      if (result.session) {
        sessions.set(result.runId, result.session)
        opts.onSessionStart?.({ session: result.session, runId: result.runId, itemId: item.id })
      }
      emit({ type: "run_started", runId: result.runId, itemId: item.id, startedAt: Date.now() })
      if (action === "start_implementation") {
        emit({ type: "stage_started", runId: result.runId, itemId: item.id, stage: "execution" })
      }
      return { runId: result.runId, column: target.column, phaseStatus: target.phase }
    }

    if (action === "start_implementation") {
      const run = repos.createRun({
        workspaceId: item.workspace_id,
        itemId: item.id,
        title: item.title,
        owner: "api"
      })
      repos.updateRun(run.id, { current_stage: "execution" })
      const stageRun = repos.createStageRun({ runId: run.id, stageKey: "execution" })
      repos.appendLog({
        runId: run.id,
        eventType: "run_started",
        message: `run started from ${action}`,
        data: { itemId: item.id, startedAt: Date.now(), entryAction: action }
      })
      repos.appendLog({
        runId: run.id,
        stageRunId: stageRun.id,
        eventType: "stage_started",
        message: "stage execution started",
        data: { stage: "execution", itemId: item.id, entryAction: action }
      })
      emit({ type: "run_started", runId: run.id, itemId: item.id, startedAt: Date.now() })
      emit({ type: "stage_started", runId: run.id, itemId: item.id, stage: "execution" })
      return { runId: run.id, column: target.column, phaseStatus: target.phase }
    }

    // Reuse the API IO session machinery so the run console at
    // `/runs/:id/events` still receives streamed events.
    const session = createApiIOSession(repos)
    const prepared = prepareRun(
      { id: item.id, title: item.title, description: item.description },
      repos,
      session.io,
      { itemId: item.id, owner: "api" }
    )
    sessions.set(prepared.runId, session)
    opts.onSessionStart?.({ session, runId: prepared.runId, itemId: item.id })

    emit({ type: "run_started", runId: prepared.runId, itemId: item.id, startedAt: Date.now() })
    prepared
      .start()
      .catch(err => console.error("[itemActions]", err))
      .finally(() => {
        const t = setTimeout(() => {
          session.dispose()
          sessions.delete(prepared.runId)
        }, 30_000)
        // Allow the process to exit while this cleanup timer is pending —
        // the next start of the server resets the session anyway.
        t.unref?.()
      })

    return { runId: prepared.runId, column: target.column, phaseStatus: target.phase }
  }

  const resumeRun = (item: ItemRow): RunRow | undefined => {
    return repos.latestActiveRunForItem(item.id)
  }

  return {
    async perform(itemId, action): Promise<ItemActionResult> {
      const item = repos.getItem(itemId)
      if (!item) return { ok: false, status: 404, error: "item_not_found" }

      const transition = lookupTransition(action, item.current_column, item.phase_status)
      if (transition.kind === "reject") {
        return {
          ok: false,
          status: 409,
          error: "invalid_transition",
          current: { column: item.current_column, phaseStatus: item.phase_status },
          action
        }
      }

      if (transition.kind === "state") {
        return performStateTransition(item, transition.to)
      }

      if (transition.kind === "start-run") {
        const { runId, column, phaseStatus } = startRunForItem(item, action, {
          column: transition.column,
          phase: "running"
        })
        // The orchestrator's db-sync wrapper will update column/phase as
        // stages progress; emit the snapshot we know now.
        return {
          ok: true,
          itemId: item.id,
          runId,
          column,
          phaseStatus
        }
      }

      // resume
      const active = resumeRun(item)
      if (!active) {
        return {
          ok: false,
          status: 409,
          error: "invalid_transition",
          current: { column: item.current_column, phaseStatus: item.phase_status },
          action
        }
      }
      return {
        ok: true,
        itemId: item.id,
        runId: active.id,
        column: item.current_column,
        phaseStatus: item.phase_status
      }
    },
    on(event, listener) {
      emitter.on(event, listener)
    },
    off(event, listener) {
      emitter.off(event, listener)
    },
    sessions,
    dispose() {
      emitter.removeAllListeners()
    }
  }
}
