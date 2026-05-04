import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BranchLifecycleStepper } from "@/components/lifecycle/BranchLifecycleStepper";

describe("BranchLifecycleStepper", () => {
  it("PROJ-4 PRD-9 US-1: renders five fixed lifecycle steps with status, timestamp, and reason", () => {
    render(<BranchLifecycleStepper steps={[
      { id: "branch_creation", label: "Branch creation", status: "passed", lastUpdateAt: "2026-05-04T10:00:00.000Z" },
      { id: "migrations", label: "Migrations", status: "failed", lastUpdateAt: "2026-05-04T10:01:00.000Z", reason: "provider [redacted]" },
      { id: "seed", label: "Seed", status: "idle" },
      { id: "db_tests", label: "DB tests", status: "retained", reason: "retained for diagnosis" },
      { id: "cleanup", label: "Cleanup", status: "idle" },
    ]} />);
    expect(screen.getAllByRole("listitem").map(item => item.textContent)).toEqual([
      expect.stringContaining("Branch creation"),
      expect.stringContaining("Migrations"),
      expect.stringContaining("Seed"),
      expect.stringContaining("DB tests"),
      expect.stringContaining("Cleanup"),
    ]);
    expect(screen.getByText("provider [redacted]")).toBeInTheDocument();
    expect(screen.getByText("2026-05-04T10:01:00.000Z")).toBeInTheDocument();
  });
});
