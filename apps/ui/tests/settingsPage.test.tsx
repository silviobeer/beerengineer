import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppSettingsPage } from "@/components/settings/AppSettingsPage";
import { blockedReport, configView } from "./setupFixtures";

describe("AppSettingsPage", () => {
  it("AC-1 is reachable through visible settings navigation", () => {
    render(<AppSettingsPage report={blockedReport()} configView={configView()} />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("AC-2 shows app-wide setup, config, secrets, and optional services sections", () => {
    render(<AppSettingsPage report={blockedReport()} configView={configView()} />);
    expect(screen.getAllByText("Setup status").length).toBeGreaterThan(0);
    expect(screen.getAllByText("App config").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Secrets").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Optional services").length).toBeGreaterThan(0);
  });

  it("AC-3 sections are directly selectable and not wizard locked", () => {
    render(<AppSettingsPage report={blockedReport()} configView={configView()} />);
    expect(screen.getByRole("link", { name: "Secrets" })).toHaveAttribute("href", "#secrets");
    expect(screen.queryByText(/Step 3 of 5/)).not.toBeInTheDocument();
  });

  it("AC-4 excludes workspace and project settings as editable sections", () => {
    render(<AppSettingsPage report={blockedReport()} configView={configView()} />);
    expect(screen.queryByRole("heading", { name: /workspace settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /project settings/i })).not.toBeInTheDocument();
  });
});
