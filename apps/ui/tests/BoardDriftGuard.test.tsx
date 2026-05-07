import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardCardActions } from "@/components/BoardCardActions";
import type { BoardCardDTO } from "@/lib/types";
import allowedActionsByState from "./fixtures/item-actions-allowed.json";
import { representativeBoardActionStates } from "./fixtures/boardActionRepresentativeStates";

function renderActions(card: BoardCardDTO) {
  return render(<BoardCardActions card={card} />);
}

function visibleActions(): string[] {
  const container = screen.queryByTestId("board-card-actions");
  if (!container) return [];
  return within(container)
    .queryAllByRole("button")
    .map((button) => button.getAttribute("data-testid")?.replace("board-card-action-", ""))
    .filter((action): action is string => Boolean(action));
}

function fixtureActionsFor(matrixKey: string): string[] {
  return (allowedActionsByState as Record<string, string[]>)[matrixKey] ?? [];
}

describe("BoardDriftGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("covers representative blocked states with fixture-backed expectations", () => {
    const state = representativeBoardActionStates.find((entry) => entry.id === "blocked_merge_review_required");
    expect(state).toBeDefined();
    expect(fixtureActionsFor(state!.matrixKey).length).toBeGreaterThan(0);

    renderActions(state!.card);

    const actions = visibleActions();
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => fixtureActionsFor(state!.matrixKey).includes(action))).toBe(true);
  });

  it("covers representative failed or recoverable states without unsafe recovery actions", () => {
    const state = representativeBoardActionStates.find((entry) => entry.id === "recoverable_implementation_failed");
    expect(state).toBeDefined();
    expect(fixtureActionsFor(state!.matrixKey).length).toBeGreaterThan(0);

    renderActions(state!.card);

    const actions = visibleActions();
    expect(actions.every((action) => fixtureActionsFor(state!.matrixKey).includes(action))).toBe(true);
  });

  it("covers representative running states without stale completion or recovery actions", () => {
    const state = representativeBoardActionStates.find((entry) => entry.id === "running_implementation_running");
    expect(state).toBeDefined();
    expect(fixtureActionsFor(state!.matrixKey).length).toBeGreaterThan(0);

    renderActions(state!.card);

    const actions = visibleActions();
    expect(actions.every((action) => fixtureActionsFor(state!.matrixKey).includes(action))).toBe(true);
  });

  it("covers representative terminal states without further unsafe actions", () => {
    const state = representativeBoardActionStates.find((entry) => entry.id === "terminal_done_completed");
    expect(state).toBeDefined();
    expect(fixtureActionsFor(state!.matrixKey).length).toBeGreaterThan(0);

    renderActions(state!.card);

    const actions = visibleActions();
    expect(actions.every((action) => fixtureActionsFor(state!.matrixKey).includes(action))).toBe(true);
  });
});

describe("BoardCardActions rejection messaging", () => {
  const actionCard = representativeBoardActionStates.find((entry) => entry.id === "blocked_merge_review_required")!.card;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("shows the engine-provided redacted message before fallback copy", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        {
          message: "Promotion is blocked until production migration safety checks pass.",
          error: "invalid_transition",
          details: "internal stack should stay hidden",
        },
        { status: 409 },
      )) as unknown as typeof fetch;

    renderActions(actionCard);
    fireEvent.click(screen.getByRole("button", { name: "Promote to base" }));

    await waitFor(() =>
      expect(screen.getByTestId("board-card-action-error")).toHaveTextContent(
        "Promotion is blocked until production migration safety checks pass.",
      ),
    );
    expect(screen.getByTestId("board-card-action-error")).not.toHaveTextContent("invalid_transition");
    expect(screen.getByTestId("board-card-action-error")).not.toHaveTextContent("internal stack should stay hidden");
  });

  it("falls back to generic copy when no user-facing message is present", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        {
          error: "invalid_transition",
          details: "raw engine detail",
        },
        { status: 409 },
      )) as unknown as typeof fetch;

    renderActions(actionCard);
    fireEvent.click(screen.getByRole("button", { name: "Promote to base" }));

    await waitFor(() =>
      expect(screen.getByTestId("board-card-action-error")).toHaveTextContent(
        "Action could not be completed.",
      ),
    );
    expect(screen.getByTestId("board-card-action-error")).not.toHaveTextContent("invalid_transition");
    expect(screen.getByTestId("board-card-action-error")).not.toHaveTextContent("raw engine detail");
  });
});
