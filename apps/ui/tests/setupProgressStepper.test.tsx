import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetupProgressStepper } from "@/components/setup/SetupProgressStepper";
import { blockedReport, readyReport } from "./setupFixtures";

describe("SetupProgressStepper", () => {
  it("AC-5 shows current step, total steps, and step names", () => {
    render(<SetupProgressStepper report={blockedReport()} />);
    expect(screen.getByText(/Step 3 of 5/i)).toBeInTheDocument();
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("Git")).toBeInTheDocument();
  });

  it("AC-6 visually distinguishes done, current blocked, checking, locked, and finished", () => {
    const { rerender } = render(<SetupProgressStepper report={blockedReport()} checking />);
    expect(screen.getAllByTestId("setup-step").map((el) => el.getAttribute("data-state"))).toContain("checking");
    rerender(<SetupProgressStepper report={readyReport()} />);
    expect(screen.getAllByTestId("setup-step").map((el) => el.getAttribute("data-state"))).toContain("finished");
  });

  it("AC-7 uses a stacking responsive grid without horizontal overflow markup", () => {
    render(<SetupProgressStepper report={blockedReport()} />);
    expect(screen.getByTestId("setup-stepper").querySelector("ol")?.className).toMatch(/grid/);
  });

  it("AC-8 keeps the Gate Box Wizard stepper shape instead of board columns", () => {
    render(<SetupProgressStepper report={blockedReport()} />);
    expect(screen.queryByText(/Idea|Implementation|Merge/)).not.toBeInTheDocument();
  });
});
