import type { ActionResult, ItemDetailDTO } from "../app/_engine/types";

export const FX_01: ItemDetailDTO = {
  itemId: "item-007",
  itemCode: "BEER-007",
  title: "Auth overhaul",
  phase_status: "implementation",
  current_stage: "exec",
  currentRunId: "run-abc",
  allowedActions: [
    "start_brainstorm",
    "start_implementation",
    "rerun_design_prep",
    "promote_to_requirements",
    "mark_done",
  ],
};

export const FX_02: ItemDetailDTO = {
  itemId: "item-013",
  itemCode: "BEER-013",
  title: "Idle item",
  phase_status: "idea",
  current_stage: null,
  currentRunId: null,
  allowedActions: [],
};

export const FX_03: ItemDetailDTO = {
  ...FX_01,
  itemId: "item-009",
  itemCode: "BEER-009",
  allowedActions: ["start_brainstorm", "mark_done"],
};

export const FX_09: ItemDetailDTO = {
  itemId: "item-021",
  itemCode: "BEER-021",
  title: "Idle with action",
  phase_status: "idea",
  current_stage: null,
  currentRunId: null,
  allowedActions: ["start_brainstorm"],
};

export const success: ActionResult = { ok: true, status: 200 };
export const conflict409: ActionResult = {
  ok: false,
  status: 409,
  error: "invalid_transition",
};
export const unprocessable422: ActionResult = {
  ok: false,
  status: 422,
  error: "invalid_state",
};

export function neverResolves(): Promise<ActionResult> {
  return new Promise<ActionResult>(() => {
    // intentionally never resolves
  });
}
