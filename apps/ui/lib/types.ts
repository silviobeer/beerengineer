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
}
