import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WaveRow } from "@/components/WaveRow";

const lifecycleSteps = [
  { id: "branch_creation" as const, label: "Branch creation", status: "passed" as const },
  { id: "migrations" as const, label: "Migrations", status: "passed" as const },
  { id: "seed" as const, label: "Seed", status: "idle" as const },
  { id: "db_tests" as const, label: "DB tests", status: "idle" as const },
  { id: "cleanup" as const, label: "Cleanup", status: "idle" as const },
];

describe("WaveRow Supabase gating", () => {
  it("PROJ-4 PRD-9 US-2: renders DB relevance chip and hides lifecycle UI for non-DB waves", () => {
    const { rerender } = render(<WaveRow title="Wave 1" dbRelevance={{ value: true, source: "detector", reason: "supabase migrations" }} lifecycleSteps={lifecycleSteps} />);
    expect(screen.getByLabelText("DB relevance detector: supabase migrations")).toBeInTheDocument();
    expect(screen.getByTestId("branch-lifecycle-stepper")).toBeInTheDocument();
    rerender(<WaveRow title="Wave 2" dbRelevance={{ value: false, source: "explicit", reason: "frontend only" }} lifecycleSteps={lifecycleSteps} />);
    expect(screen.getByLabelText("DB relevance explicit: frontend only")).toBeInTheDocument();
    expect(screen.queryByTestId("branch-lifecycle-stepper")).not.toBeInTheDocument();
  });
});
