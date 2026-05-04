import "../../../../tests/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseSetupCard } from "@/components/setup/SupabaseSetupCard";

const originalFetch = globalThis.fetch;

describe("SupabaseSetupCard rotate", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("shows three connected-workspace choices and rotates with setup-ui surface", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: true })) as unknown as typeof fetch;
    render(<SupabaseSetupCard workspaceId="ws-1" supabase={{
      workspaceId: "ws-1",
      projectRef: "proj_1",
      region: "eu",
      tokenPresent: true,
      branchGranularity: "wave",
      cleanupPolicy: "on-success-immediate",
      productionMigrationProtection: "off",
      settingsVersion: 1,
    }} />);
    expect(screen.getByLabelText("Connected Supabase project ref")).toHaveValue("proj_1");
    expect(screen.getByText("Leave as is")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Rotate Management API token"));
    fireEvent.change(screen.getByLabelText("Supabase Management API token"), { target: { value: "sbp_new" } });
    fireEvent.click(screen.getByRole("button", { name: "Rotate token" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/setup/supabase/rotate", expect.objectContaining({
      body: JSON.stringify({ token: "sbp_new", surface: "setup-ui" }),
    })));
  });
});
