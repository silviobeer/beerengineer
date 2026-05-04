import "../../../../tests/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseSetupCard } from "@/components/setup/SupabaseSetupCard";

const originalFetch = globalThis.fetch;

describe("SupabaseSetupCard", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires token and project ref before validation", () => {
    render(<SupabaseSetupCard workspaceId="ws-1" />);
    expect(screen.getByRole("button", { name: "Validate Supabase" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Supabase Management API token"), { target: { value: "sbp_token" } });
    fireEvent.change(screen.getByLabelText("Supabase project ref"), { target: { value: "abcdefghijklmnopqrst" } });
    expect(screen.getByRole("button", { name: "Validate Supabase" })).not.toBeDisabled();
  });

  it("shows provider message before generic fallback on failure", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: false, message: "Invalid token from Supabase" }, { status: 401 })) as unknown as typeof fetch;
    render(<SupabaseSetupCard workspaceId="ws-1" />);
    fireEvent.change(screen.getByLabelText("Supabase Management API token"), { target: { value: "sbp_bad" } });
    fireEvent.change(screen.getByLabelText("Supabase project ref"), { target: { value: "abcdefghijklmnopqrst" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate Supabase" }));
    await screen.findByText("Invalid token from Supabase");
    expect(screen.queryByText("Supabase validation failed.")).not.toBeInTheDocument();
  });

  it("posts to the setup proxy and clears token after success", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: true, projectRef: "abcdefghijklmnopqrst", region: "eu" })) as unknown as typeof fetch;
    render(<SupabaseSetupCard workspaceId="ws-1" />);
    const token = screen.getByLabelText("Supabase Management API token");
    fireEvent.change(token, { target: { value: "sbp_token" } });
    fireEvent.change(screen.getByLabelText("Supabase project ref"), { target: { value: "abcdefghijklmnopqrst" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate Supabase" }));
    await waitFor(() => expect(token).toHaveValue(""));
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/setup/supabase/connect", expect.objectContaining({
      body: JSON.stringify({ workspaceId: "ws-1", token: "sbp_token", projectRef: "abcdefghijklmnopqrst" }),
    }));
  });
});
