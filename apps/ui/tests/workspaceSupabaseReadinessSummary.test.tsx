import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SupabaseReadinessSummary } from "@/components/settings/SupabaseReadinessSummary";
import type { SupabaseReadinessSnapshot } from "@/lib/setup/types";

function getMissingAction(name: string): HTMLElement {
  return screen.getByText((_, element) => element?.tagName === "LI" && element.textContent?.includes(name) === true);
}

describe("SupabaseReadinessSummary", () => {
  it("renders exact missing setup labels and provider message before fallback copy", () => {
    const readiness: SupabaseReadinessSnapshot = {
      status: "blocked",
      missingSetupActions: ["Rotate management token", "Re-authorize project access", "Create persistent test branch"],
      retry: { available: true, runId: "run-1" },
      workspace: { key: "alpha" },
      branch: { ref: "br_1", status: "unauthorized" },
      message: "Supabase Management API returned 403 for sbp_[redacted]",
    };
    render(<SupabaseReadinessSummary readiness={readiness} />);
    expect(getMissingAction("Rotate management token")).toBeInTheDocument();
    expect(getMissingAction("Re-authorize project access")).toBeInTheDocument();
    expect(getMissingAction("Create persistent test branch")).toBeInTheDocument();
    expect(screen.getByText(/Supabase Management API returned 403/)).toBeInTheDocument();
    expect(screen.getByText(/Retry run is separate from setup actions/)).toBeInTheDocument();
  });

  it("shows checking and only treats active healthy ready payload as retryable", () => {
    const checking: SupabaseReadinessSnapshot = {
      status: "checking",
      missingSetupActions: [],
      retry: { available: true, runId: "run-1" },
      workspace: { key: "alpha" },
      branch: { ref: "br_1", status: "timeout", providerStatus: "CREATING" },
    };
    render(<SupabaseReadinessSummary readiness={checking} />);
    expect(screen.getByTestId("status-chip")).toHaveAttribute("data-state", "checking");
    expect(screen.getByRole("button", { name: "Retry blocked run" })).toBeDisabled();
  });
});
