import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LogLine } from "../components/LogLine";
import { LOG_SEVERITY_LABELS } from "../lib/logs";

describe("LogLine (TC-6-04)", () => {
  it.each([0, 1, 2] as const)(
    "renders the canonical severity label and message for level %i",
    (level) => {
      const message = `severity-${level}-message`;
      render(<LogLine entry={{ level, message }} />);

      const labelEl = screen.getByTestId("log-line-level");
      expect(labelEl).toHaveTextContent(LOG_SEVERITY_LABELS[level]);
      expect(screen.getByTestId("log-line-message")).toHaveTextContent(message);
    }
  );

  it("falls back to the raw level value for unrecognized severities (EC-6-01)", () => {
    render(<LogLine entry={{ level: 99, message: "weird level" }} />);
    expect(screen.getByTestId("log-line-level")).toHaveTextContent("99");
    expect(screen.getByTestId("log-line-message")).toHaveTextContent(
      "weird level"
    );
  });

  it("renders HTML special characters as escaped text (EC-6-02)", () => {
    render(
      <LogLine entry={{ level: 0, message: "<script>alert('x')</script>" }} />
    );
    const messageEl = screen.getByTestId("log-line-message");
    expect(messageEl).toHaveTextContent("<script>alert('x')</script>");
    expect(messageEl.querySelector("script")).toBeNull();
  });
});
