import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitIdentityPanel } from "@/components/setup/GitIdentityPanel";
import { globalGitReadiness, missingGitReadiness } from "./setupFixtures";

describe("Setup missing Git stub", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a not-configured stub instead of identity or repair forms", () => {
    render(<GitIdentityPanel initialReadiness={missingGitReadiness()} />);

    expect(screen.getByTestId("git-missing-stub")).toBeInTheDocument();
    expect(screen.getByText(/Install Git, then re-check/i)).toBeInTheDocument();
    expect(screen.queryByTestId("git-identity-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("git-workspace-repair")).not.toBeInTheDocument();
  });

  it("transitions to normal readiness after a successful recheck", async () => {
    globalThis.fetch = vi.fn(async () => Response.json(globalGitReadiness({
      git: { installed: true, version: "git version 2.47.0" },
      globalIdentity: { name: "Global Person", email: "global@example.test" },
      effectiveIdentity: { source: "global", name: "Global Person", email: "global@example.test" },
      workflowBlocked: false,
    }))) as unknown as typeof fetch;

    render(<GitIdentityPanel initialReadiness={missingGitReadiness()} />);
    fireEvent.click(screen.getByRole("button", { name: /re-check git/i }));

    await waitFor(() => expect(screen.queryByTestId("git-missing-stub")).not.toBeInTheDocument());
    expect(screen.getByTestId("git-identity-form")).toBeInTheDocument();
    expect(screen.getByText(/Global Git identity: Global Person <global@example.test>/)).toBeInTheDocument();
  });
});
