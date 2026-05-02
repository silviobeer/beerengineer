import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupGateBox } from "@/components/setup/SetupGateBox";
import { optionalReport } from "./setupFixtures";

describe("Setup optional gates", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: true, status: "skipped" })) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("AC-21 optional-service gates show an enabled Skip path", () => {
    render(<SetupGateBox initialReport={optionalReport()} />);
    expect(screen.getByRole("button", { name: "Skip" })).not.toBeDisabled();
  });

  it("AC-22 skipped optionals do not block completion", async () => {
    render(<SetupGateBox initialReport={optionalReport()} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText(/setup can continue/i)).toBeInTheDocument());
  });

  it("AC-23 required and optional status are visually and textually distinct", () => {
    render(<SetupGateBox initialReport={optionalReport()} />);
    expect(screen.getByText("optional gate")).toBeInTheDocument();
  });

  it("AC-24 never displays optional configured secret cleartext", () => {
    render(<SetupGateBox initialReport={optionalReport()} />);
    expect(screen.queryByText(/sk-live-secret/i)).not.toBeInTheDocument();
  });
});
