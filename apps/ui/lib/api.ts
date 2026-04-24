export const ENGINE_BASE_URL = process.env.NEXT_PUBLIC_ENGINE_BASE_URL ?? "http://127.0.0.1:4100"

async function readJsonResponse<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

export type RunRow = {
  id: string
  workspace_id: string
  item_id: string
  title: string
  status: string
  current_stage: string | null
  recovery_status?: "blocked" | "failed" | null
  recovery_scope?: "run" | "stage" | "story" | null
  recovery_scope_ref?: string | null
  recovery_summary?: string | null
  created_at: number
  updated_at: number
}

export type RecoveryRemediation = {
  id: string
  run_id: string
  scope: "run" | "stage" | "story"
  scope_ref: string | null
  summary: string
  branch: string | null
  commit_sha: string | null
  review_notes: string | null
  source: "cli" | "ui" | "api"
  created_at: number
}

export type RecoveryDetail = {
  status: "blocked" | "failed"
  scope: "run" | "stage" | "story" | null
  scopeRef: string | null
  summary: string | null
  resumable: boolean
  remediations: RecoveryRemediation[]
}

export type StageRunRow = {
  id: string
  run_id: string
  stage_key: string
  status: string
  started_at: number | null
  completed_at: number | null
  error_message: string | null
}

export type NotificationDeliveryRow = {
  dedup_key: string
  channel: string
  chat_id: string
  status: string
  attempt_count: number
  last_attempt_at: number | null
  delivered_at: number | null
  error_message: string | null
  created_at: number
  updated_at: number
}

export async function listRuns(): Promise<RunRow[]> {
  const res = await fetch(`${ENGINE_BASE_URL}/runs`, { cache: "no-store" })
  if (!res.ok) return []
  const body = (await res.json()) as { runs: RunRow[] }
  return body.runs
}

export async function startRun(input: {
  title: string
  description: string
  workspaceKey?: string
}): Promise<{ runId: string } | { error: string }> {
  const res = await fetch(`/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  })
  return readJsonResponse<{ runId: string } | { error: string }>(res)
}

export async function answerPrompt(runId: string, promptId: string, answer: string): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ promptId, answer })
  })
  if (res.ok) return
  const body = await res.json().catch(() => ({}))
  const message =
    typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `http_${res.status}`
  throw new Error(message)
}

export type ConversationEntry = {
  id: string
  runId: string
  stageKey: string | null
  kind: "system" | "message" | "question" | "answer"
  actor: "system" | "agent" | "user"
  text: string
  createdAt: string
  promptId?: string
  answerTo?: string
}

export type OpenPrompt = {
  promptId: string
  runId: string
  stageKey: string | null
  text: string
  createdAt: string
}

export type ConversationResponse = {
  runId: string
  updatedAt: string
  entries: ConversationEntry[]
  openPrompt: OpenPrompt | null
}

export async function getConversation(runId: string): Promise<ConversationResponse | null> {
  const res = await fetch(`/api/runs/${runId}/conversation`, { cache: "no-store" })
  if (!res.ok) return null
  return (await res.json()) as ConversationResponse
}

export async function getRunRecovery(runId: string): Promise<RecoveryDetail | null> {
  const res = await fetch(`/api/runs/${runId}/recovery`, { cache: "no-store" })
  if (!res.ok) return null
  const body = (await res.json()) as { recovery: RecoveryDetail | null }
  return body.recovery
}

export async function resumeRun(
  runId: string,
  payload: { summary: string; branch?: string; commit?: string; reviewNotes?: string }
): Promise<{ ok: true; runId: string; status: string } | { ok: false; status: number; error: string }> {
  const res = await fetch(`/api/runs/${runId}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  })
  const body = await res.json().catch(() => ({}))
  if (res.ok) return { ok: true, runId: (body as { runId: string }).runId, status: (body as { status: string }).status }
  return { ok: false, status: res.status, error: (body as { error?: string }).error ?? `http_${res.status}` }
}

export async function getRun(runId: string): Promise<RunRow | null> {
  const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" })
  if (!res.ok) return null
  return (await res.json()) as RunRow
}

export async function getRunTree(runId: string): Promise<{ run: RunRow; stageRuns: StageRunRow[] } | null> {
  const res = await fetch(`/api/runs/${runId}/tree`, { cache: "no-store" })
  if (!res.ok) return null
  return (await res.json()) as { run: RunRow; stageRuns: StageRunRow[] }
}

