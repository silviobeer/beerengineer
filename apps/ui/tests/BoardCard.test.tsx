import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BoardCard } from "@/components/BoardCard";
import {
  implementationCard,
  implementationCardMissingStage,
  nonImplementationCard,
} from "@/lib/fixtures";
import type { BoardColumn } from "@/lib/types";

const SEGMENT_LABELS = ["Arch", "Plan", "Exec", "Review"] as const;

function findSegmentByLabel(card: HTMLElement, label: string): HTMLElement {
  const matches = within(card).getAllByText(label, { exact: true });
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
}

function isActive(el: HTMLElement | null): boolean {
  if (!el) return false;
  let cursor: HTMLElement | null = el;
  while (cursor) {
    if (
      cursor.getAttribute("data-active") === "true" ||
      cursor.getAttribute("aria-current") === "step"
    ) {
      return true;
    }
    cursor = cursor.parentElement;
  }
  return false;
}

describe("BoardCard stepper visibility (US-02)", () => {
  it("TC-08: Implementation column card renders the four segment labels in order", () => {
    render(<BoardCard card={implementationCard("exec")} />);
    const card = screen.getByTestId("board-card");
    for (const label of SEGMENT_LABELS) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    const text = card.textContent ?? "";
    const positions = SEGMENT_LABELS.map((label) => text.indexOf(label));
    for (let i = 0; i < positions.length - 1; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(0);
      expect(positions[i]).toBeLessThan(positions[i + 1]);
    }
  });

  it("TC-09: Implementation column card with valid stage shows exactly one active segment", () => {
    render(<BoardCard card={implementationCard("plan")} />);
    const card = screen.getByTestId("board-card");
    const activeLabels = SEGMENT_LABELS.filter((label) =>
      isActive(findSegmentByLabel(card, label))
    );
    expect(activeLabels).toEqual(["Plan"]);
  });

  it("TC-10: Implementation column with unrecognised stage renders an all-inactive stepper", () => {
    render(<BoardCard card={implementationCard("not_a_stage")} />);
    const card = screen.getByTestId("board-card");
    for (const label of SEGMENT_LABELS) {
      expect(within(card).getByText(label)).toBeInTheDocument();
      expect(isActive(findSegmentByLabel(card, label))).toBe(false);
    }
  });

  it.each([
    ["null", implementationCardMissingStage("null")] as const,
    ["undefined", implementationCardMissingStage("undefined")] as const,
  ])(
    "TC-11: Implementation column with %s current_stage renders an all-inactive stepper",
    (_label, cardDto) => {
      const { container } = render(<BoardCard card={cardDto} />);
      const card = within(container).getByTestId("board-card");
      for (const label of SEGMENT_LABELS) {
        expect(within(card).getByText(label)).toBeInTheDocument();
        expect(isActive(findSegmentByLabel(card, label))).toBe(false);
      }
    }
  );

  it.each<Exclude<BoardColumn, "implementation">>([
    "idea",
    "brainstorm",
    "requirements",
    "done",
  ])(
    "TC-12: BoardCard in non-Implementation column '%s' does not render any segment label",
    (column) => {
      const { container } = render(
        <BoardCard card={nonImplementationCard(column)} />
      );
      const card = within(container).getByTestId("board-card");
      for (const label of SEGMENT_LABELS) {
        expect(within(card).queryByText(label)).toBeNull();
      }
    }
  );
});

describe("Supabase blocked board marker", () => {
  it("renders a distinct Supabase blocked chip and compact panel without setup inputs", () => {
    render(<BoardCard card={{
      ...implementationCard("exec"),
      hasBlockedRun: true,
      supabaseBlocker: {
        status: "blocked",
        label: "Supabase blocked",
        runId: "run-1",
        workspace: { key: "alpha" },
        missingSetupActions: ["Store management token", "Connect Supabase project"],
        message: "Supabase readiness blocked planned DB-relevant work. Missing setup actions: Store management token, Connect Supabase project.",
        retry: { available: true, ready: false },
      },
    }} />);
    expect(screen.getByTestId("board-card-supabase-blocked-chip")).toHaveTextContent("Supabase blocked");
    expect(screen.getByTestId("supabase-blocked-run-panel")).toBeInTheDocument();
    expect(screen.queryByLabelText("Supabase Management API token")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Supabase project ref")).not.toBeInTheDocument();
  });
});
