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
  | string;

export interface Item {
  id: string;
  itemCode: string;
  title: string;
  summary?: string | null;
  phase: Phase;
  pipelineState: PipelineState;
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
