import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupGateBox } from "@/components/setup/SetupGateBox";
import { blockedReport, readyReport, recommendedReport, uninitializedConfigView } from "./setupFixtures";

describe("SetupGateBox", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

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

  it("initializes missing app state from the setup gate", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input).endsWith("/api/setup/init")) return Response.json({ ok: true, configState: "created" });
      return Response.json({ ok: true, report: readyReport() });
    }) as unknown as typeof fetch;

    render(<SetupGateBox initialReport={blockedReport()} initialConfigView={uninitializedConfigView()} />);
    expect(screen.getByRole("button", { name: "Initialize app" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Initialize app" }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/setup/init", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
  });

  it("labels recommended gates without blocking Next", () => {
    render(<SetupGateBox initialReport={recommendedReport()} />);

    expect(screen.getByText("recommended gate")).toBeInTheDocument();
    expect(screen.getByTestId("status-chip")).toHaveAttribute("data-state", "recommended");
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Recommended");
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
  });
});
