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

  it("hides post-connection controls and shows connect CTA when not connected", () => {
    render(
      <SupabaseSettingsSection
        supabase={{ ...configView().supabase, projectRef: undefined, tokenPresent: false }}
      />,
    );
    expect(screen.queryByRole("button", { name: /Rotate Management API token/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Refresh preflight/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Recreate persistent test branch/i })).toBeNull();
    expect(screen.queryByLabelText(/Production migration protection/i)).toBeNull();
    expect(screen.queryByText(/Cleanup policy/i)).toBeNull();
    expect(screen.queryByText(/Retained Supabase branches/i)).toBeNull();
    expect(screen.queryByText(/plan limit/i)).toBeNull();
    const cta = screen.getByRole("link", { name: /connect supabase|set up supabase|configure supabase/i });
    expect(cta).toHaveAttribute("href", "/setup#supabase");
  });

  it("renders all controls when connected", () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: true })) as unknown as typeof fetch;
    render(<SupabaseSettingsSection supabase={configView().supabase} />);
    expect(screen.getByRole("button", { name: /Rotate Management API token/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh preflight/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Production migration protection/i)).toBeInTheDocument();
  });

  it("labels direct mode explicitly and hides branch-only settings controls", () => {
    render(<SupabaseSettingsSection supabase={{
      ...configView().supabase,
      dbMode: "direct",
      persistentTestBranchName: undefined,
      persistentTestBranchRef: undefined,
      persistentTestBranchStatus: undefined,
    }} />);
    expect(screen.getByText(/Direct mode is active/i)).toBeInTheDocument();
    expect(screen.getByText("direct")).toBeInTheDocument();
    expect(screen.queryByText(/Cleanup policy/i)).toBeNull();
    expect(screen.queryByLabelText(/Production migration protection/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Recreate persistent test branch/i })).toBeNull();
    expect(screen.queryByText(/^Persistent test branch$/i)).toBeNull();
    expect(screen.queryByText(/^Branch status$/i)).toBeNull();
  });
});
