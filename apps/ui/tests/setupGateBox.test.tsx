import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetupGateBox } from "@/components/setup/SetupGateBox";
import { blockedReport, readyReport } from "./setupFixtures";

describe("SetupGateBox", () => {
  it("AC-9 renders one central required blocker gate", () => {
    render(<SetupGateBox initialReport={blockedReport()} />);
    expect(screen.getAllByTestId("setup-gate-box")).toHaveLength(1);
    expect(screen.getByText("Git")).toBeInTheDocument();
    expect(screen.getByTestId("status-chip")).toHaveAttribute("data-state", "blocked");
    expect(screen.queryByLabelText("Run failed")).not.toBeInTheDocument();
  });

  it("AC-10 disables Skip for required gates", () => {
    render(<SetupGateBox initialReport={blockedReport()} />);
    expect(screen.getByRole("button", { name: /skip/i })).toBeDisabled();
  });

  it("AC-11 keeps Next disabled until backend-ready status is rendered", () => {
    const { rerender } = render(<SetupGateBox initialReport={blockedReport()} />);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    rerender(<SetupGateBox initialReport={readyReport()} />);
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
  });

  it("AC-12 distinguishes blocked, checking, and done button states", () => {
    render(<SetupGateBox initialReport={blockedReport()} />);
    expect(screen.getByTestId("setup-gate-box")).toHaveAttribute("data-state", "blocked");
    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));
    expect(screen.getByRole("button", { name: /checking/i })).toBeDisabled();
  });

  it("redacts project and admin OpenAI key prefixes from setup detail text", () => {
    const report = blockedReport();
    report.groups[1].checks[0].detail = "Keys sk-proj-secret_token and sk-admin-secret_token failed validation.";

    render(<SetupGateBox initialReport={report} />);

    expect(screen.getByText("Keys redacted and redacted failed validation.")).toBeInTheDocument();
    expect(screen.queryByText(/sk-proj-secret_token|sk-admin-secret_token/)).not.toBeInTheDocument();
  });
});
