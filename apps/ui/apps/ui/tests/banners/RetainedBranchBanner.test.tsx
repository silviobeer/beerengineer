import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RetainedBranchBanner } from "@/components/banners/RetainedBranchBanner";

describe("RetainedBranchBanner", () => {
  it("renders count, cost-risk copy, and deep link only while retained branches exist", () => {
    const { rerender } = render(<RetainedBranchBanner count={2} deepLinkHref="#supabase-diagnosis" />);
    expect(screen.getByText(/Retained Supabase branches: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Provider cost risk/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open diagnosis/ })).toHaveAttribute("href", "#supabase-diagnosis");
    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
    rerender(<RetainedBranchBanner count={0} deepLinkHref="#supabase-diagnosis" />);
    expect(screen.queryByText(/Retained Supabase branches/)).not.toBeInTheDocument();
  });
});
