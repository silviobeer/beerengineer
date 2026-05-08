import { describe, it, expect } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { Board } from "@/components/Board";
import { fullBoardItems, implementationCardWithStage } from "@/lib/fixtures";
import { MockEventSource, makeMockEventSourceFactory } from "@/lib/sse/mockEventSource";
import { SSEConnectionManager } from "@/lib/sse/SSEContext";
import type { ItemState } from "@/lib/sse/types";
import { SSETestProvider, noopSSEContext } from "./sseTestHarness";

/**
 * The active Board derives its live state from `useSSE().itemState` —
 * not from a self-owned EventSource. These tests exercise the overlay
 * by populating the SSEContext directly and asserting the Board picks
 * up the values. End-to-end SSE wiring (workspace stream, run-scoped
 * stream, reconnect) is verified manually against the running engine.
 */

function getCard(itemId: string): HTMLElement {
  const card = document.querySelector(`[data-card-id="${itemId}"]`);
  if (!card) throw new Error(`card not found: ${itemId}`);
  return card as HTMLElement;
}

function buildContext(itemState: Record<string, ItemState>) {
  return { ...noopSSEContext, itemState };
}

describe("SSE live overlay (Board reads itemState from SSEContext)", () => {
  it("overlays a column change so the card moves to the new column", () => {
    const items = fullBoardItems();
    const ideaCard = items.find((i) => i.column === "idea")!;
    render(
      <SSETestProvider
        value={buildContext({
          [ideaCard.id]: { column: "implementation" },
        })}
      >
        <Board items={items} />
      </SSETestProvider>,
    );
    const implColumn = screen
      .getAllByTestId("kanban-column")
      .find((col) => col.dataset.column === "implementation")!;
    expect(within(implColumn).getByText(ideaCard.title)).toBeInTheDocument();
  });

  it("overlays attention=true on a card without intrinsic flags", () => {
    const items = fullBoardItems();
    const card = items[0];
    render(
      <SSETestProvider
        value={buildContext({ [card.id]: { attention: true } })}
      >
        <Board items={items} />
      </SSETestProvider>,
    );
    expect(
      within(getCard(card.id)).queryByTestId("attention-dot"),
    ).toBeInTheDocument();
  });

  it("overlays attention=false to clear a stale attention dot", () => {
    const items = [
      {
        ...fullBoardItems()[0],
        hasOpenPrompt: true,
      },
    ];
    render(
      <SSETestProvider
        value={buildContext({ [items[0].id]: { attention: false } })}
      >
        <Board items={items} />
      </SSETestProvider>,
    );
    expect(
      within(getCard(items[0].id)).queryByTestId("attention-dot"),
    ).not.toBeInTheDocument();
  });

  it("overlays currentStage so the implementation stepper highlights the new stage", () => {
    const items = [implementationCardWithStage("arch")];
    render(
      <SSETestProvider
        value={buildContext({
          [items[0].id]: { currentStage: "exec" },
        })}
      >
        <Board items={items} />
      </SSETestProvider>,
    );
    const exec = screen.getByTestId("mini-stepper-segment-exec");
    expect(exec.dataset.active).toBe("true");
  });

  it("overlays prompt, blocker, recovery, and latest-run fields used by cards", () => {
    const items = [
      {
        ...implementationCardWithStage("exec"),
        hasOpenPrompt: false,
        hasReviewGateWaiting: false,
        hasBlockedRun: false,
        phase_status: "running",
        recovery_user_message: null,
      },
    ];
    render(
      <SSETestProvider
        value={buildContext({
          [items[0].id]: {
            attention: true,
            hasOpenPrompt: true,
            hasReviewGateWaiting: true,
            hasBlockedRun: true,
            phaseStatus: "failed",
            recoveryUserMessage: "Worker lost. Resume this run to continue.",
            latestRunId: "run-live",
          },
        })}
      >
        <Board items={items} />
      </SSETestProvider>,
    );

    const card = getCard(items[0].id);
    expect(within(card).getByTestId("attention-dot")).toBeInTheDocument();
    expect(within(card).getByTestId("board-card-status-chip")).toHaveTextContent("failed");
    expect(within(card).getByTestId("board-card-recovery-message")).toHaveTextContent(
      "Worker lost. Resume this run to continue.",
    );
  });

  it("updates a card from workspace SSE lifecycle events without a refresh", () => {
    const items = [implementationCardWithStage("exec")];
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager workspaceKey="beerengineer" eventSourceFactory={factory}>
        <Board items={items} workspaceKey="beerengineer" />
      </SSEConnectionManager>,
    );

    const source = MockEventSource.instances[0];
    act(() => {
      source.simulateEvent("phase_started", {
        id: "log-1",
        runId: "run-1",
        itemId: items[0].id,
        type: "phase_started",
        payload: { stageKey: "qa" },
      });
    });
    expect(screen.getByTestId("mini-stepper-segment-qa").dataset.active).toBe("true");

    act(() => {
      source.simulateEvent("run_blocked", {
        id: "log-2",
        runId: "run-1",
        itemId: items[0].id,
        type: "run_blocked",
        payload: {
          itemId: items[0].id,
          summary: "QA blocked waiting for operator input",
        },
      });
    });

    const card = getCard(items[0].id);
    expect(within(card).getByTestId("board-card-status-chip")).toHaveTextContent("failed");
    expect(within(card).getByTestId("attention-dot")).toBeInTheDocument();
  });

  it("ignores itemState entries for unknown card ids without throwing", () => {
    const items = fullBoardItems();
    expect(() =>
      render(
        <SSETestProvider
          value={buildContext({ "ghost-id": { attention: true } })}
        >
          <Board items={items} />
        </SSETestProvider>,
      ),
    ).not.toThrow();
    // Original cards still render.
    for (const item of items) {
      expect(getCard(item.id)).toBeInTheDocument();
    }
  });

  it("does not show speculative state when itemState is empty", () => {
    const items = fullBoardItems();
    render(
      <SSETestProvider value={buildContext({})}>
        <Board items={items} />
      </SSETestProvider>,
    );
    // Each card lands in its declared column; nothing has been moved.
    for (const item of items) {
      const col = screen
        .getAllByTestId("kanban-column")
        .find((c) => c.dataset.column === item.column)!;
      expect(within(col).getByText(item.title)).toBeInTheDocument();
    }
  });
});