export type ItemAction =
  | "start_brainstorm"
  | "promote_to_requirements"
  | "start_implementation"
  | "mark_done"

export type ItemActionResponse =
  | { ok: true; itemId: string; runId?: string; column: string; phaseStatus: string }
  | { ok: false; status: number; error: string; current?: { column: string; phaseStatus: string }; action?: string }

export type SetupStatusValue = "ok" | "missing" | "misconfigured" | "skipped" | "unknown" | "uninitialized"

export type SetupRemedy = {
  hint: string
  command?: string
  url?: string
}

export type SetupCheckResult = {
  id: string
  label: string
  status: SetupStatusValue
  version?: string
  detail?: string
  remedy?: SetupRemedy
}

export type SetupGroupResult = {
  id: string
  label: string
  level: "required" | "recommended" | "optional"
  minOk: number
  idealOk?: number
  passed: number
  satisfied: boolean
  ideal: boolean
  checks: SetupCheckResult[]
}

export type SetupReport = {
  reportVersion: 1
  overall: "ok" | "warning" | "blocked"
  groups: SetupGroupResult[]
  generatedAt: number
}

export async function getSetupStatus(group?: string): Promise<SetupReport | null> {
  const qs = group ? `?group=${encodeURIComponent(group)}` : ""
  const res = await fetch(`${ENGINE_BASE_URL}/setup/status${qs}`, { cache: "no-store" })
  if (!res.ok) return null
  return (await res.json()) as SetupReport
}

export function findSetupGroup(report: SetupReport | null, groupId: string): SetupGroupResult | null {
  return report?.groups.find(group => group.id === groupId) ?? null
}

export async function getNotificationDeliveries(opts: {
  channel?: string
  limit?: number
} = {}): Promise<NotificationDeliveryRow[]> {
  const qs = new URLSearchParams()
  if (opts.channel) qs.set("channel", opts.channel)
  if (opts.limit !== undefined) qs.set("limit", String(opts.limit))
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  const res = await fetch(`${ENGINE_BASE_URL}/notifications/deliveries${suffix}`, { cache: "no-store" })
  if (!res.ok) return []
  const body = (await res.json()) as { deliveries: NotificationDeliveryRow[] }
  return body.deliveries ?? []
}

export async function performItemAction(itemId: string, action: ItemAction): Promise<ItemActionResponse> {
  const res = await fetch(`/api/items/${itemId}/actions/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  })
  const body = await res.json().catch(() => ({}))
  if (res.ok) {
    return { ok: true, ...(body as { itemId: string; runId?: string; column: string; phaseStatus: string }) }
  }
  return {
    ok: false,
    status: res.status,
    error: (body as { error?: string }).error ?? `http_${res.status}`,
    current: (body as { current?: { column: string; phaseStatus: string } }).current,
    action: (body as { action?: string }).action
  }
}

export type WorkspacePreview = {
  schemaVersion: number
  path: string
  exists: boolean
  isDirectory: boolean
  isWritable: boolean
  isGitRepo: boolean
  hasRemote: boolean
  defaultBranch: string | null
  detectedStack: string | null
  existingFiles: string[]
  isRegistered: boolean
  isInsideAllowedRoot: boolean
  isGreenfield: boolean
  hasWorkspaceConfigFile: boolean
  hasSonarProperties: boolean
  conflicts: string[]
}

export type WorkspaceRegistrationResponse =
  | {
      ok: true
      workspace: {
        key: string
        name: string
        rootPath: string
      }
      warnings: string[]
      actions: string[]
    }
  | {
      ok: false
      error: string
      detail: string
    }

export async function previewWorkspace(path: string): Promise<WorkspacePreview | { error: string }> {
  const qs = new URLSearchParams({ path }).toString()
  const res = await fetch(`/api/workspaces/preview?${qs}`, { cache: "no-store" })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { error: (body as { error?: string }).error ?? `http_${res.status}` }
  }
  return readJsonResponse<WorkspacePreview>(res)
}

export async function createWorkspace(input: {
  path: string
  key?: string
  name?: string
}): Promise<WorkspaceRegistrationResponse> {
  const res = await fetch(`/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  })
  return readJsonResponse<WorkspaceRegistrationResponse>(res)
}
