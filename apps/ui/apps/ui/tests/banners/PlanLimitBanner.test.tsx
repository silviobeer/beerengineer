import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanLimitBanner } from "@/components/banners/PlanLimitBanner";

describe("PlanLimitBanner", () => {
  it("renders at 80 percent quota and hides when the condition resolves", () => {
    const { rerender } = render(<PlanLimitBanner ratio={0.8} />);
    expect(screen.getByText(/plan limit warning/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
    rerender(<PlanLimitBanner ratio={0.79} />);
    expect(screen.queryByText(/plan limit warning/i)).not.toBeInTheDocument();
  });
});
