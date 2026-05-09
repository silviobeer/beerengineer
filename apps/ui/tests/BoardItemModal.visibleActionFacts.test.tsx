import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardItemModal } from "@/components/BoardItemModal";
import type { BoardCardDTO } from "@/lib/types";
import {
  readVisibleActionFallbackTelemetry,
  resetVisibleActionFallbackTelemetry,
} from "@/lib/visibleActionFacts";

vi.mock("@/components/ItemChat", () => ({
  ItemChat: () => <div data-testid="item-chat" />,
}));

vi.mock("@/components/ItemMessages", () => ({
  ItemMessages: () => <div data-testid="item-messages" />,
}));

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
    visibleActions: ["import_prepared"],
    ...overrides,
  };
}

describe("BoardItemModal visible action facts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetVisibleActionFallbackTelemetry();
  });

  it("prefers item-detail visible actions from the item read over the board card facts", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/items/item-1") {
        return new Response(JSON.stringify({
          itemId: "item-1",
          itemCode: "ITEM-1",
          title: "Visible action item",
          phase_status: "completed",
          current_stage: null,
          currentRunId: null,
          allowedActions: ["start_visual_companion", "import_prepared"],
          visibleActions: ["start_visual_companion"],
          visibleActionsFreshness: {
            strategy: "workspace_sse",
            invalidatedBy: ["item_column_changed"],
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    }) as typeof fetch);

    render(
      <BoardItemModal
        card={card()}
        workspaceKey="demo"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start visual companion" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Import prepared" })).toBeNull();
    expect(readVisibleActionFallbackTelemetry()).toEqual({
      board: 0,
      item_detail: 0,
      events: [],
    });
  });
});
