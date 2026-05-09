import type { RunRow } from "../db/repositories.js"
import type { SupabaseReadinessSetupAction } from "../core/supabase/types.js"

export const orderedBoardColumns = ["idea", "brainstorm", "frontend", "requirements", "implementation", "merge", "done"] as const

export type BoardColumnKey = (typeof orderedBoardColumns)[number]

export type BoardCardDTO = {
  itemCode: string
  itemId: string
  title: string
  summary: string
  column: BoardColumnKey
  phaseStatus: string
  /** Engine stageKey of the authoritative run, null when no live stage. */
  currentStage: string | null
  hasOpenPrompt?: boolean
  hasReviewGateWaiting?: boolean
  hasBlockedRun?: boolean
  supabaseBlocker?: {
    status: "blocked" | "ready" | "checking"
    label: "Supabase blocked"
    runId: string
    workspace: { id?: string; key?: string }
    missingSetupActions: SupabaseReadinessSetupAction[]
    message?: string
    retry: { available: boolean; ready: boolean }
  }
  recovery_user_message?: string | null
  previewUrl?: string
  latestRunId?: string
  workspaceId?: string
  workspaceRoot?: string | null
  supabaseProjectRef?: string | null
  dbRelevance?: { value: boolean; source: "detector"; reason: string }
  supabaseBranch?: { ref: string; name: string; lifecycleState: string | null }
  meta: Array<{ label: string; value: string }>
}

export type BoardColumnDTO = {
  key: BoardColumnKey
  title: string
  cards: BoardCardDTO[]
}

export type BoardDTO = {
  workspaceKey: string | null
  columns: BoardColumnDTO[]
  costRisk: {
    retainedBranchCount: number
    planLimitRatio: number
  }
}

export type BoardWorkspace = {
  id: string
  key: string
  root_path: string | null
  supabase_project_ref: string | null
}

export type BoardItemRow = {
  id: string
  workspace_id: string
  code: string
  title: string
  description: string
  current_column: BoardColumnKey
  phase_status: string
  current_stage: string | null
}

export type BoardLatestRun = {
  id: string
  item_id: string
  status: string
  recovery_status: RunRow["recovery_status"]
  recovery_summary: string | null
  recovery_scope_ref: string | null
  recovery_payload_json: string | null
  workspace_fs_id: string | null
  supabase_branch_ref: string | null
  supabase_branch_name: string | null
  supabase_branch_lifecycle_state: string | null
}

export type BoardOpenPrompt = {
  actions_json: string | null
}

export type BoardCardProjectionInput = {
  workspace: BoardWorkspace
  item: BoardItemRow
  latestRun?: BoardLatestRun
  openPrompt?: BoardOpenPrompt
  projectCount: number
}

export type BoardProjector = (input: BoardCardProjectionInput) => Partial<BoardCardDTO>

export type BoardProjectionProjectors = {
  placementProjector: BoardProjector
  promptProjector: BoardProjector
  recoveryProjector: BoardProjector
  supabaseProjector: BoardProjector
  mergeStateProjector: BoardProjector
}

export type BoardProjectionCoordinator = {
  projectCard(input: BoardCardProjectionInput): BoardCardDTO
}
