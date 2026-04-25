import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ItemCard } from "@/components/ItemCard";
import { makeItem } from "@/lib/fixtures";

describe("ItemCard display (TC-04, TC-05, TC-06, TC-07, TC-08, TC-09, TC-10, TC-12)", () => {
  it("renders title and status chip", () => {
    render(
      <ItemCard
        item={makeItem({ id: "x1", title: "My Title", pipelineState: "running" })}
        workspaceKey="demo"
      />
    );
    expect(screen.getByTestId("item-title")).toHaveTextContent("My Title");
    const chip = screen.getByTestId("status-chip");
    expect(chip.dataset.state).toBe("running");
    expect(chip).toHaveTextContent(/Running/);
  });

  it.each([
    ["openPrompt"],
    ["review-gate-waiting"],
    ["run-blocked"],
  ])("shows attention-dot when pipelineState=%s", (state) => {
    render(
      <ItemCard
        item={makeItem({ id: "x", pipelineState: state })}
        workspaceKey="demo"
      />
    );
    expect(screen.getByTestId("attention-dot")).toBeInTheDocument();
  });

  it.each([["idle"], ["running"], ["done"]])(
    "does not show attention-dot for non-trigger state %s",
    (state) => {
      render(
        <ItemCard
          item={makeItem({ id: "x", pipelineState: state })}
          workspaceKey="demo"
        />
      );
      expect(screen.queryByTestId("attention-dot")).not.toBeInTheDocument();
    }
  );

  it("renders summary when present", () => {
    render(
      <ItemCard
        item={makeItem({ id: "x", summary: "A summary" })}
        workspaceKey="demo"
      />
    );
    expect(screen.getByTestId("item-summary")).toHaveTextContent("A summary");
  });

  it.each([[null], [undefined], [""]])(
    "does not render summary container when summary is %s",
    (summary) => {
      render(
        <ItemCard
          item={makeItem({ id: "x", summary: summary as string | null })}
          workspaceKey="demo"
        />
      );
      expect(screen.queryByTestId("item-summary")).not.toBeInTheDocument();
    }
  );

  it("contains exactly one interactive target (the card link itself)", () => {
    const { container } = render(
      <ItemCard
        item={makeItem({ id: "x" })}
        workspaceKey="demo"
      />
    );
    const root = container.querySelector('[data-testid="item-card"]')!;
    const interactiveSelector = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "[role=button]",
      "[role=link]",
      "[role=checkbox]",
      "[role=radio]",
      "[role=menuitem]",
      "[role=menuitemcheckbox]",
      "[role=menuitemradio]",
      "[tabindex]:not([tabindex='-1'])",
      "[draggable=true]",
    ].join(",");
    const descendants = root.querySelectorAll(interactiveSelector);
    expect(descendants.length).toBe(0);
  });

  it("renders itemCode in a class that maps to a monospace font (TC-03 unit fallback)", () => {
    render(
      <ItemCard item={makeItem({ id: "x", itemCode: "UI-42" })} workspaceKey="demo" />
    );
    const code = screen.getByTestId("item-code");
    expect(code).toHaveTextContent("UI-42");
    // happy-dom does not resolve font-family from utility classes, so we
    // assert the contract that the element carries a mono utility class.
    expect(code.className).toContain("font-mono");
  });
});
