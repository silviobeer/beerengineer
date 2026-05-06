import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitIdentityPanel } from "@/components/setup/GitIdentityPanel";
import { workspaceGitReadiness } from "./setupFixtures";

describe("Setup workspace Git repair", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires confirmation and sends only workspace identity fields", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/setup/git-identity/repair")) {
        return Response.json({
          ok: true,
          actions: ["git config --local user.name", "git config --local user.email"],
          readiness: workspaceGitReadiness({
            repoLocalIdentity: { name: "Repair Person", email: "repair@example.test" },
            effectiveIdentity: { source: "repo-local", name: "Repair Person", email: "repair@example.test" },
            ready: true,
            workflowBlocked: false,
            availableActions: [],
          }),
        });
      }
      return Response.json(workspaceGitReadiness({
        repoLocalIdentity: { name: "Repair Person", email: "repair@example.test" },
        effectiveIdentity: { source: "repo-local", name: "Repair Person", email: "repair@example.test" },
        ready: true,
        workflowBlocked: false,
        availableActions: [],
      }));
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<GitIdentityPanel initialReadiness={workspaceGitReadiness()} workspace={{ id: "ws-1", key: "demo", name: "Demo" }} />);
    const repair = screen.getByTestId("git-workspace-repair");
    const apply = within(repair).getByRole("button", { name: /apply to this workspace/i });
    expect(apply).toBeDisabled();

    fireEvent.click(within(repair).getByRole("checkbox"));
    fireEvent.change(within(repair).getByLabelText("Display name"), { target: { value: "Repair Person" } });
    fireEvent.change(within(repair).getByLabelText("Email"), { target: { value: "repair@example.test" } });
    fireEvent.click(within(repair).getByRole("button", { name: /apply to this workspace/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/setup/git-identity/repair", expect.objectContaining({ method: "POST" })));
    const repairCall = fetchSpy.mock.calls.find((call) => String(call[0]).includes("/api/setup/git-identity/repair"));
    const body = JSON.parse(String((repairCall?.[1] as RequestInit).body));
    expect(body).toEqual({
      workspaceId: "ws-1",
      workspaceKey: "demo",
      identity: { displayName: "Repair Person", email: "repair@example.test" },
    });
    expect(body).not.toHaveProperty("path");
    expect(body).not.toHaveProperty("rootPath");
    await screen.findByText(/Repo-local identity: Repair Person <repair@example.test>/);
  });

  it("shows partial failure state from the fresh repair response", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      ok: false,
      error: "repair_partial_failure",
      message: "Workspace Git identity repair did not fully apply.",
      actions: ["git config --local user.name"],
      readiness: workspaceGitReadiness({
        repoLocalIdentity: { name: "Only Name" },
        availableActions: ["repair_workspace_identity"],
      }),
    }, { status: 400 })) as unknown as typeof fetch;

    render(<GitIdentityPanel initialReadiness={workspaceGitReadiness()} workspace={{ id: "ws-1", key: "demo", name: "Demo" }} />);
    const repair = screen.getByTestId("git-workspace-repair");
    fireEvent.click(within(repair).getByRole("checkbox"));
    fireEvent.change(within(repair).getByLabelText("Display name"), { target: { value: "Only Name" } });
    fireEvent.change(within(repair).getByLabelText("Email"), { target: { value: "repair@example.test" } });
    fireEvent.click(within(repair).getByRole("button", { name: /apply to this workspace/i }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(/partially applied/i);
    expect(screen.getByText("Only Name (email missing)")).toBeInTheDocument();
  });
});
