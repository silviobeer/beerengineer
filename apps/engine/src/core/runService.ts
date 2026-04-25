import { cpSync, existsSync } from "node:fs"
import { busToWorkflowIO, createBus, type EventBus } from "./bus.js"
import { appendItemDecision } from "./itemDecisions.js"
import { withPromptPersistence } from "./promptPersistence.js"
import { prepareRun, type WorkflowEvent } from "./runOrchestrator.js"
import { loadResumeReadiness, performResume } from "./resume.js"
import { getRegisteredWorkspace } from "./workspaces.js"
import { layout } from "./workspaceLayout.js"
import type { Repos, ItemRow, RunRow, ExternalRemediationRow } from "../db/repositories.js"
import type { WorkflowIO } from "./io.js"
import type { WorkflowResumeInput } from "../workflow.js"

/**
 * The engine-side run orchestration service. Hosts workflows inside the engine
 * HTTP process so UIs don't have to spawn the CLI. Also consumed by the CLI
 * for local-mode commands.
 *
 * Design invariants:
 *   - Every run has its own bus + io. No shared state across runs.
 *   - `start()` fires the workflow as a background promise and returns the
 *     runId synchronously to the HTTP caller. The workflow continues in the
 *     same Node process; answers from `POST /runs/:id/answer` reach it via
 *     `attachCrossProcessBridge` (which tails `stage_logs`).
 *   - Errors from the background promise are logged, never rethrown, so the
 *     engine process stays up across failing runs.
 */

export type StartRunResult =
  | { ok: true; runId: string; itemId: string }
  | { ok: false; status: 404 | 409 | 422; error: string }

export type ResumeRunResult =
  | { ok: true; runId: string; remediationId: string }
  | { ok: false; status: 404 | 409 | 422; error: string }

function buildApiIo(repos: Repos): WorkflowIO & { bus: EventBus } {
  const bus = createBus()
  const detachPersistence = withPromptPersistence(bus, repos)
  const io = busToWorkflowIO(bus)
  const originalClose = io.close
  return {
    ...io,
    close() {
      detachPersistence()
      originalClose?.()
    },
  }
}

function fireInBackground(io: WorkflowIO & { bus?: EventBus }, label: string, task: () => Promise<void>): void {
  task()
    .catch(err => {
      process.stderr.write(`[runService:${label}] ${(err as Error).message}\n`)
    })
    .finally(() => {
      io.close?.()
    })
}

function workflowFsId(item: Pick<ItemRow, "id" | "title">): string {
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return slug ? `${slug}-${item.id.toLowerCase()}` : item.id.toLowerCase()
}

function hasStageArtifacts(item: Pick<ItemRow, "id" | "title">, runId: string, stageId: string): boolean {
  return existsSync(layout.stageDir({ workspaceId: workflowFsId(item), runId }, stageId))
}

function latestRunWithStageArtifacts(
  repos: Repos,
  item: Pick<ItemRow, "id" | "title">,
  stageId: string,
): RunRow | undefined {
  return repos
    .listRuns()
    .filter(run => run.item_id === item.id)
    .sort((a, b) => b.created_at - a.created_at)
    .find(run => hasStageArtifacts(item, run.id, stageId))
}

function seedStageFromPreviousRun(
  item: Pick<ItemRow, "id" | "title">,
  sourceRunId: string,
  targetRunId: string,
  stageId: string,
): boolean {
  const workspaceId = workflowFsId(item)
  const sourceStageDir = layout.stageDir({ workspaceId, runId: sourceRunId }, stageId)
  if (!existsSync(sourceStageDir)) return false
  cpSync(sourceStageDir, layout.stageDir({ workspaceId, runId: targetRunId }, stageId), {
    recursive: true,
  })
  return true
}

function resolveWorkspaceMeta(
  repos: Repos,
  workspaceKey: string | undefined,
): { workspaceKey?: string; workspaceName?: string } | { error: "unknown_workspace" } {
  if (!workspaceKey) return {}
  const workspace = getRegisteredWorkspace(repos, workspaceKey)
  if (!workspace) return { error: "unknown_workspace" }
  return { workspaceKey: workspace.key, workspaceName: workspace.name }
}

/**
 * `POST /runs` — start a fresh run from a UI-supplied idea. No CLI intake
 * prompts; title + description arrive on the request body.
 */
