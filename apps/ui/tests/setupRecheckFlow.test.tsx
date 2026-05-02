import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupGateBox } from "@/components/setup/SetupGateBox";
import { blockedReport, readyReport } from "./setupFixtures";

describe("Setup re-check flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("AC-17 disables Next and duplicate actions while checking", () => {
    globalThis.fetch = vi.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;
    render(<SetupGateBox initialReport={blockedReport()} />);
    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));
    expect(screen.getByRole("button", { name: /checking/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("AC-18 backend success unlocks Next", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: true, report: readyReport() })) as unknown as typeof fetch;
    render(<SetupGateBox initialReport={blockedReport()} />);
    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled());
  });

  it("AC-19 backend failure keeps Next disabled and updates the error", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: false, error: "still blocked" }, { status: 400 })) as unknown as typeof fetch;
    render(<SetupGateBox initialReport={blockedReport()} />);
    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));
    await screen.findByText("still blocked");
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("AC-20 does not unlock Next from local optimistic state alone", () => {
    globalThis.fetch = vi.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;
    render(<SetupGateBox initialReport={blockedReport()} />);
    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });
});
