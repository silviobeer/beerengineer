import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SonarSetupCard } from "@/components/setup/SonarSetupCard";
import { SetupSupportZone } from "@/components/setup/SetupSupportZone";
import { blockedReport, configView, idealRecommendedReport } from "./setupFixtures";

describe("SetupSupportZone", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it("AC-13 renders support material below the Gate Box as a separate zone", () => {
    render(<SetupSupportZone report={blockedReport()} />);
    expect(screen.getByTestId("setup-support-zone")).toBeInTheDocument();
    expect(screen.getByText("Installation options")).toBeInTheDocument();
  });

  it("AC-14 shows tool-specific remedies from the engine report", () => {
    render(<SetupSupportZone report={blockedReport()} />);
    expect(screen.getByText("brew install git")).toBeInTheDocument();
    expect(screen.getByText("Source documentation")).toHaveAttribute("href", "https://git-scm.com");
  });

  it("AC-15 command and agent prompt controls show copy feedback", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<SetupSupportZone report={blockedReport()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
  });

  it("AC-16 does not expose an automatic install action", () => {
    render(<SetupSupportZone report={blockedReport()} />);
    expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
    expect(screen.getByText(/never installs external tools automatically/i)).toBeInTheDocument();
  });

  it("shows Sonar config controls when review checks include Sonar", () => {
    render(<SetupSupportZone report={idealRecommendedReport()} configView={configView()} />);

    expect(screen.getByTestId("sonar-setup-card")).toBeInTheDocument();
    expect(screen.getByLabelText(/Default Sonar organization/i)).toHaveValue("beer");
    expect(screen.getByLabelText("SONAR_TOKEN")).toBeInTheDocument();
  });

  it("passes the setup workspace id into Supabase validation", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ ok: true, projectRef: "abcdefghijklmnopqrst", region: "eu" }));
    vi.stubGlobal("fetch", fetchSpy);
    const view = configView();
    render(<SetupSupportZone report={blockedReport()} configView={{
      ...view,
      supabase: { ...view.supabase, projectRef: undefined, region: undefined, tokenPresent: false },
    }} />);

    fireEvent.change(screen.getByLabelText("Supabase Management API token"), { target: { value: "sbp_token" } });
    fireEvent.change(screen.getByLabelText("Supabase project ref"), { target: { value: "abcdefghijklmnopqrst" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate Supabase" }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/setup/supabase/connect", expect.objectContaining({
        body: JSON.stringify({ workspaceId: "ws-1", token: "sbp_token", projectRef: "abcdefghijklmnopqrst" }),
      })),
    );
  });

  it("saves Sonar organization and token through setup proxies", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ ok: true, saved: ["llm.defaultSonarOrganization"], rejected: [], config: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<SetupSupportZone report={idealRecommendedReport()} configView={configView()} />);

    fireEvent.change(screen.getByLabelText(/Default Sonar organization/i), { target: { value: "new-org" } });
    fireEvent.click(screen.getByRole("button", { name: /save sonar config/i }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/settings/config", expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ llm: { defaultSonarOrganization: "new-org" } }),
      })),
    );

    fireEvent.change(screen.getByLabelText("SONAR_TOKEN"), { target: { value: "token-value" } });
    fireEvent.click(screen.getByRole("button", { name: /save sonar_token/i }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/settings/secrets", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ref: "SONAR_TOKEN", action: "replace", value: "token-value" }),
      })),
    );
  });

  it("shows a semantic output when Sonar config saves successfully", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, saved: ["llm.defaultSonarOrganization"], rejected: [], config: {} })));
    render(<SonarSetupCard defaultOrganization="beer" />);

    fireEvent.click(screen.getByRole("button", { name: /save sonar config/i }));

    await waitFor(() => expect(screen.getByText("Sonar organization saved.").tagName).toBe("OUTPUT"));
  });

  it("surfaces rejected Sonar config fields from partial-save responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { ok: false, saved: [], rejected: [{ field: "llm.defaultSonarOrganization", error: "Organization is invalid." }], config: {} },
      { status: 207 },
    )));
    render(<SonarSetupCard defaultOrganization="beer" />);

    fireEvent.click(screen.getByRole("button", { name: /save sonar config/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Organization is invalid."));
  });

  it("surfaces non-JSON Sonar config failures with the fallback message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 500 })));
    render(<SonarSetupCard defaultOrganization="beer" />);

    fireEvent.click(screen.getByRole("button", { name: /save sonar config/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Sonar config could not be saved."));
  });

  it("clears the token input after saving SONAR_TOKEN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, secret: { ref: "SONAR_TOKEN", present: true, active: true } })));
    render(<SonarSetupCard defaultOrganization="beer" />);

    fireEvent.change(screen.getByLabelText("SONAR_TOKEN"), { target: { value: "token-value" } });
    fireEvent.click(screen.getByRole("button", { name: /save sonar_token/i }));

    await waitFor(() => expect(screen.getByText("SONAR_TOKEN saved.").tagName).toBe("OUTPUT"));
    expect(screen.getByLabelText("SONAR_TOKEN")).toHaveValue("");
  });

  it("surfaces secret-store errors while keeping the token input intact", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, message: "Secret store unavailable." }, { status: 500 })));
    render(<SonarSetupCard defaultOrganization="beer" />);

    fireEvent.change(screen.getByLabelText("SONAR_TOKEN"), { target: { value: "token-value" } });
    fireEvent.click(screen.getByRole("button", { name: /save sonar_token/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Secret store unavailable."));
    expect(screen.getByLabelText("SONAR_TOKEN")).toHaveValue("token-value");
  });

  it("surfaces network errors from Sonar token saves", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    render(<SonarSetupCard defaultOrganization="beer" />);

    fireEvent.change(screen.getByLabelText("SONAR_TOKEN"), { target: { value: "token-value" } });
    fireEvent.click(screen.getByRole("button", { name: /save sonar_token/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network down"));
  });
});
