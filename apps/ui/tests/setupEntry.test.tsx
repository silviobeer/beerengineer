import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetupWizardShell } from "@/components/setup/SetupWizardShell";
import { Topbar } from "@/components/Topbar";
import { blockedReport } from "./setupFixtures";

describe("Setup entry", () => {
  it("AC-1 incomplete setup has a visible /setup entry", () => {
    render(<SetupWizardShell report={blockedReport()} />);
    expect(screen.getByText("/setup")).toBeInTheDocument();
    expect(screen.getByText("Setup wizard")).toBeInTheDocument();
  });

  it("AC-2 exposes visible Setup and Settings navigation entries", () => {
    render(<Topbar />);
    expect(screen.getByRole("link", { name: "Setup" })).toHaveAttribute("href", "/setup");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("AC-3 remains usable through the printed setup URL", () => {
    render(<SetupWizardShell report={blockedReport()} />);
    expect(screen.getByText("/setup")).toBeVisible();
  });

  it("AC-4 renders engine-unreachable as an app-level blocker", () => {
    render(<SetupWizardShell report={null} error="Engine is unreachable" />);
    expect(screen.getByText("App-level setup blocker")).toBeInTheDocument();
    expect(screen.getByText("Engine is unreachable")).toBeInTheDocument();
  });
});
