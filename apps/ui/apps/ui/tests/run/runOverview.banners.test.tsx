import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunOverviewBanners } from "@/components/run/RunOverviewBanners";

describe("RunOverviewBanners", () => {
  it("PROJ-4 PRD-9 US-5: renders retained and plan-limit banners without fixed-width overlap risk", () => {
    render(<RunOverviewBanners costRisk={{ retainedBranchCount: 2, planLimitRatio: 0.8 }} />);
    expect(screen.getByText("Retained Supabase branches: 2")).toBeInTheDocument();
    expect(screen.getByText("Supabase branch plan limit warning")).toBeInTheDocument();
    expect(screen.getByTestId("run-overview-banners")).toHaveClass("space-y-3");
  });
});
