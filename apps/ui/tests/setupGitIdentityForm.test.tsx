import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitIdentityPanel } from "@/components/setup/GitIdentityPanel";
import { globalGitReadiness } from "./setupFixtures";

describe("Setup Git identity form", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves app-level identity through the setup API and rechecks readiness", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/setup/git-identity")) {
        return Response.json({ ok: true, saved: ["gitIdentityDefault"], rejected: [], config: {} });
      }
      return Response.json(globalGitReadiness({
        appDefaultIdentity: { displayName: "CLI Person", email: "cli@example.test", localOnly: false },
        effectiveIdentity: { source: "app-default", name: "CLI Person", email: "cli@example.test" },
        workflowBlocked: false,
      }));
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<GitIdentityPanel initialReadiness={globalGitReadiness()} />);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "CLI Person" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "cli@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: /save app identity/i }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/setup/git-identity", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ identity: { displayName: "CLI Person", email: "cli@example.test" } }),
      })),
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/setup/git-readiness", expect.objectContaining({ cache: "no-store" })));
    await screen.findByText(/beerengineer_ default: CLI Person <cli@example.test>/);
  });

  it("shows server field-specific validation errors", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      ok: false,
      error: "identity_invalid",
      errors: [
        { field: "displayName", message: "Display name is required." },
        { field: "email", message: "Email must look like name@example.com." },
      ],
    }, { status: 400 })) as unknown as typeof fetch;

    render(<GitIdentityPanel initialReadiness={globalGitReadiness()} />);
    fireEvent.click(screen.getByRole("button", { name: /save app identity/i }));

    await screen.findByText("Display name is required.");
    expect(screen.getByText("Email must look like name@example.com.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Fix the highlighted Git identity fields.");
  });

  it("warns for private local placeholder emails and says config is app-level", () => {
    render(<GitIdentityPanel initialReadiness={globalGitReadiness()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dev@local.beerengineer" } });

    expect(screen.getByText(/beerengineer_ config only/i)).toBeInTheDocument();
    expect(screen.getByTestId("git-local-only-warning")).toHaveTextContent(/private placeholder/i);
  });
});
