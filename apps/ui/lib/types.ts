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
