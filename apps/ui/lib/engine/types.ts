export const ITEM_ACTIONS = [
  "start_brainstorm",
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
};

export type ActionResult =
  | { ok: true; status: number }
  | { ok: false; status: number; error: string };

export type ItemActionPayload = {
  path?: string;
};
