export const BOARD_COLUMNS = [
  "idea",
  "frontend",
  "requirements",
  "implementation",
  "test",
  "merge",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const IMPLEMENTATION_STAGES = ["arch", "plan", "exec", "review"] as const;

export type ImplementationStage = (typeof IMPLEMENTATION_STAGES)[number];

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
}

export const BOARD_COLUMN_LABELS: Record<BoardColumn, string> = {
  idea: "Idea",
  frontend: "Frontend",
  requirements: "Requirements",
  implementation: "Implementation",
  test: "Test",
  merge: "Merge",
};

export type ConversationRole = "system" | "agent" | "user" | "review-gate";

export interface ConversationEntry {
  id?: string;
  type: ConversationRole | string;
  text: string;
  promptId?: string;
  actions?: string[];
}

export interface ItemDetailDTO {
  id: string;
  itemCode?: string;
  title?: string;
  activeRunId?: string | null;
  conversation: ConversationEntry[];
}
