import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSettingsPage } from "@/components/settings/WorkspaceSettingsPage";
import type { SupabaseReadinessSnapshot } from "@/lib/setup/types";

const originalFetch = globalThis.fetch;

const notConfigured: SupabaseReadinessSnapshot = {
  status: "blocked",
  missingSetupActions: ["Store management token", "Connect Supabase project", "Create persistent test branch"],
  retry: { available: false },
  workspace: { id: "ws-alpha", key: "alpha" },
};

describe("workspace Supabase settings inputs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("shows project, token, branch setup inputs and hides connected-only controls when not configured", () => {
    render(<WorkspaceSettingsPage workspaceKey="alpha" initialReadiness={notConfigured} />);
    expect(screen.getByLabelText("Supabase project ref")).toBeInTheDocument();
    expect(screen.getByLabelText("Supabase Management API token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotate management token" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create or attach persistent branch" })).toBeInTheDocument();
    expect(screen.getByLabelText("Attach existing")).toBeInTheDocument();
    expect(screen.queryByText("Cleanup policy")).not.toBeInTheDocument();
    expect(screen.queryByText("Production migration protection")).not.toBeInTheDocument();
  });

  it("sends the selected branch mode to the dedicated setup endpoint", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ ok: true, readiness: { ...notConfigured, workspace: { ...notConfigured.workspace, projectRef: "abcdefghijklmnopqrst" } } }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    render(<WorkspaceSettingsPage workspaceKey="alpha" initialReadiness={{ ...notConfigured, workspace: { ...notConfigured.workspace, projectRef: "abcdefghijklmnopqrst" } }} />);

    fireEvent.click(screen.getByLabelText("Attach existing"));
    fireEvent.click(screen.getByRole("button", { name: "Create or attach persistent branch" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workspaces/alpha/supabase/branch",
      expect.objectContaining({ body: JSON.stringify({ mode: "attach" }) }),
    ));
  });

  it("keeps branch controls hidden for a direct-mode workspace", () => {
    render(<WorkspaceSettingsPage workspaceKey="alpha" initialReadiness={{
      ...notConfigured,
      status: "ready",
      missingSetupActions: [],
      workspace: {
        ...notConfigured.workspace,
        projectRef: "proj_direct",
        dbMode: "direct",
      },
    }} />);

    expect(screen.getByText(/Direct mode is active/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create or attach persistent branch" })).toBeNull();
    expect(screen.queryByLabelText("Attach existing")).toBeNull();
  });
});
