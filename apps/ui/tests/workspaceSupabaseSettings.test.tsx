import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceSettingsPage } from "@/components/settings/WorkspaceSettingsPage";
import type { SupabaseReadinessSnapshot } from "@/lib/setup/types";

const notConfigured: SupabaseReadinessSnapshot = {
  status: "blocked",
  missingSetupActions: ["Store management token", "Connect Supabase project", "Create persistent test branch"],
  retry: { available: false },
  workspace: { id: "ws-alpha", key: "alpha" },
};

describe("workspace Supabase settings inputs", () => {
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
});
