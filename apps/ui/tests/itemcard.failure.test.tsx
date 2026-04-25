import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ItemCard } from "@/components/ItemCard";
import { makeItem } from "@/lib/fixtures";

describe("ItemCard failure indicator (AC-1.4)", () => {
  it("renders red failure indicator when pipelineState is failed", () => {
    render(
      <ItemCard
        item={makeItem({ id: "f1", pipelineState: "failed" })}
        workspaceKey="demo"
      />
    );
    const failure = screen.getByTestId("failure-indicator");
    expect(failure).toBeInTheDocument();
    // Must be a distinct DOM node from any attention dot
    expect(screen.queryByTestId("attention-dot")).not.toBeInTheDocument();
  });

  it.each([["openPrompt"], ["review-gate-waiting"], ["run-blocked"], ["prompt"], ["review"], ["blocked"]])(
    "does not render failure indicator for attention-trigger state %s",
    (state) => {
      render(
        <ItemCard
          item={makeItem({ id: "f", pipelineState: state })}
          workspaceKey="demo"
        />
      );
      expect(screen.queryByTestId("failure-indicator")).not.toBeInTheDocument();
    }
  );

  it.each([["idle"], ["running"], ["done"]])(
    "renders neither indicator for neutral state %s",
    (state) => {
      render(
        <ItemCard
          item={makeItem({ id: "f", pipelineState: state })}
          workspaceKey="demo"
        />
      );
      expect(screen.queryByTestId("attention-dot")).not.toBeInTheDocument();
      expect(screen.queryByTestId("failure-indicator")).not.toBeInTheDocument();
    }
  );

  it("renders neither indicator for unknown phase_status (TC-EC-1)", () => {
    expect(() =>
      render(
        <ItemCard
          item={makeItem({ id: "f", pipelineState: "totally-unknown-status" })}
          workspaceKey="demo"
        />
      )
    ).not.toThrow();
    expect(screen.queryByTestId("attention-dot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("failure-indicator")).not.toBeInTheDocument();
  });
});

describe("ItemCard attention dot — spec-vocab phase_status (AC-1.3)", () => {
  it.each([["prompt"], ["review"], ["blocked"]])(
    "shows attention-dot when pipelineState=%s (spec vocab)",
    (state) => {
      render(
        <ItemCard
          item={makeItem({ id: "x", pipelineState: state })}
          workspaceKey="demo"
        />
      );
      expect(screen.getByTestId("attention-dot")).toBeInTheDocument();
    }
  );

  it("does not show attention-dot for failed", () => {
    render(
      <ItemCard
        item={makeItem({ id: "x", pipelineState: "failed" })}
        workspaceKey="demo"
      />
    );
    expect(screen.queryByTestId("attention-dot")).not.toBeInTheDocument();
  });
});
