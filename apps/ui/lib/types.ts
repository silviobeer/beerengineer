export const PHASES = [
  "Idea",
  "Frontend",
  "Requirements",
  "Implementation",
  "Test",
  "Merge",
] as const;

export type Phase = (typeof PHASES)[number];

// Implementation stepper segments. Mirror of IMPLEMENTATION_STAGES below;
// kept as the legacy alias used by older tests/components. Edit both lists
// in lockstep.
export const STAGE_KEYS = ["arch", "plan", "exec", "review", "qa", "doc"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];
export const STAGE_LABELS: Record<StageKey, string> = {
  arch: "Arch",
  plan: "Plan",
  exec: "Exec",
  review: "Review",
  qa: "QA",
  doc: "Doc",
};

export interface Item {
  id: string;
  itemCode: string;
  title: string;
  summary?: string | null;
  phase: Phase;
  pipelineState: string;
  current_stage?: string | null;
}

export interface BoardData {
  workspaceKey: string;
  items: Item[];
}

export interface SseStateChangeEvent {
  itemId: string;
  pipelineState?: string;
  phase?: Phase;
}

export interface Workspace {
  key: string;
  name: string;
}

export const BOARD_COLUMNS = [
  "idea",
  "brainstorm",
  "frontend",
  "requirements",
  "implementation",
  "merge",
  "done",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const IMPLEMENTATION_STAGES = [
  "arch",
  "plan",
  "exec",
  "review",
  "qa",
  "doc",
] as const;
export type ImplementationStage = (typeof IMPLEMENTATION_STAGES)[number];
export const IMPLEMENTATION_STAGE_LABELS: Record<ImplementationStage, string> = {
  arch: "Arch",
  plan: "Plan",
  exec: "Exec",
  review: "Review",
  qa: "QA",
  doc: "Doc",
};

/**
 * Engine-side stageKey → implementation-stepper segment. The engine drives 8
 * substages inside the implementation phase (requirements → architecture →
 * planning → execution → project-review → qa → documentation → handoff). The
 * stepper covers the first 7; `handoff` is **not** a stepper segment because
 * the board surfaces it as its own column ("Merge"). Once handoff starts the
 * card has left implementation.
 *
 *   requirements / architecture → arch
 *   planning                    → plan
 *   execution                   → exec
 *   project-review              → review
 *   qa                          → qa
 *   documentation               → doc
 *   handoff                     → null (item belongs to the Merge column)
 */
export function mapEngineStageToImplementationSegment(
  stageKey: string | null | undefined,
): ImplementationStage | null {
  switch (stageKey) {
    case "requirements":
    case "architecture":
      return "arch";
    case "planning":
      return "plan";
    case "execution":
      return "exec";
    case "project-review":
      return "review";
    case "qa":
      return "qa";
    case "documentation":
      return "doc";
    default:
      return null;
  }
}

// Engine emits these stageKeys for the design-prep block. The frontend
// column's mini-stepper highlights the segment that matches `current_stage`.
export const DESIGN_PREP_STAGES = ["visual-companion", "frontend-design"] as const;
export type DesignPrepStage = (typeof DESIGN_PREP_STAGES)[number];
export const DESIGN_PREP_STAGE_LABELS: Record<DesignPrepStage, string> = {
  "visual-companion": "Visual",
  "frontend-design": "Design",
};

/**
 * Engine stageKey → design-prep segment. Mirrors
 * `mapEngineStageToImplementationSegment` for the Frontend column. Returns
 * null for `brainstorm` (an earlier column) and for any stage that has
 * already advanced past frontend-design.
 */
export function mapEngineStageToDesignPrepSegment(
  stageKey: string | null | undefined,
): DesignPrepStage | null {
  switch (stageKey) {
    case "visual-companion":
      return "visual-companion";
    case "frontend-design":
      return "frontend-design";
    default:
      return null;
  }
}

export interface BoardCardDTO {
  id: string;
  itemCode?: string;
  title: string;
  column: BoardColumn | string;
  current_stage?: string | null;
  summary?: string | null;
  phase_status?: string | null;
  hasOpenPrompt?: boolean;
  hasReviewGateWaiting?: boolean;
  hasBlockedRun?: boolean;
  previewUrl?: string;
  /** Live override from SSE; when defined, wins over the static flags. */
  liveAttention?: boolean | null;
}

export const BOARD_COLUMN_LABELS: Record<BoardColumn, string> = {
  idea: "Idea",
  brainstorm: "Brainstorm",
  frontend: "Frontend",
  requirements: "Requirements",
  implementation: "Implementation",
  merge: "Merge",
  done: "Done",
};

export interface ConversationAction {
  label: string;
  value: string;
}

export interface ConversationEntry {
  id?: string;
  type: string;
  text: string;
  promptId?: string;
  actions?: Array<string | ConversationAction>;
  /** ISO-8601 timestamp from the engine. Rendered in the chat as HH:MM:SS. */
  createdAt?: string;
}

export interface ItemDetailDTO {
  id: string;
  itemCode?: string;
  title?: string;
  activeRunId?: string | null;
  conversation: ConversationEntry[];
}
