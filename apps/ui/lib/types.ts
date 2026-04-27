export const PHASES = [
  "Idea",
  "Frontend",
  "Requirements",
  "Implementation",
  "Test",
  "Merge",
] as const;

export type Phase = (typeof PHASES)[number];

export type PipelineState =
  | "idle"
  | "running"
  | "openPrompt"
  | "review-gate-waiting"
  | "run-blocked"
  | "failed"
  | string;

export const STAGE_KEYS = ["arch", "plan", "exec", "review"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];
export const STAGE_LABELS: Record<StageKey, string> = {
  arch: "Arch",
  plan: "Plan",
  exec: "Exec",
  review: "Review",
};

export interface Item {
  id: string;
  itemCode: string;
  title: string;
  summary?: string | null;
  phase: Phase;
  pipelineState: PipelineState;
  current_stage?: string | null;
}

export interface BoardData {
  workspaceKey: string;
  items: Item[];
}

export interface SseStateChangeEvent {
  itemId: string;
  pipelineState?: PipelineState;
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
  "done",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const IMPLEMENTATION_STAGES = ["arch", "plan", "exec", "review"] as const;
export type ImplementationStage = (typeof IMPLEMENTATION_STAGES)[number];
export const IMPLEMENTATION_STAGE_LABELS: Record<ImplementationStage, string> = {
  arch: "Arch",
  plan: "Plan",
  exec: "Exec",
  review: "Review",
};

// Engine emits these stageKeys for the design-prep block. The frontend
// column's mini-stepper highlights the segment that matches `current_stage`.
export const DESIGN_PREP_STAGES = ["visual-companion", "frontend-design"] as const;
export type DesignPrepStage = (typeof DESIGN_PREP_STAGES)[number];
export const DESIGN_PREP_STAGE_LABELS: Record<DesignPrepStage, string> = {
  "visual-companion": "Visual",
  "frontend-design": "Design",
};

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
  /** Live override from SSE; when defined, wins over the static flags. */
  liveAttention?: boolean | null;
}

export const BOARD_COLUMN_LABELS: Record<BoardColumn, string> = {
  idea: "Idea",
  brainstorm: "Brainstorm",
  frontend: "Frontend",
  requirements: "Requirements",
  implementation: "Implementation",
  done: "Done",
};

export type ConversationRole = "system" | "agent" | "user" | "review-gate";

export interface ConversationAction {
  label: string;
  value: string;
}

export interface ConversationEntry {
  id?: string;
  type: ConversationRole | string;
  text: string;
  promptId?: string;
  actions?: Array<string | ConversationAction>;
}

export interface ItemDetailDTO {
  id: string;
  itemCode?: string;
  title?: string;
  activeRunId?: string | null;
  conversation: ConversationEntry[];
}
