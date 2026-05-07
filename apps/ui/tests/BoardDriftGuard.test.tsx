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

type DriftGuardResult = {
  stateId: string;
  matrixKey: string;
  visibleActions: string[];
  engineAllowedActions: string[];
  unexpectedVisibleActions: string[];
  hiddenEngineAllowedActions: string[];
};

function analyzeDrift({
  stateId,
  matrixKey,
  visibleActions,
}: {
  stateId: string;
  matrixKey: string;
  visibleActions: string[];
}): DriftGuardResult {
  const engineAllowedActions = fixtureActionsFor(matrixKey);
  return {
    stateId,
    matrixKey,
    visibleActions,
    engineAllowedActions,
    unexpectedVisibleActions: visibleActions.filter((action) => !engineAllowedActions.includes(action)),
    hiddenEngineAllowedActions: engineAllowedActions.filter((action) => !visibleActions.includes(action)),
  };
}

function analyzeRenderedState(stateId: string): DriftGuardResult {
  const state = representativeBoardActionStates.find((entry) => entry.id === stateId);
  expect(state).toBeDefined();

  const { unmount } = renderActions(state!.card);
  const result = analyzeDrift({
    stateId: state!.id,
    matrixKey: state!.matrixKey,
    visibleActions: visibleActions(),
  });
  unmount();
  return result;
}

function expectNoUnsafeVisibleActions(result: DriftGuardResult) {
  expect(
    result.unexpectedVisibleActions,
    `Unsafe visible actions for ${result.stateId} (${result.matrixKey}): ${
      result.unexpectedVisibleActions.join(", ") || "none"
    }. Hidden engine-allowed actions are tolerated: ${
      result.hiddenEngineAllowedActions.join(", ") || "none"
    }.`,
  ).toEqual([]);
}

describe("BoardDriftGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("checks rendered visible actions as a subset of the committed engine allowlist", () => {
    for (const stateId of [
      "blocked_merge_review_required",
      "recoverable_implementation_failed",
      "running_implementation_running",
      "terminal_done_completed",
    ] as const) {
      const result = analyzeRenderedState(stateId);
      expect(result.engineAllowedActions.length).toBeGreaterThan(0);
      expectNoUnsafeVisibleActions(result);
    }
  });

  it("tolerates representative states where the UI intentionally hides engine-allowed actions", () => {
    const strictSubsetStates = representativeBoardActionStates
      .map((state) => analyzeRenderedState(state.id))
      .filter((result) => result.hiddenEngineAllowedActions.length > 0);

    expect(
      strictSubsetStates.length,
      "No strict-subset representative state exists. If the current UI shows every engine-allowed action, document that explicitly before removing AC-22 coverage.",
    ).toBeGreaterThan(0);

    const blockedMergeState = strictSubsetStates.find((result) => result.stateId === "blocked_merge_review_required");
    expect(blockedMergeState).toBeDefined();
    expect(blockedMergeState!.visibleActions).toEqual(
      expect.arrayContaining(["cancel_promotion", "promote_to_base"]),
    );
    expect(blockedMergeState!.hiddenEngineAllowedActions).toContain("resume_run");
    expectNoUnsafeVisibleActions(blockedMergeState!);
  });

  it("fails only for unsafe visible actions and reports the affected state", () => {
    const baseline = analyzeRenderedState("blocked_merge_review_required");
    const unsafeResult = analyzeDrift({
      stateId: baseline.stateId,
      matrixKey: baseline.matrixKey,
      visibleActions: [...baseline.visibleActions, "unsafe_extra_action"],
    });

    expect(unsafeResult.hiddenEngineAllowedActions).toContain("resume_run");
    expect(() => expectNoUnsafeVisibleActions(unsafeResult)).toThrowError(
      /Unsafe visible actions for blocked_merge_review_required \(merge\/review_required\): unsafe_extra_action/,
    );
  });

  it("treats empty visible action sets as a valid subset of the engine allowlist", () => {
    const result = analyzeRenderedState("terminal_done_completed");

    expect(result.visibleActions).toEqual([]);
    expect(result.hiddenEngineAllowedActions).toContain("rerun_design_prep");
    expectNoUnsafeVisibleActions(result);
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
