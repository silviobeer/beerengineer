import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MiniStepper } from "@/components/MiniStepper";
import { ItemCard } from "@/components/ItemCard";
import { makeItem } from "@/lib/fixtures";
import { STAGE_KEYS } from "@/lib/types";

describe("MiniStepper segments (AC-1.5)", () => {
  it("renders six labeled segments in order: Arch, Plan, Exec, Review, QA, Doc", () => {
    render(<MiniStepper currentStage="planning" />);
    const stepper = screen.getByTestId("mini-stepper");
    const segments = within(stepper).getAllByTestId(/mini-stepper-segment-/);
    expect(segments).toHaveLength(6);
    expect(segments.map((s) => s.dataset.segment)).toEqual([
      "arch",
      "plan",
      "exec",
      "review",
      "qa",
      "doc",
    ]);
    const labels = segments.map((s) => s.textContent?.replace(/^▶\s*/, ""));
    expect(labels).toEqual(["Arch", "Plan", "Exec", "Review", "QA", "Doc"]);
  });

  it.each(STAGE_KEYS.map((k) => [k]))(
    "highlights only the segment matching currentStage=%s",
    (stage) => {
      render(<MiniStepper currentStage={stage} />);
      for (const key of STAGE_KEYS) {
        const seg = screen.getByTestId(`mini-stepper-segment-${key}`);
        if (key === stage) {
          expect(seg.dataset.active).toBe("true");
        } else {
          expect(seg.dataset.active).toBe("false");
        }
      }
    }
  );

  it("marks only the active segment as active and the rest as inactive", () => {
    render(<MiniStepper currentStage="exec" />);
    const archSeg = screen.getByTestId("mini-stepper-segment-arch");
    const planSeg = screen.getByTestId("mini-stepper-segment-plan");
    const execSeg = screen.getByTestId("mini-stepper-segment-exec");
    const reviewSeg = screen.getByTestId("mini-stepper-segment-review");

    // The active segment renders with a unique petrol-tinted style (border,
    // background, color, font-weight); inactive ones render dim. The
    // discriminator is `data-active`, set by the component on each segment.
    expect(archSeg.dataset.active).toBe("false");
    expect(planSeg.dataset.active).toBe("false");
    expect(reviewSeg.dataset.active).toBe("false");
    expect(execSeg.dataset.active).toBe("true");
    // The rendered styles must actually differ between active and inactive,
    // so screen-readers and sighted users get the same affordance.
    const activeStyle = window.getComputedStyle(execSeg);
    const inactiveStyle = window.getComputedStyle(archSeg);
    expect(activeStyle.backgroundColor).not.toBe(inactiveStyle.backgroundColor);
  });

  it("renders all four segments with none highlighted when currentStage is unknown (TC-EC-2)", () => {
    expect(() =>
      render(<MiniStepper currentStage="deploy" />)
    ).not.toThrow();
    const segments = screen.getAllByTestId(/mini-stepper-segment-/);
    expect(segments).toHaveLength(6);
    for (const seg of segments) {
      expect(seg.dataset.active).toBe("false");
    }
  });

  it("does not render Mini-Stepper for non-pipeline column cards (TC-1.5d)", () => {
    // Stepper renders for `Implementation` (arch/plan/exec/review) and
    // `Frontend` (visual/design). Other columns have no sub-stages worth
    // showing, so the stepper stays hidden.
    const phases = ["Idea", "Requirements", "Test", "Merge"] as const;
    for (const phase of phases) {
      const { unmount } = render(
        <ItemCard
          item={makeItem({ id: `x-${phase}`, phase })}
          workspaceKey="demo"
        />
      );
      expect(screen.queryByTestId("mini-stepper")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("renders Mini-Stepper for Frontend phase with design-prep segments", () => {
    render(
      <ItemCard
        item={makeItem({
          id: "fe-x",
          phase: "Frontend",
          pipelineState: "running",
          current_stage: "visual-companion",
        })}
        workspaceKey="demo"
      />
    );
    expect(screen.getByTestId("mini-stepper")).toBeInTheDocument();
    expect(
      screen.getByTestId("mini-stepper-segment-visual-companion").dataset.active
    ).toBe("true");
    expect(
      screen.getByTestId("mini-stepper-segment-frontend-design").dataset.active
    ).toBe("false");
  });

  it("Implementation stepper lights up the right segment for full engine stage names (qa, documentation get their own segments; handoff isn't a stepper segment, it's the Merge column)", () => {
    const cases: Array<[string, "arch" | "plan" | "exec" | "review" | "qa" | "doc"]> = [
      ["requirements", "arch"],
      ["architecture", "arch"],
      ["planning", "plan"],
      ["execution", "exec"],
      ["project-review", "review"],
      ["qa", "qa"],
      ["documentation", "doc"],
    ];
    for (const [stageKey, expectedSegment] of cases) {
      const { unmount } = render(
        <ItemCard
          item={makeItem({
            id: `impl-${stageKey}`,
            phase: "Implementation",
            pipelineState: "running",
            current_stage: stageKey,
          })}
          workspaceKey="demo"
        />
      );
      expect(
        screen.getByTestId(`mini-stepper-segment-${expectedSegment}`).dataset.active,
      ).toBe("true");
      unmount();
    }
  });

  it("handoff stage does not light any implementation stepper segment (item belongs to the Merge column instead)", () => {
    render(
      <ItemCard
        item={makeItem({
          id: "impl-handoff",
          phase: "Implementation",
          pipelineState: "running",
          current_stage: "handoff",
        })}
        workspaceKey="demo"
      />
    );
    const segments = screen.getAllByTestId(/mini-stepper-segment-/);
    for (const seg of segments) {
      expect(seg.dataset.active).toBe("false");
    }
  });

  it("renders Mini-Stepper inside Implementation card", () => {
    render(
      <ItemCard
        item={makeItem({
          id: "impl-x",
          phase: "Implementation",
          pipelineState: "running",
          current_stage: "exec",
        })}
        workspaceKey="demo"
      />
    );
    expect(screen.getByTestId("mini-stepper")).toBeInTheDocument();
    expect(
      screen.getByTestId("mini-stepper-segment-exec").dataset.active
    ).toBe("true");
  });
});
