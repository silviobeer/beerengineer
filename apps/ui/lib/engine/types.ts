import type { WorkspaceGitReadiness } from "@/lib/setup/types";
import type { RunEntryFact, RunEntryFactFreshness } from "@/lib/runEntryFacts";
import type { VisibleActionFactsFreshness, VisibleActionId } from "@/lib/visibleActionFacts";

export const ITEM_ACTIONS = [
  "start_brainstorm",
  "start_visual_companion",
  "start_frontend_design",
  "start_implementation",
  "import_prepared",
  "rerun_design_prep",
  "promote_to_requirements",
  "mark_done",
] as const;

export type ItemAction = (typeof ITEM_ACTIONS)[number];

export type ItemDetailDTO = {
  itemId: string;
  itemCode: string;
  title: string;
  phase_status: string;
  current_stage: string | null;
  currentRunId: string | null;
  allowedActions: string[];
  visibleActions?: VisibleActionId[];
  visibleActionsFreshness?: VisibleActionFactsFreshness;
  chatEntry?: RunEntryFact;
  chatEntryFreshness?: RunEntryFactFreshness;
  messagesEntry?: RunEntryFact;
  messagesEntryFreshness?: RunEntryFactFreshness;
};

export type ActionResult =
  | { ok: true; status: number }
  | WorkflowGitBlockedActionResult
  | { ok: false; status: number; error: string };

export type WorkflowGitBlockedActionResult = {
  ok: false;
  status: number;
  error:
    | "git_not_installed"
    | "git_identity_missing"
    | "workspace_not_found"
    | "workspace_not_git_repo"
    | "workspace_path_unavailable";
  code: "workflow_git_blocked";
  message: string;
  readiness?: WorkspaceGitReadiness;
  repair?: {
    action: "repair_workspace_identity";
    workspaceId: string;
    workspaceKey?: string;
    appDefaultIdentityAvailable: boolean;
  };
  intent: {
    itemId: string;
    action: ItemAction;
  };
};

export type ItemActionPayload = {
  path?: string;
};

export function isWorkflowGitBlockedActionResult(
  result: ActionResult,
): result is WorkflowGitBlockedActionResult {
  return !result.ok && "code" in result && result.code === "workflow_git_blocked";
}
