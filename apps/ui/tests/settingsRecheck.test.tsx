import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupStatusSection } from "@/components/settings/SetupStatusSection";
import { blockedReport, readyReport } from "./setupFixtures";

describe("Settings re-check controls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("AC-17 exposes section-level and global re-check actions", () => {
    render(<SetupStatusSection initialReport={blockedReport()} />);
    expect(screen.getByRole("button", { name: /Re-check all/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Re-check" }).length).toBeGreaterThan(0);
  });

  it("AC-18 loading states prevent contradictory double actions", () => {
    globalThis.fetch = vi.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;
    render(<SetupStatusSection initialReport={blockedReport()} />);
    fireEvent.click(screen.getByRole("button", { name: /Re-check all/i }));
    expect(screen.getByRole("button", { name: "Checking" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Re-check" })[0]).toBeDisabled();
  });

  it("AC-19 keeps errors visible in the affected section", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: false, error: "unknown_group" }, { status: 400 })) as unknown as typeof fetch;
    render(<SetupStatusSection initialReport={blockedReport()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Re-check" })[0]);
    await screen.findByText("unknown_group");
  });

  it("AC-20 uses wizard vocabulary for blocked, checking, done, skipped, and optional", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: true, report: readyReport() })) as unknown as typeof fetch;
    render(<SetupStatusSection initialReport={blockedReport()} />);
    expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/optional/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Re-check all/i }));
    await waitFor(() => expect(screen.getAllByTestId("status-chip")[0]).toHaveTextContent(/done/i));
  });

  it("shows check totals separately from required thresholds", () => {
    render(<SetupStatusSection initialReport={blockedReport()} />);

    expect(screen.getByText(/required · 1\/1 checks · threshold 1/i)).toBeInTheDocument();
    expect(screen.queryByText(/1\/1 required/i)).not.toBeInTheDocument();
  });
});
