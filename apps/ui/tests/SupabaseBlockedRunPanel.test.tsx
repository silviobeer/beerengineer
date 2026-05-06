import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseBlockedRunPanel } from "@/components/SupabaseBlockedRunPanel";
import type { BoardCardDTO } from "@/lib/types";

const originalFetch = globalThis.fetch;

const blocker: NonNullable<BoardCardDTO["supabaseBlocker"]> = {
  status: "blocked",
  label: "Supabase blocked",
  runId: "run-1",
  workspace: { id: "ws-alpha", key: "alpha" },
  missingSetupActions: ["Rotate management token", "Re-authorize project access", "Create persistent test branch"],
  message: "Supabase Management API returned 403 for sbp_[redacted]",
  retry: { available: true, ready: false },
};

describe("SupabaseBlockedRunPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("lists exact setup actions, names workspace, and links only to workspace settings", () => {
    render(<SupabaseBlockedRunPanel blocker={blocker} />);
    expect(screen.getByText("Supabase blocked")).toBeInTheDocument();
    expect(screen.getByText("workspace alpha")).toBeInTheDocument();
    expect(screen.getByText(/Supabase Management API returned 403/)).toBeInTheDocument();
    expect(screen.getByText(/Rotate management token/)).toBeInTheDocument();
    expect(screen.getByText(/Re-authorize project access/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open workspace Supabase settings" });
    expect(link).toHaveAttribute("href", "/w/alpha/settings#supabase");
    expect(link).not.toHaveAttribute("href", "/settings");
    expect(screen.queryByLabelText("Supabase Management API token")).not.toBeInTheDocument();
  });

  it("shows a safe error instead of guessing when workspace key is missing", () => {
    render(<SupabaseBlockedRunPanel blocker={{ ...blocker, workspace: { id: "ws-alpha" } }} />);
    expect(screen.queryByRole("link", { name: "Open workspace Supabase settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("workspace key is missing");
  });

  it("keeps retry disabled while blocked and uses the same run when ready", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ recoveryStatus: null }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const readyBlocker = { ...blocker, retry: { available: true, ready: true } };
    render(<SupabaseBlockedRunPanel blocker={readyBlocker} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry blocked run" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/runs/run-1/supabase-readiness/retry",
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(screen.queryByTestId("supabase-blocked-run-panel")).not.toBeInTheDocument());
  });

  it("wraps labels and keeps the repair link visible for mobile rendering", () => {
    render(<SupabaseBlockedRunPanel blocker={blocker} compact />);
    expect(screen.getByText(/Create persistent test branch/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open workspace Supabase settings" })).toBeVisible();
  });

  it("resets hidden retry state when a new blocker arrives", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ recoveryStatus: null })) as unknown as typeof fetch;
    const { rerender } = render(<SupabaseBlockedRunPanel blocker={{ ...blocker, retry: { available: true, ready: true } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry blocked run" }));
    await waitFor(() => expect(screen.queryByTestId("supabase-blocked-run-panel")).not.toBeInTheDocument());

    rerender(<SupabaseBlockedRunPanel blocker={{ ...blocker, runId: "run-2", workspace: { key: "beta" } }} />);
    expect(screen.getByText("workspace beta")).toBeInTheDocument();
  });
});
