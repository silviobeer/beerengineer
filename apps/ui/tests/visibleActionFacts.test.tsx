import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoardCardActions } from "@/components/BoardCardActions";
import type { BoardCardDTO } from "@/lib/types";
import {
  readVisibleActionFallbackTelemetry,
  resetVisibleActionFallbackTelemetry,
} from "@/lib/visibleActionFacts";

function card(overrides: Partial<BoardCardDTO> = {}): BoardCardDTO {
  return {
    id: "item-1",
    itemCode: "ITEM-1",
    title: "Visible action item",
    column: "brainstorm",
    phase_status: "completed",
    current_stage: null,
    hasOpenPrompt: false,
    hasReviewGateWaiting: false,
    hasBlockedRun: false,
    ...overrides,
  };
}

function visibleActions(): string[] {
  const container = screen.queryByTestId("board-card-actions");
  if (!container) return [];
  return within(container)
    .queryAllByRole("button")
    .map((button) => button.getAttribute("data-testid")?.replace("board-card-action-", ""))
    .filter((action): action is string => Boolean(action));
}

describe("visible action facts", () => {
  afterEach(() => {
    resetVisibleActionFallbackTelemetry();
  });

  it("renders the exact board actions supplied by engine facts and suppresses fallback telemetry", () => {
    render(
      <BoardCardActions
        card={card({ visibleActions: ["import_prepared"] })}
        surface="board"
      />,
    );

    expect(visibleActions()).toEqual(["import_prepared"]);
    expect(screen.queryByRole("button", { name: "Start visual companion" })).toBeNull();
    expect(readVisibleActionFallbackTelemetry()).toEqual({
      board: 0,
      item_detail: 0,
      events: [],
    });
  });

  it("respects an empty visible action fact list without reviving fallback actions", () => {
    render(
      <BoardCardActions
        card={card({ visibleActions: [] })}
        surface="board"
      />,
    );

    expect(screen.queryByTestId("board-card-actions")).toBeNull();
    expect(readVisibleActionFallbackTelemetry()).toEqual({
      board: 0,
      item_detail: 0,
      events: [],
    });
  });

  it("keeps board and item-detail action sets consistent when both consume the same engine facts", () => {
    render(
      <>
        <BoardCardActions
          card={card({
            id: "item-board",
            column: "merge",
            phase_status: "review_required",
            hasReviewGateWaiting: true,
            hasBlockedRun: true,
            visibleActions: ["cancel_promotion", "promote_to_base"],
          })}
          surface="board"
        />
        <BoardCardActions
          card={card({
            id: "item-detail",
            column: "merge",
            phase_status: "review_required",
            hasReviewGateWaiting: true,
            hasBlockedRun: true,
            visibleActions: ["cancel_promotion", "promote_to_base"],
          })}
          surface="item_detail"
        />
      </>,
    );

    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Promote to base" })).toHaveLength(2);
    expect(readVisibleActionFallbackTelemetry()).toEqual({
      board: 0,
      item_detail: 0,
      events: [],
    });
  });

  it("uses the compatibility fallback only when facts are omitted and records board telemetry", () => {
    render(<BoardCardActions card={card()} surface="board" />);

    expect(visibleActions()).toEqual(["start_visual_companion", "import_prepared"]);
    expect(readVisibleActionFallbackTelemetry()).toEqual({
      board: 1,
      item_detail: 0,
      events: [{ itemId: "item-1", surface: "board" }],
    });
  });

  it("keeps fallback consumer-scoped when only item detail lacks facts", () => {
    render(
      <>
        <BoardCardActions
          card={card({ id: "shared-item", visibleActions: ["import_prepared"] })}
          surface="board"
        />
        <BoardCardActions
          card={card({ id: "shared-item" })}
          surface="item_detail"
        />
      </>,
    );

    expect(screen.getAllByRole("button", { name: "Import prepared" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Start visual companion" })).not.toBeNull();
    expect(readVisibleActionFallbackTelemetry()).toEqual({
      board: 0,
      item_detail: 1,
      events: [{ itemId: "shared-item", surface: "item_detail" }],
    });
  });
});
