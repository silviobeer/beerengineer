import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { LogRail } from "../components/LogRail";
import { LOG_SEVERITY_LABELS, type LogEntry } from "../lib/logs";

const FX_LOG_MIXED: LogEntry[] = [
  { id: "l0", level: 0, message: "Critical shutdown" },
  { id: "l1", level: 1, message: "Warning threshold exceeded" },
  { id: "l2", level: 2, message: "Info: task started" },
];

const FX_LOG_NO_LEVEL_0: LogEntry[] = [
  { id: "w1", level: 1, message: "Warn only" },
  { id: "i1", level: 2, message: "Info only" },
];

describe("LogRail snapshot rendering", () => {
  it("TC-6-01: renders all snapshot entries (one per level)", () => {
    render(<LogRail logs={FX_LOG_MIXED} />);
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(3);
    expect(screen.getByText("Critical shutdown")).toBeInTheDocument();
    expect(screen.getByText("Warning threshold exceeded")).toBeInTheDocument();
    expect(screen.getByText("Info: task started")).toBeInTheDocument();
  });

  it("TC-6-02: appends new entries after the snapshot, preserving order", () => {
    const initial: LogEntry[] = [
      { id: "a", level: 0, message: "message A" },
      { id: "b", level: 1, message: "message B" },
    ];
    const { rerender } = render(<LogRail logs={initial} />);
    expect(screen.getAllByTestId("log-line")).toHaveLength(2);

    const pushed: LogEntry[] = [
      ...initial,
      { id: "c", level: 2, message: "message C" },
    ];
    rerender(<LogRail logs={pushed} />);

    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(3);
    const messages = lines.map((line) =>
      within(line).getByTestId("log-line-message").textContent
    );
    expect(messages).toEqual(["message A", "message B", "message C"]);
  });
});

describe("LogRail filter (TC-6-05, TC-6-06, TC-6-07, TC-6-08)", () => {
  it("TC-6-05: 'Alles' (default) shows entries at all levels", () => {
    render(<LogRail logs={FX_LOG_MIXED} />);
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(3);
    const levels = lines.map((line) => line.getAttribute("data-level"));
    expect(levels).toEqual(["0", "1", "2"]);
  });

  it("TC-6-06: 'Wichtig' shows only level-0; toggling back to 'Alles' restores all", () => {
    render(<LogRail logs={FX_LOG_MIXED} />);

    fireEvent.click(screen.getByTestId("log-filter-wichtig"));
    let lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute("data-level")).toBe("0");
    expect(within(lines[0]).getByTestId("log-line-level")).toHaveTextContent(
      LOG_SEVERITY_LABELS[0]
    );

    fireEvent.click(screen.getByTestId("log-filter-alles"));
    lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(3);
  });

  it("TC-6-07: filter buttons reflect the active selection via aria-pressed", () => {
    render(<LogRail logs={FX_LOG_MIXED} />);

    const alles = screen.getByTestId("log-filter-alles");
    const wichtig = screen.getByTestId("log-filter-wichtig");

    expect(alles).toHaveAttribute("aria-pressed", "true");
    expect(wichtig).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(wichtig);
    expect(wichtig).toHaveAttribute("aria-pressed", "true");
    expect(alles).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(alles);
    expect(alles).toHaveAttribute("aria-pressed", "true");
    expect(wichtig).toHaveAttribute("aria-pressed", "false");
  });

  it("TC-6-08: 'Wichtig' over a snapshot without level-0 entries shows the empty placeholder (EC-6-03)", () => {
    render(<LogRail logs={FX_LOG_NO_LEVEL_0} />);
    fireEvent.click(screen.getByTestId("log-filter-wichtig"));

    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
    expect(screen.getByTestId("log-rail-empty")).toBeVisible();
  });
});

describe("LogRail filter persistence on live updates (TC-6-09, TC-6-10)", () => {
  it("TC-6-09: keeps 'Wichtig' active and hides a non-matching live arrival", () => {
    const initial: LogEntry[] = [{ id: "x", level: 0, message: "critical" }];
    const { rerender } = render(<LogRail logs={initial} />);

    fireEvent.click(screen.getByTestId("log-filter-wichtig"));
    expect(screen.getByTestId("log-filter-wichtig")).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    const pushed: LogEntry[] = [
      ...initial,
      { id: "y", level: 1, message: "non-matching warn" },
    ];
    rerender(<LogRail logs={pushed} />);

    expect(screen.getByTestId("log-filter-wichtig")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByText("non-matching warn")).not.toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
  });

  it("TC-6-10: matching live arrival is visible without filter toggle and existing non-matches stay hidden", () => {
    const { rerender } = render(<LogRail logs={FX_LOG_NO_LEVEL_0} />);

    fireEvent.click(screen.getByTestId("log-filter-wichtig"));
    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
    expect(screen.getByTestId("log-rail-empty")).toBeInTheDocument();

    const pushed: LogEntry[] = [
      ...FX_LOG_NO_LEVEL_0,
      { id: "boom", level: 0, message: "matching critical" },
    ];
    rerender(<LogRail logs={pushed} />);

    expect(screen.getByTestId("log-filter-wichtig")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(1);
    expect(within(lines[0]).getByTestId("log-line-message")).toHaveTextContent(
      "matching critical"
    );
    expect(screen.queryByText("Warn only")).not.toBeInTheDocument();
    expect(screen.queryByText("Info only")).not.toBeInTheDocument();
  });
});

describe("LogRail empty state (TC-6-12, TC-6-13)", () => {
  it("TC-6-12: renders the empty placeholder when the logs array is empty", () => {
    render(<LogRail logs={[]} />);
    expect(screen.getByTestId("log-rail-empty")).toBeVisible();
    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
  });

  it("TC-6-13: does not render the empty placeholder when at least one log entry is present", () => {
    render(<LogRail logs={[{ level: 0, message: "only entry" }]} />);
    expect(screen.queryByTestId("log-rail-empty")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("log-line")).toHaveLength(1);
  });
});
