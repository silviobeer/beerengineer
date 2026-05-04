import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SupabaseSettingsSection } from "@/components/settings/SupabaseSettingsSection";
import type { AppConfigView } from "@/lib/setup/types";

const supabase: AppConfigView["supabase"] = {
  workspaceId: "ws",
  projectRef: "proj",
  region: "eu",
  persistentTestBranchName: "beerengineer-test",
  persistentTestBranchRef: "br",
  persistentTestBranchStatus: "ACTIVE_HEALTHY",
  tokenPresent: true,
  branchGranularity: "wave",
  cleanupPolicy: "on-success-immediate",
  productionMigrationProtection: "off",
  settingsVersion: 1,
  costRisk: { retainedBranchCount: 1, planLimitRatio: 0.8 },
};

describe("SupabaseSettingsSection recreate", () => {
  it("opens typed confirmation and calls recreate route on exact match", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SupabaseSettingsSection supabase={supabase} />);
    expect(screen.getByText(/Retained Supabase branches: 1/)).toBeInTheDocument();
    expect(screen.getByText(/plan limit warning/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Recreate persistent test branch/ }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Recreate persistent test branch" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Branch name confirmation/), { target: { value: "beerengineer-test" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/supabase/recreate", expect.objectContaining({ method: "POST" })));
  });
});
