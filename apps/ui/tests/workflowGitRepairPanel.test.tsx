import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowGitRepairPanel } from "@/components/WorkflowGitRepairPanel";
import type { WorkflowGitBlockedActionResult } from "@/lib/engine/types";
import { workspaceGitReadiness } from "./setupFixtures";

function blockedStart(overrides: Partial<WorkflowGitBlockedActionResult> = {}): WorkflowGitBlockedActionResult {
  return {
    ok: false,
    status: 409,
    error: "git_identity_missing",
    code: "workflow_git_blocked",
    message: "Git identity is missing for this workspace. Repair by applying a local identity.",
    readiness: workspaceGitReadiness(),
    repair: {
      action: "repair_workspace_identity",
      workspaceId: "ws-1",
      workspaceKey: "demo",
      appDefaultIdentityAvailable: true,
    },
    intent: { itemId: "item-1", action: "start_brainstorm" },
    ...overrides,
  };
}

describe("WorkflowGitRepairPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps item context visible, requires confirmation, and repairs without path fields", async () => {
    const ready = workspaceGitReadiness({
      repoLocalIdentity: { name: "Beer Engineer", email: "beer@local.beerengineer" },
      effectiveIdentity: { source: "repo-local", name: "Beer Engineer", email: "beer@local.beerengineer", localOnly: true },
      ready: true,
      workflowBlocked: false,
      availableActions: [],
      blocker: undefined,
    });
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/setup/git-identity/repair")) {
        return Response.json({ ok: true, readiness: ready });
      }
      return Response.json(ready);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const onContinue = vi.fn();

    render(<WorkflowGitRepairPanel blocker={blockedStart()} itemCode="ITEM-0001" itemTitle="Fresh install" onContinue={onContinue} />);

    expect(screen.getByText("ITEM-0001")).toBeInTheDocument();
    expect(screen.getByText("Fresh install")).toBeInTheDocument();
    const panel = screen.getByTestId("workflow-git-repair-panel");
    const repairButton = within(panel).getByRole("button", { name: /repair workspace/i });
    expect(repairButton).toBeDisabled();
    expect(within(panel).getByRole("button", { name: /continue start/i })).toBeDisabled();

    fireEvent.click(within(panel).getByRole("checkbox"));
    fireEvent.click(repairButton);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/setup/git-identity/repair", expect.objectContaining({ method: "POST" })));
    const repairCall = fetchSpy.mock.calls.find((call) => String(call[0]).includes("/api/setup/git-identity/repair"));
    const body = JSON.parse(String((repairCall?.[1] as RequestInit).body));
    expect(body).toEqual({
      workspaceId: "ws-1",
      workspaceKey: "demo",
      identity: { displayName: "Beer Engineer", email: "beer@local.beerengineer" },
    });
    expect(body).not.toHaveProperty("workspaceRoot");
    expect(body).not.toHaveProperty("rootPath");
    expect(fetchSpy).toHaveBeenCalledWith("/api/setup/git-readiness?workspaceId=ws-1", { cache: "no-store" });

    const continueButton = await screen.findByRole("button", { name: /continue start/i });
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);
    expect(onContinue).toHaveBeenCalledWith("start_brainstorm");
  });

  it("keeps the fresh blocker visible when repair recheck is still blocked", async () => {
    const stillBlocked = workspaceGitReadiness({
      repoLocalIdentity: { name: "Only Name" },
      blocker: { error: "identity_missing", message: "Email is still missing after repair." },
    });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/setup/git-identity/repair")) {
        return Response.json({ ok: false, error: "repair_partial_failure", message: "Partial write.", readiness: stillBlocked }, { status: 400 });
      }
      return Response.json(stillBlocked);
    }) as unknown as typeof fetch;

    render(<WorkflowGitRepairPanel blocker={blockedStart()} itemCode="ITEM-0001" itemTitle="Fresh install" onContinue={vi.fn()} />);
    const panel = screen.getByTestId("workflow-git-repair-panel");
    fireEvent.click(within(panel).getByRole("checkbox"));
    fireEvent.click(within(panel).getByRole("button", { name: /enter another identity/i }));
    fireEvent.change(within(panel).getByLabelText("Display name"), { target: { value: "Only Name" } });
    fireEvent.change(within(panel).getByLabelText("Email"), { target: { value: "repair@example.test" } });
    fireEvent.click(within(panel).getByRole("button", { name: /repair workspace/i }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(/Email is still missing after repair/i);
    expect(within(panel).getByRole("button", { name: /continue start/i })).toBeDisabled();
  });

  it("renders a missing-git stub instead of the identity form", () => {
    render(
      <WorkflowGitRepairPanel
        blocker={blockedStart({
          error: "git_not_installed",
          message: "Git is not installed.",
          readiness: workspaceGitReadiness({
            git: { installed: false },
            setupBlocked: true,
            workflowBlocked: true,
            blocker: { error: "git_not_installed", message: "Git is not installed." },
          }),
          repair: undefined,
        })}
        itemCode="ITEM-0001"
        itemTitle="Fresh install"
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText(/Install Git, then recheck setup/i)).toBeInTheDocument();
    expect(screen.queryByTestId("git-identity-form")).not.toBeInTheDocument();
  });
});
