import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSettingsPage } from "@/components/settings/WorkspaceSettingsPage";
import type { SupabaseReadinessSnapshot } from "@/lib/setup/types";

const originalFetch = globalThis.fetch;

function findMissingAction(name: string): Promise<HTMLElement> {
  return screen.findByText((_, element) => element?.tagName === "LI" && element.textContent?.includes(name) === true);
}

const ready: SupabaseReadinessSnapshot = {
  status: "ready",
  missingSetupActions: [],
  retry: { available: true, runId: "run-1" },
  workspace: { id: "ws-alpha", key: "alpha", projectRef: "abcdefghijklmnopqrst", persistentTestBranchName: "branch" },
  branch: { ref: "br_1", status: "active_healthy", providerStatus: "ACTIVE_HEALTHY" },
};

describe("workspace Supabase retry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("uses same-run retry endpoint and refreshes still-blocked readiness", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/supabase-readiness/retry")) return Response.json({ ok: true, runId: "run-1" });
      return Response.json({
        ok: true,
        readiness: {
          ...ready,
          status: "blocked",
          missingSetupActions: ["Create persistent test branch"],
          retry: { available: true, runId: "run-1" },
        },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<WorkspaceSettingsPage workspaceKey="alpha" initialReadiness={ready} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry blocked run" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/runs/run-1/supabase-readiness/retry", expect.objectContaining({ method: "POST" })));
    await findMissingAction("Create persistent test branch");
  });

  it("does not show retry without blocked-run context", () => {
    render(<WorkspaceSettingsPage workspaceKey="alpha" initialReadiness={{ ...ready, retry: { available: false } }} />);
    expect(screen.queryByRole("button", { name: "Retry blocked run" })).not.toBeInTheDocument();
  });
});
