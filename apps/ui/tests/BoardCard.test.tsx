import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BoardCard } from "@/components/BoardCard";
import {
  implementationCard,
  implementationCardMissingStage,
  nonImplementationCard,
} from "@/lib/fixtures";
import type { BoardColumn } from "@/lib/types";

const SEGMENT_LABELS = ["Arch", "Plan", "Exec", "Review"];

describe("BoardCard stepper visibility (US-02)", () => {
  it("TC-08: Implementation column card renders the four segment labels", () => {
    render(<BoardCard card={implementationCard("exec")} />);
    const stepper = screen.getByTestId("mini-stepper");
    const segments = within(stepper).getAllByRole("listitem");
    expect(segments).toHaveLength(4);
    expect(segments.map((el) => el.textContent?.trim())).toEqual(SEGMENT_LABELS);
  });

  it("TC-09: Implementation column card with valid stage shows exactly one active segment", () => {
    render(<BoardCard card={implementationCard("plan")} />);
    const stepper = screen.getByTestId("mini-stepper");
    const segments = within(stepper).getAllByRole("listitem");
    const active = segments.filter(
      (el) => el.getAttribute("data-active") === "true"
    );
    expect(active).toHaveLength(1);
    expect(active[0].textContent?.trim()).toBe("Plan");
  });

  it("TC-10: Implementation column with unrecognised stage renders an all-inactive stepper", () => {
    render(<BoardCard card={implementationCard("not_a_stage")} />);
    const stepper = screen.getByTestId("mini-stepper");
    const segments = within(stepper).getAllByRole("listitem");
    expect(segments).toHaveLength(4);
    expect(
      segments.filter((el) => el.getAttribute("data-active") === "true")
    ).toHaveLength(0);
  });

  it.each([
    ["null", implementationCardMissingStage("null")] as const,
    ["undefined", implementationCardMissingStage("undefined")] as const,
  ])(
    "TC-11: Implementation column with %s current_stage renders an all-inactive stepper",
    (_label, card) => {
      const { container } = render(<BoardCard card={card} />);
      const stepper = within(container).getByTestId("mini-stepper");
      const segments = within(stepper).getAllByRole("listitem");
      expect(segments).toHaveLength(4);
      expect(
        segments.filter((el) => el.getAttribute("data-active") === "true")
      ).toHaveLength(0);
    }
  );

  it.each<Exclude<BoardColumn, "implementation">>([
    "idea",
    "frontend",
    "requirements",
    "test",
    "merge",
  ])(
    "TC-12: BoardCard in non-Implementation column '%s' does not render a stepper",
    (column) => {
      const { container } = render(
        <BoardCard card={nonImplementationCard(column)} />
      );
      expect(within(container).queryByTestId("mini-stepper")).toBeNull();
      for (const label of SEGMENT_LABELS) {
        expect(within(container).queryByText(label)).toBeNull();
      }
    }
  );
});
