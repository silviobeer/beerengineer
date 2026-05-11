import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceSettingsPage } from "@/components/settings/WorkspaceSettingsPage";
import type { SupabaseReadinessSnapshot } from "@/lib/setup/types";

const blocked: SupabaseReadinessSnapshot = {
  status: "blocked",
  missingSetupActions: ["Store management token", "Connect Supabase project", "Create persistent test branch"],
  retry: { available: true, runId: "run-1" },
  workspace: { id: "ws-alpha", key: "alpha" },
};

describe("WorkspaceSettingsPage", () => {
  it("renders workspace settings shell and Supabase anchor for route key", () => {
    render(<WorkspaceSettingsPage workspaceKey="alpha" workspaceName="Alpha" initialReadiness={blocked} />);
    expect(screen.getByTestId("workspace-settings-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workspace settings" })).toBeInTheDocument();
    expect(screen.getByText("/w/alpha/settings")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Supabase" })).toHaveAttribute("href", "#supabase");
    expect(screen.getByTestId("workspace-settings-supabase")).toHaveClass("scroll-mt-24");
    expect(screen.queryByText(/app-global/i)).not.toBeInTheDocument();
  });

  it("labels direct mode explicitly and hides persistent-branch controls", () => {
    render(<WorkspaceSettingsPage workspaceKey="alpha" workspaceName="Alpha" initialReadiness={{
      ...blocked,
      workspace: {
        ...blocked.workspace,
        projectRef: "proj_direct",
        dbMode: "direct",
      },
      missingSetupActions: [],
      status: "ready",
    }} />);
    expect(screen.getByText(/Direct mode is active for this workspace/i)).toBeInTheDocument();
    expect(screen.getByText("direct")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create or attach persistent branch" })).toBeNull();
    expect(screen.queryByLabelText("Attach existing")).toBeNull();
  });
});
