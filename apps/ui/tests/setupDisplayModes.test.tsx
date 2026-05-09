import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitIdentityPanel } from "@/components/setup/GitIdentityPanel";
import { SecretsStubPanel } from "@/components/setup/SecretsStubPanel";
import { SetupWizardShell } from "@/components/setup/SetupWizardShell";
import { WorkspacePresencePanel } from "@/components/setup/WorkspacePresencePanel";
import {
  readSetupDisplayModeTelemetry,
  resetSetupDisplayModeTelemetry,
} from "@/lib/setupDisplayModes";
import { blockedReport, configView, globalGitReadiness } from "./setupFixtures";

function readyConfigView() {
  return configView();
}

describe("setup display modes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetSetupDisplayModeTelemetry();
  });

  it("renders git identity, workspace presence, and secrets stub from engine facts with zero fallback telemetry", () => {
    render(
      <SetupWizardShell
        report={blockedReport()}
        configView={readyConfigView()}
        gitReadiness={globalGitReadiness({
          effectiveIdentity: { source: "global", name: "Global User", email: "global@example.test" },
          globalIdentity: { name: "Global User", email: "global@example.test" },
          workflowBlocked: false,
          blocker: undefined,
        })}
      />,
    );

    expect(screen.getByTestId("git-identity-panel")).toHaveTextContent("Git identity readiness");
    expect(screen.getByTestId("workspace-presence-panel")).toHaveAttribute("data-mode", "ready");
    expect(screen.getByTestId("secrets-stub-panel")).toHaveAttribute("data-mode", "ready");
    expect(readSetupDisplayModeTelemetry()).toEqual({
      git_identity: 0,
      workspace_presence: 0,
      secrets_stub: 0,
      fallbackEvents: [],
      invalidEvents: [],
    });
  });

  it("uses present facts over conflicting raw details and falls back only for the missing panel", () => {
    const view = readyConfigView();
    render(
      <SetupWizardShell
        report={blockedReport()}
        configView={{
          ...view,
          config: {
            ...view.config,
            llm: {
              ...view.config.llm,
              apiKey: { ref: "ANTHROPIC_API_KEY", present: false },
            },
          },
          setupDisplayModes: {
            workspacePresence: view.setupDisplayModes?.workspacePresence,
          },
        }}
        gitReadiness={globalGitReadiness({
          effectiveIdentity: { source: "global", name: "Global User", email: "global@example.test" },
          globalIdentity: { name: "Global User", email: "global@example.test" },
          workflowBlocked: true,
          blocker: { error: "identity_missing", message: "conflicting raw blocker" },
          displayMode: {
            mode: "ready",
            detail: "Git identity ready from engine fact.",
            freshness: {
              strategy: "per_request",
              invalidatedBy: ["setup_recheck"],
            },
          },
        })}
      />,
    );

    expect(screen.getByTestId("workspace-presence-panel")).toHaveAttribute("data-mode", "ready");
    expect(screen.getByTestId("secrets-stub-panel")).toHaveAttribute("data-mode", "action-required");
    expect(screen.queryByRole("link", { name: "Open secrets settings" })).toBeInTheDocument();
    expect(readSetupDisplayModeTelemetry()).toEqual({
      git_identity: 0,
      workspace_presence: 0,
      secrets_stub: 1,
      fallbackEvents: [{ panel: "secrets_stub" }],
      invalidEvents: [],
    });
  });

  it("refreshes all three panels after setup recheck and allows a ready-to-action-required regression", async () => {
    const initialConfig = readyConfigView();
    const nextConfig = {
      ...initialConfig,
      setupDisplayModes: {
        workspacePresence: {
          mode: "action-required" as const,
          detail: "Workspace demo is unavailable on disk.",
          freshness: {
            strategy: "per_request" as const,
            invalidatedBy: ["setup_recheck", "workspace_changed"],
          },
        },
        secretsStub: {
          mode: "action-required" as const,
          detail: "Add ANTHROPIC_API_KEY before starting workflow runs.",
          freshness: {
            strategy: "per_request" as const,
            invalidatedBy: ["setup_recheck", "secret_metadata_changed"],
          },
        },
      },
    };
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/setup/recheck") return Response.json({ ok: true, report: blockedReport() });
      if (url === "/api/setup/config") return Response.json(nextConfig);
      if (url === "/api/setup/git-readiness") {
        return Response.json(globalGitReadiness({
          workflowBlocked: true,
          blocker: { error: "identity_missing", message: "Git identity is missing." },
          displayMode: {
            mode: "action-required",
            detail: "Git identity is missing.",
            freshness: {
              strategy: "per_request",
              invalidatedBy: ["setup_recheck", "git_identity_saved"],
            },
          },
        }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <SetupWizardShell
        report={blockedReport()}
        configView={initialConfig}
        gitReadiness={globalGitReadiness({
          effectiveIdentity: { source: "global", name: "Global User", email: "global@example.test" },
          globalIdentity: { name: "Global User", email: "global@example.test" },
          workflowBlocked: false,
          blocker: undefined,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));

    await waitFor(() => expect(screen.getByTestId("workspace-presence-panel")).toHaveAttribute("data-mode", "action-required"));
    expect(screen.getByTestId("secrets-stub-panel")).toHaveAttribute("data-mode", "action-required");
    await waitFor(() => expect(screen.getByTestId("git-identity-panel")).toHaveTextContent("Git identity is missing."));
  });

  it("updates workspace presence from fresh facts when the workspace changes", () => {
    const view = readyConfigView();
    const { rerender } = render(<WorkspacePresencePanel configView={view} />);

    expect(screen.getByTestId("workspace-presence-panel")).toHaveAttribute("data-mode", "ready");

    rerender(<WorkspacePresencePanel configView={{
      ...view,
      setupDisplayModes: {
        ...view.setupDisplayModes,
        workspacePresence: {
          mode: "action-required",
          detail: "Workspace demo is unavailable on disk.",
          freshness: {
            strategy: "per_request",
            invalidatedBy: ["setup_recheck", "workspace_changed"],
          },
        },
      },
    }} />);

    expect(screen.getByTestId("workspace-presence-panel")).toHaveAttribute("data-mode", "action-required");
  });

  it("updates the secrets stub from fresh facts when secret state changes", () => {
    const view = readyConfigView();
    const { rerender } = render(<SecretsStubPanel configView={view} />);

    expect(screen.getByTestId("secrets-stub-panel")).toHaveAttribute("data-mode", "ready");

    rerender(<SecretsStubPanel configView={{
      ...view,
      setupDisplayModes: {
        ...view.setupDisplayModes,
        secretsStub: {
          mode: "informational",
          detail: "Initialize app state before managing workflow secrets.",
          freshness: {
            strategy: "per_request",
            invalidatedBy: ["setup_recheck", "secret_metadata_changed"],
          },
        },
      },
    }} />);

    expect(screen.getByTestId("secrets-stub-panel")).toHaveAttribute("data-mode", "informational");
  });

  it("renders the invalid-data error path and records telemetry for unsupported modes", () => {
    const readiness = globalGitReadiness({
      displayMode: {
        mode: "unsupported-mode" as never,
        detail: "invalid",
        freshness: {
          strategy: "per_request",
          invalidatedBy: ["setup_recheck"],
        },
      },
    });

    render(<GitIdentityPanel initialReadiness={readiness} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Git panel mode data is invalid.");
    expect(readSetupDisplayModeTelemetry()).toEqual({
      git_identity: 0,
      workspace_presence: 0,
      secrets_stub: 0,
      fallbackEvents: [],
      invalidEvents: [{ panel: "git_identity", mode: "unsupported-mode" }],
    });
  });
});
