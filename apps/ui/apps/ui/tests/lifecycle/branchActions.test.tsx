import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BranchLifecycleStepper } from "@/components/lifecycle/BranchLifecycleStepper";

describe("Branch lifecycle actions", () => {
  it("PROJ-4 PRD-9 US-4: shows open, retry, and typed destroy actions for retained branches", async () => {
    const retry = vi.fn();
    const destroy = vi.fn();
    render(<BranchLifecycleStepper
      branchRef="br_1"
      branchName="be-wave-1"
      projectRef="proj_1"
      onRetryValidation={retry}
      onDestroy={destroy}
      steps={[
        { id: "branch_creation", label: "Branch creation", status: "passed" },
        { id: "migrations", label: "Migrations", status: "retained", reason: "provider [redacted]" },
        { id: "seed", label: "Seed", status: "idle" },
        { id: "db_tests", label: "DB tests", status: "idle" },
        { id: "cleanup", label: "Cleanup", status: "idle" },
      ]}
    />);
    expect(screen.getByRole("link", { name: "Open in Supabase" })).toHaveAttribute("href", "https://supabase.com/dashboard/project/proj_1/branches/br_1");
    await userEvent.click(screen.getByRole("button", { name: "Retry validation" }));
    expect(retry).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Destroy branch" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Destroy branch" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Branch name confirmation"), "be-wave-1");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
