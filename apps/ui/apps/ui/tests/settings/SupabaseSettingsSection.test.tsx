import "../../../../tests/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseSettingsSection } from "@/components/settings/SupabaseSettingsSection";
import { configView } from "../../../../tests/setupFixtures";

const originalFetch = globalThis.fetch;

describe("SupabaseSettingsSection", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders cached connection details without token material and refreshes explicitly", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: true })) as unknown as typeof fetch;
    render(<SupabaseSettingsSection supabase={configView().supabase} />);
    expect(screen.getByText("proj_1")).toBeInTheDocument();
    expect(screen.getByText("beerengineer-demo-persistent-test")).toBeInTheDocument();
    expect(screen.getByText("Present")).toBeInTheDocument();
    expect(screen.queryByText(/sbp_/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh preflight" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/setup/recheck", { method: "POST" }));
  });

  it("renders not-connected state", () => {
    render(<SupabaseSettingsSection supabase={{ ...configView().supabase, projectRef: undefined, tokenPresent: false }} />);
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
  });
});
