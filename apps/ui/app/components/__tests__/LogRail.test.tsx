import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogRail from "../LogRail";
import {
  logsAllSeverities,
  logsEmpty,
  logsEngineEquivalent,
  logsOnlyHigh,
  logsOnlyLow,
  logsUnordered,
} from "./fixtures";

function getLineByMessage(message: string) {
  const lines = screen.queryAllByTestId("log-line");
  return lines.find((el) => el.textContent?.includes(message)) ?? null;
}

describe("LogRail", () => {
  // TC-01
  it("renders log lines in chronological order even when input is unordered", () => {
    render(<LogRail logs={logsUnordered} />);
    const rendered = screen.getAllByTestId("log-line");
    expect(rendered).toHaveLength(5);
    // The earliest timestamp in logsUnordered is u-info at T+0; latest is u-warn-late at T+4.
    expect(rendered[0]).toHaveTextContent("u-info");
    expect(rendered[rendered.length - 1]).toHaveTextContent("u-warn-late");

    // Confirm strict ascending adjacency by timestamps in DOM.
    const stamps = rendered.map((el) =>
      within(el).getByTestId("log-line-timestamp").textContent
    );
    const sorted = [...stamps].sort();
    expect(stamps).toEqual(sorted);
  });

  // TC-02
  it("renders a severity tag for every log line", () => {
    render(<LogRail logs={logsAllSeverities} />);
    const tags = screen.getAllByTestId("log-line-severity");
    expect(tags).toHaveLength(4);
    const expected = new Set(["DEBUG", "INFO", "WARN", "ERROR"]);
    for (const tag of tags) {
      const text = (tag.textContent ?? "").trim();
      expect(text.length).toBeGreaterThan(0);
      expect(expected.has(text)).toBe(true);
    }
  });

  // TC-03
  it("renders a per-row timestamp matching the source value", () => {
    render(<LogRail logs={logsAllSeverities} />);
    const lines = screen.getAllByTestId("log-line");
    // Build expected map: severity (uppercase) -> formatted HH:MM:SS from fixture.
    const expectations: Record<string, string> = {
      DEBUG: "10:30:00",
      WARN: "10:30:01",
      ERROR: "10:30:02",
      INFO: "10:30:03",
    };
    for (const line of lines) {
      const sev = within(line).getByTestId("log-line-severity").textContent ?? "";
      const ts = within(line).getByTestId("log-line-timestamp").textContent ?? "";
      expect(ts).toBe(expectations[sev.trim()]);
    }
  });

  // TC-04
  it("exposes exactly two filter controls — Alles and Wichtig", () => {
    render(<LogRail logs={logsAllSeverities} />);
    const group = screen.getByTestId("log-filter");
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    const labels = buttons.map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual(["Alles", "Wichtig"]);
  });

  // TC-05
  it("places the filter control before the log list in DOM order", () => {
    render(<LogRail logs={logsAllSeverities} />);
    const filter = screen.getByTestId("log-filter");
    const list = screen.getByTestId("log-list");
    const position = filter.compareDocumentPosition(list);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // TC-06
  it("defaults to Alles selected on initial render", () => {
    render(<LogRail logs={logsAllSeverities} />);
    const alles = screen.getByTestId("log-filter-alles");
    const wichtig = screen.getByTestId("log-filter-wichtig");
    expect(alles).toHaveAttribute("aria-pressed", "true");
    expect(wichtig).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByTestId("log-line")).toHaveLength(4);
  });

  // TC-07
  it("Alles shows all four lines, including after toggling Wichtig and back", async () => {
    const user = userEvent.setup();
    render(<LogRail logs={logsAllSeverities} />);
    expect(screen.getAllByTestId("log-line")).toHaveLength(4);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    expect(screen.getAllByTestId("log-line")).toHaveLength(2);
    await user.click(screen.getByTestId("log-filter-alles"));
    expect(screen.getAllByTestId("log-line")).toHaveLength(4);
  });

  // TC-08
  it("Wichtig retains exactly the WARN and ERROR lines with severity tags", async () => {
    const user = userEvent.setup();
    render(<LogRail logs={logsAllSeverities} />);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(2);
    const sevs = lines.map((l) =>
      (within(l).getByTestId("log-line-severity").textContent ?? "").trim()
    );
    expect(new Set(sevs)).toEqual(new Set(["WARN", "ERROR"]));
  });

  // TC-09
  it("Wichtig removes DEBUG and INFO lines from the rendered list", async () => {
    const user = userEvent.setup();
    render(<LogRail logs={logsAllSeverities} />);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    expect(getLineByMessage("debug-1")).toBeNull();
    expect(getLineByMessage("info-1")).toBeNull();
  });

  // TC-10
  it("engine token CRITICAL is treated as high-severity under Wichtig", async () => {
    const user = userEvent.setup();
    render(<LogRail logs={logsEngineEquivalent} />);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("critical-line");
    expect(lines[0]).toHaveTextContent("CRITICAL");
  });

  // TC-11
  it("engine token TRACE is treated as low-severity and is hidden under Wichtig", async () => {
    const user = userEvent.setup();
    render(<LogRail logs={logsEngineEquivalent} />);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    expect(getLineByMessage("trace-line")).toBeNull();
  });

  // TC-12
  it("Wichtig with all-high fixture shows all lines and no empty state", async () => {
    const user = userEvent.setup();
    render(<LogRail logs={logsOnlyHigh} />);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    expect(screen.getAllByTestId("log-line")).toHaveLength(2);
    expect(screen.queryByTestId("log-rail-empty")).toBeNull();
  });

  // TC-13
  it("filtered Wichtig results remain in chronological order", async () => {
    const user = userEvent.setup();
    render(<LogRail logs={logsUnordered} />);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    const lines = screen.getAllByTestId("log-line");
    // logsUnordered has WARN at T+1, ERROR at T+2, WARN at T+4 → 3 high-severity lines.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent("u-warn-early");
    expect(lines[1]).toHaveTextContent("u-error");
    expect(lines[2]).toHaveTextContent("u-warn-late");
  });

  // TC-14
  it("empty state is visible when log array is empty", () => {
    render(<LogRail logs={logsEmpty} />);
    const empty = screen.getByTestId("log-rail-empty");
    expect(empty).toBeInTheDocument();
    expect(empty).toBeVisible();
    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
  });

  // TC-15
  it("empty state appears under Wichtig when no lines match, and clears on Alles", async () => {
    const user = userEvent.setup();
    render(<LogRail logs={logsOnlyLow} />);
    expect(screen.getAllByTestId("log-line")).toHaveLength(2);
    expect(screen.queryByTestId("log-rail-empty")).toBeNull();

    await user.click(screen.getByTestId("log-filter-wichtig"));
    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
    expect(screen.getByTestId("log-rail-empty")).toBeVisible();

    await user.click(screen.getByTestId("log-filter-alles"));
    expect(screen.getAllByTestId("log-line")).toHaveLength(2);
    expect(screen.queryByTestId("log-rail-empty")).toBeNull();
  });

  // TC-16 (component-level proxy for the e2e flow — toggling on a rendered instance)
  it("user can toggle filters end-to-end and observe list change", async () => {
    const user = userEvent.setup();
    render(<LogRail logs={logsAllSeverities} />);
    expect(screen.getByTestId("log-filter-alles")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getAllByTestId("log-line")).toHaveLength(4);

    await user.click(screen.getByTestId("log-filter-wichtig"));
    expect(screen.getByTestId("log-filter-wichtig")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getAllByTestId("log-line")).toHaveLength(2);

    await user.click(screen.getByTestId("log-filter-alles"));
    expect(screen.getAllByTestId("log-line")).toHaveLength(4);
  });

  // EC-01
  it("handles two log lines sharing identical timestamps deterministically", () => {
    const sameTs = "2024-01-15T15:00:00Z";
    const logs = [
      { id: "a", timestamp: sameTs, severity: "INFO", message: "first" },
      { id: "b", timestamp: sameTs, severity: "INFO", message: "second" },
    ];
    render(<LogRail logs={logs} />);
    const rendered = screen.getAllByTestId("log-line");
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toHaveTextContent("first");
    expect(rendered[1]).toHaveTextContent("second");
  });

  // EC-02
  it("filter state survives a log data refresh", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LogRail logs={logsAllSeverities} />);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    expect(screen.getAllByTestId("log-line")).toHaveLength(2);

    const updated = [
      ...logsAllSeverities,
      { id: "new-low", timestamp: "2024-01-15T10:30:10Z", severity: "DEBUG", message: "new-debug" },
      { id: "new-high", timestamp: "2024-01-15T10:30:11Z", severity: "ERROR", message: "new-error" },
    ];
    rerender(<LogRail logs={updated} />);
    expect(screen.getByTestId("log-filter-wichtig")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const lines = screen.getAllByTestId("log-line");
    // 2 originals (WARN, ERROR) + 1 new ERROR = 3
    expect(lines).toHaveLength(3);
    expect(getLineByMessage("new-debug")).toBeNull();
    expect(getLineByMessage("new-error")).not.toBeNull();
  });
});
