import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitIdentityPanel } from "@/components/setup/GitIdentityPanel";
import { SetupWizardShell } from "@/components/setup/SetupWizardShell";
import { blockedReport, configView, globalGitReadiness, workspaceGitReadiness } from "./setupFixtures";

describe("Setup Git readiness shell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the Git step inside the existing setup wizard patterns", () => {
    render(<SetupWizardShell report={blockedReport()} configView={configView()} gitReadiness={globalGitReadiness()} />);

    expect(screen.getByText("Setup wizard")).toBeInTheDocument();
    expect(screen.getByTestId("setup-stepper")).toBeInTheDocument();
    expect(screen.getByTestId("setup-gate-box")).toBeInTheDocument();
    expect(screen.getByTestId("git-identity-panel")).toBeInTheDocument();
    expect(screen.getAllByText("Git").length).toBeGreaterThan(0);
  });

  it("explains local checkpoints without exposing GitHub publishing controls", () => {
    render(<GitIdentityPanel initialReadiness={globalGitReadiness()} />);

    expect(screen.getByText(/local Git commit checkpoints/i)).toBeInTheDocument();
    expect(screen.getByText(/does not create GitHub remotes, push branches, or open pull requests/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /push|pull request|github/i })).not.toBeInTheDocument();
  });

  it("renders global readiness when no workspace is selected", () => {
    render(<GitIdentityPanel initialReadiness={globalGitReadiness({
      globalIdentity: { name: "Global Person", email: "global@example.test" },
      effectiveIdentity: { source: "global", name: "Global Person", email: "global@example.test" },
      workflowBlocked: false,
    })} />);

    expect(screen.getByText(/Effective source/i)).toBeInTheDocument();
    expect(screen.getByText(/Global Git identity: Global Person <global@example.test>/)).toBeInTheDocument();
    expect(screen.queryByText("Repo-local")).not.toBeInTheDocument();
    expect(screen.getByText(/Global Git identity is ready for workflows/i)).toBeInTheDocument();
  });

  it("renders workspace readiness source precedence and repo-local authority", () => {
    render(<GitIdentityPanel initialReadiness={workspaceGitReadiness({
      repoLocalIdentity: { name: "Repo Person", email: "repo@example.test" },
      effectiveIdentity: { source: "repo-local", name: "Repo Person", email: "repo@example.test" },
      ready: true,
      workflowBlocked: false,
      availableActions: [],
    })} workspace={{ id: "ws-1", key: "demo", name: "Demo" }} />);

    const rows = screen.getByTestId("git-source-rows");
    expect(within(rows).getByText("Repo-local")).toBeInTheDocument();
    expect(within(rows).getByText(/Repo-local identity: Repo Person <repo@example.test>/)).toBeInTheDocument();
    expect(screen.getByText(/Repo-local identity is respected and remains authoritative/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply to this workspace/i })).not.toBeInTheDocument();
  });

  it("rechecks global readiness after app identity save when setup workspace has no usable root", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/setup/git-identity") {
        return Response.json({ ok: true });
      }
      if (url === "/api/setup/git-readiness") {
        return Response.json(globalGitReadiness({
          appDefaultIdentity: {
            displayName: "QA Browser User",
            email: "qa-browser@local.beerengineer",
            localOnly: true,
          },
          effectiveIdentity: {
            source: "app-default",
            name: "QA Browser User",
            email: "qa-browser@local.beerengineer",
            localOnly: true,
          },
          workflowBlocked: false,
          blocker: undefined,
        }));
      }
      return Response.json({ ok: false, error: "unexpected_request", url }, { status: 500 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<GitIdentityPanel initialReadiness={globalGitReadiness()} workspace={{ id: "rootless-ws", key: "rootless", name: "Rootless" }} />);

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "QA Browser User" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "qa-browser@local.beerengineer" } });
    fireEvent.click(screen.getByRole("button", { name: /save app identity/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/setup/git-readiness", expect.objectContaining({ cache: "no-store" })));
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "/api/setup/git-readiness?workspaceId=rootless-ws",
      expect.anything(),
    );
    await screen.findByText(/beerengineer_ default: QA Browser User <qa-browser@local.beerengineer>/);
    expect(screen.queryByText(/Git readiness could not be refreshed/i)).not.toBeInTheDocument();
  });
});
