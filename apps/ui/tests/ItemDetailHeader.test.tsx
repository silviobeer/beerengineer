import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ItemDetailHeader } from "../app/_ui/ItemDetailHeader";

const MONO_FAMILIES = ["monospace", "courier", "menlo", "monaco", "consolas", "ui-monospace"];
const PROPORTIONAL_FAMILIES = ["inter", "arial", "helvetica", "sans-serif", "system-ui"];

function isMonospace(fontFamily: string): boolean {
  const normalized = fontFamily.toLowerCase();
  return MONO_FAMILIES.some(token => normalized.includes(token));
}

describe("ItemDetailHeader (TC-01..TC-03)", () => {
  it("TC-01: itemCode renders with a measurably monospace font", () => {
    render(
      <ItemDetailHeader
        itemCode="BEER-042"
        title="A title"
        phaseStatus="idea"
        currentStage={null}
      />,
    );
    const codeEl = screen.getByText("BEER-042");
    const family = window.getComputedStyle(codeEl).fontFamily;
    expect(family.length).toBeGreaterThan(0);
    expect(isMonospace(family)).toBe(true);
    const allowsProportionalOnly = PROPORTIONAL_FAMILIES.every(
      token => !family.toLowerCase().includes(token) || isMonospace(family),
    );
    expect(allowsProportionalOnly).toBe(true);
  });

  it("TC-02: title text is visible in the header", () => {
    render(
      <ItemDetailHeader
        itemCode="BEER-042"
        title="Redesign login flow"
        phaseStatus="idea"
        currentStage={null}
      />,
    );
    const header = screen.getByRole("banner");
    const title = within(header).getByText("Redesign login flow");
    expect(title).toBeVisible();
    expect(title).not.toHaveAttribute("aria-hidden", "true");
  });

  describe("TC-03: status chip text per phase/stage pair (FX-08)", () => {
    it("idea + null shows 'Idea' and no stage suffix", () => {
      const { unmount } = render(
        <ItemDetailHeader
          itemCode="X"
          title="T"
          phaseStatus="idea"
          currentStage={null}
        />,
      );
      const chip = screen.getByTestId("status-chip");
      expect(chip).toHaveTextContent(/Idea/);
      expect(chip.textContent ?? "").not.toMatch(/exec|impl|brainstorm/i);
      unmount();
    });

    it("implementation + exec shows both 'Implementation' and 'Exec'", () => {
      const { unmount } = render(
        <ItemDetailHeader
          itemCode="X"
          title="T"
          phaseStatus="implementation"
          currentStage="exec"
        />,
      );
      const chip = screen.getByTestId("status-chip");
      expect(chip.textContent).toMatch(/Implementation/);
      expect(chip.textContent).toMatch(/Exec/);
      unmount();
    });

    it("test + null shows 'Test' with no stage suffix", () => {
      const { unmount } = render(
        <ItemDetailHeader
          itemCode="X"
          title="T"
          phaseStatus="test"
          currentStage={null}
        />,
      );
      const chip = screen.getByTestId("status-chip");
      expect(chip).toHaveTextContent(/Test/);
      expect(chip.textContent ?? "").not.toMatch(/exec|qa|brainstorm/i);
      unmount();
    });
  });
});
