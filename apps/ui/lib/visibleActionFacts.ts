export type VisibleActionId =
  | "import_prepared"
  | "start_visual_companion"
  | "start_frontend_design"
  | "promote_to_requirements"
  | "cancel_promotion"
  | "promote_to_base";

export interface VisibleActionFactsFreshness {
  strategy: "workspace_sse";
  invalidatedBy: string[];
}

export type VisibleActionFallbackSurface = "board" | "item_detail";

type VisibleActionFallbackEvent = {
  itemId: string;
  surface: VisibleActionFallbackSurface;
};

type VisibleActionFallbackTelemetry = {
  board: number;
  item_detail: number;
  events: VisibleActionFallbackEvent[];
};

const telemetry: VisibleActionFallbackTelemetry = {
  board: 0,
  item_detail: 0,
  events: [],
};

export function recordVisibleActionFallback(event: VisibleActionFallbackEvent): void {
  telemetry[event.surface] += 1;
  telemetry.events.push(event);
}

export function readVisibleActionFallbackTelemetry(): VisibleActionFallbackTelemetry {
  return {
    board: telemetry.board,
    item_detail: telemetry.item_detail,
    events: [...telemetry.events],
  };
}

export function resetVisibleActionFallbackTelemetry(): void {
  telemetry.board = 0;
  telemetry.item_detail = 0;
  telemetry.events = [];
}
