import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupSupportZone } from "@/components/setup/SetupSupportZone";
import { blockedReport } from "./setupFixtures";

describe("SetupSupportZone", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    vi.restoreAllMocks();
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
});