export function startRunFromIdea(
  repos: Repos,
  input: { title: string; description: string; workspaceKey?: string },
): StartRunResult {
  const meta = resolveWorkspaceMeta(repos, input.workspaceKey)
  if ("error" in meta) return { ok: false, status: 404, error: "unknown_workspace" }

  const io = buildApiIo(repos)
  const prepared = prepareRun(
    { id: "new", title: input.title, description: input.description },
    repos,
    io,
    { owner: "api", ...meta },
  )
  fireInBackground(io, "startRunFromIdea", prepared.start)
  return { ok: true, runId: prepared.runId, itemId: prepared.itemId }
}

/**
 * `POST /items/:id/actions/start_brainstorm` — start a fresh run for an
 * existing item.
 */
export function startRunForItem(
  repos: Repos,
  input: { itemId: string; action: "start_brainstorm" | "start_implementation" | "rerun_design_prep" },
): StartRunResult {
  const item = repos.getItem(input.itemId)
  if (!item) return { ok: false, status: 404, error: "item_not_found" }

  let sourceRun: RunRow | undefined
  let resume: WorkflowResumeInput | undefined
  if (input.action === "start_implementation" || input.action === "rerun_design_prep") {
    sourceRun = latestRunWithStageArtifacts(repos, item, "brainstorm")
    if (!sourceRun) {
      return { ok: false, status: 409, error: "no_brainstorm_artifacts" }
    }
    resume = {
      scope: { type: "run", runId: "pending" },
      currentStage: input.action === "rerun_design_prep" ? "visual-companion" : "projects",
    }
  }

  const io = buildApiIo(repos)
  const prepared = prepareRun(
    { id: item.id, title: item.title, description: item.description },
    repos,
    io,
    { owner: "api", itemId: item.id, resume },
  )

  if ((input.action === "start_implementation" || input.action === "rerun_design_prep") && sourceRun) {
    if (!seedStageFromPreviousRun(item, sourceRun.id, prepared.runId, "brainstorm")) {
      return { ok: false, status: 409, error: "seed_failed" }
    }
    seedStageFromPreviousRun(item, sourceRun.id, prepared.runId, "visual-companion")
    seedStageFromPreviousRun(item, sourceRun.id, prepared.runId, "frontend-design")
  }

  fireInBackground(io, `startRunForItem:${input.action}`, prepared.start)
  return { ok: true, runId: prepared.runId, itemId: item.id }
}

/**
 * `POST /runs/:id/resume` — record a remediation and re-enter the workflow
 * in-process. Previously this route only persisted the remediation row and
 * returned `needsSpawn: true` to the UI.
 */
export async function resumeRunInProcess(
  repos: Repos,
  input: {
    runId: string
    summary: string
    branch?: string
    commit?: string
    reviewNotes?: string
  },
): Promise<ResumeRunResult> {
  const summary = input.summary.trim()
  if (!summary) return { ok: false, status: 422, error: "remediation_required" }

  const readiness = await loadResumeReadiness(repos, input.runId)
  if (readiness.kind === "not_found") return { ok: false, status: 404, error: "run_not_found" }
  if (readiness.kind === "no_recovery") return { ok: false, status: 409, error: "not_resumable" }
  if (readiness.kind === "not_resumable") {
    return { ok: false, status: 409, error: readiness.reason }
  }

  const scope = readiness.record.scope
  const scopeRef =
    scope.type === "stage"
      ? scope.stageId
      : scope.type === "story"
      ? `${scope.waveNumber}/${scope.storyId}`
      : null

  const remediation: ExternalRemediationRow = repos.createExternalRemediation({
    runId: input.runId,
    scope: scope.type,
    scopeRef,
    summary,
    branch: input.branch,
    commitSha: input.commit,
    reviewNotes: input.reviewNotes,
    source: "api",
  })

  // A resume summary is an operator scope decision in plain text — persist
  // it at the workspace level so future runs of the same item respect it,
  // exactly like clarification answers do via recordAnswer.
  const run = repos.getRun(input.runId)
  if (run?.workspace_fs_id) {
    appendItemDecision(run.workspace_fs_id, {
      id: `remediation-${remediation.id}`,
      stage: scope.type === "stage" ? scope.stageId : scope.type === "story" ? `execution/${scope.waveNumber}/${scope.storyId}` : null,
      question: `[resume_run] Operator unblocked the run with explicit scope guidance.`,
      answer: input.reviewNotes ? `${summary}\n\nReview notes:\n${input.reviewNotes}` : summary,
      runId: input.runId,
      answeredAt: new Date().toISOString(),
    })
  }

  const io = buildApiIo(repos)
  fireInBackground(io, "resumeRunInProcess", () =>
    performResume({ repos, io, runId: input.runId, remediation }),
  )
  return { ok: true, runId: input.runId, remediationId: remediation.id }
}

// Re-export the event type for convenience.
export type { WorkflowEvent }
