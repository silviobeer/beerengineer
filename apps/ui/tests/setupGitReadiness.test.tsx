import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GitIdentityPanel } from "@/components/setup/GitIdentityPanel";
import { SetupWizardShell } from "@/components/setup/SetupWizardShell";
import { blockedReport, configView, globalGitReadiness, workspaceGitReadiness } from "./setupFixtures";

describe("Setup Git readiness shell", () => {
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
});
