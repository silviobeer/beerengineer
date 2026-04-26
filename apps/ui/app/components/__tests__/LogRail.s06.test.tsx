import { describe, it, expect } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogRail, { type LogLine } from "../LogRail";
import {
  LogStreamProvider,
  createFakeLogStream,
  type SSELogEvent,
} from "../../lib/logStream";

const RUN_ID = "run-1";

const mixedSeverityLines: LogLine[] = [
  { id: "1", severity: "L0", timestamp: "2026-04-26T10:00:00Z", message: "Critical issue detected" },
  { id: "2", severity: "L1", timestamp: "2026-04-26T10:01:00Z", message: "Warning: disk space low" },
  { id: "3", severity: "L2", timestamp: "2026-04-26T10:02:00Z", message: "Info: job started" },
];

const l1AndL2OnlyLines: LogLine[] = [
  { id: "1", severity: "L1", timestamp: "2026-04-26T10:01:00Z", message: "Warning: disk space low" },
  { id: "2", severity: "L2", timestamp: "2026-04-26T10:02:00Z", message: "Info: job started" },
];

const sseL1LogEvent: SSELogEvent = {
  type: "log",
  data: { id: "sse-l1", severity: "L1", timestamp: "2026-04-26T10:05:00Z", message: "New SSE L1 line" },
};

const sseL0LogEvent: SSELogEvent = {
  type: "log",
  data: { id: "sse-l0", severity: "L0", timestamp: "2026-04-26T10:06:00Z", message: "New SSE L0 line" },
};

function renderWithStream(
  logs: LogLine[],
  currentRunId: string | null = RUN_ID,
) {
  const stream = createFakeLogStream();
  const utils = render(
    <LogStreamProvider value={stream}>
      <LogRail logs={logs} currentRunId={currentRunId} />
    </LogStreamProvider>,
  );
  return { ...utils, stream };
}

describe("LogRail S-06", () => {
  // TC-01: AC-S06-01
  it("renders severity tag, timestamp, and message for every line", () => {
    renderWithStream(mixedSeverityLines);
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const sev = within(line).getByTestId("log-line-severity").textContent ?? "";
      const ts = within(line).getByTestId("log-line-timestamp").textContent ?? "";
      const msg = within(line).getByTestId("log-line-message").textContent ?? "";
      expect(sev.trim().length).toBeGreaterThan(0);
      expect(ts.trim().length).toBeGreaterThan(0);
      expect(msg.trim().length).toBeGreaterThan(0);
    }
  });

  // TC-03: AC-S06-02 — SSE append, no visible reset
  it("appends an SSE-delivered log line without dropping existing rows", () => {
    const { stream } = renderWithStream([mixedSeverityLines[0]]);
    expect(screen.getAllByTestId("log-line")).toHaveLength(1);
    expect(screen.getByText("Critical issue detected")).toBeInTheDocument();

    act(() => {
      stream.emit(sseL1LogEvent);
    });

    expect(screen.getAllByTestId("log-line")).toHaveLength(2);
    expect(screen.getByText("Critical issue detected")).toBeInTheDocument();
    expect(screen.getByText("New SSE L1 line")).toBeInTheDocument();
    expect(screen.getByTestId("log-filter-alles")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("log-rail-empty")).toBeNull();
  });

  // TC-04: multiple SSE events appended in arrival order (timestamps are increasing)
  it("appends multiple SSE log events in arrival order", () => {
    const { stream } = renderWithStream([]);

    const events: SSELogEvent[] = [
      { type: "log", data: { id: "a", severity: "L2", timestamp: "2026-04-26T11:00:00Z", message: "first-info" } },
      { type: "log", data: { id: "b", severity: "L0", timestamp: "2026-04-26T11:00:01Z", message: "second-critical" } },
      { type: "log", data: { id: "c", severity: "L1", timestamp: "2026-04-26T11:00:02Z", message: "third-warn" } },
    ];

    act(() => {
      for (const event of events) stream.emit(event);
    });

    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent("first-info");
    expect(lines[1]).toHaveTextContent("second-critical");
    expect(lines[2]).toHaveTextContent("third-warn");
  });

  // TC-05: AC-S06-03 — Alles shows L0+L1+L2
  it("Alles filter renders all severity tiers", () => {
    renderWithStream(mixedSeverityLines);
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(3);
    const sevs = lines.map((l) => l.getAttribute("data-severity"));
    expect(new Set(sevs)).toEqual(new Set(["L0", "L1", "L2"]));
  });

  // TC-06: AC-S06-04 — Wichtig only L0
  it("Wichtig filter renders only L0 lines", async () => {
    const user = userEvent.setup();
    renderWithStream(mixedSeverityLines);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveAttribute("data-severity", "L0");
    expect(lines[0]).toHaveTextContent("Critical issue detected");
  });

  // TC-07: switching Alles -> Wichtig hides non-L0 in same render cycle
  it("switching from Alles to Wichtig immediately hides non-L0 lines", async () => {
    const user = userEvent.setup();
    renderWithStream(mixedSeverityLines);
    expect(screen.getAllByTestId("log-line")).toHaveLength(3);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveAttribute("data-severity", "L0");
  });

  // TC-08: AC-S06-05 — Wichtig active, no L0 → empty state
  it("shows visible empty state when Wichtig active and no L0 lines exist", async () => {
    const user = userEvent.setup();
    renderWithStream(l1AndL2OnlyLines);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    const empty = screen.getByTestId("log-rail-empty");
    expect(empty).toBeInTheDocument();
    expect(empty).toBeVisible();
    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
  });

  // TC-09: AC-S06-06 — empty array → empty state
  it("shows visible empty state when no log lines have been produced", () => {
    renderWithStream([]);
    const empty = screen.getByTestId("log-rail-empty");
    expect(empty).toBeInTheDocument();
    expect(empty).toBeVisible();
    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
  });

  // TC-10: WAVE-EXIT-GUARD — null currentRunId → inert placeholder
  it("renders inert placeholder when currentRunId is null", () => {
    const { stream } = renderWithStream([], null);
    expect(screen.getByTestId("log-rail-inert")).toBeInTheDocument();
    expect(screen.queryByTestId("log-filter")).toBeNull();
    expect(screen.queryByTestId("log-filter-alles")).toBeNull();
    expect(screen.queryByTestId("log-filter-wichtig")).toBeNull();
    expect(stream.subscriberCount()).toBe(0);
  });

  // TC-11 Part A: SSE L0 clears Wichtig empty state
  it("SSE L0 line clears the Wichtig empty state and renders the new line", async () => {
    const user = userEvent.setup();
    const { stream } = renderWithStream(l1AndL2OnlyLines);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    expect(screen.getByTestId("log-rail-empty")).toBeVisible();

    act(() => {
      stream.emit(sseL0LogEvent);
    });

    expect(screen.queryByTestId("log-rail-empty")).toBeNull();
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("New SSE L0 line");
    expect(lines[0]).toHaveAttribute("data-severity", "L0");
  });

  // TC-11 Part B: SSE L1 line under active Wichtig keeps empty state visible
  it("SSE L1 line under active Wichtig is hidden and empty state remains visible", async () => {
    const user = userEvent.setup();
    const { stream } = renderWithStream(l1AndL2OnlyLines);
    await user.click(screen.getByTestId("log-filter-wichtig"));
    expect(screen.getByTestId("log-rail-empty")).toBeVisible();

    act(() => {
      stream.emit(sseL1LogEvent);
    });

    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
    expect(screen.getByTestId("log-rail-empty")).toBeVisible();
  });

  // EC-01: unknown severity does not crash; excluded from Wichtig
  it("handles unrecognised severity values without crashing", async () => {
    const user = userEvent.setup();
    const logs: LogLine[] = [
      { id: "x1", severity: "L3", timestamp: "2026-04-26T10:00:00Z", message: "weird-3" },
      { id: "x2", severity: "L0", timestamp: "2026-04-26T10:00:01Z", message: "real-0" },
    ];
    renderWithStream(logs);
    expect(screen.getAllByTestId("log-line")).toHaveLength(2);

    await user.click(screen.getByTestId("log-filter-wichtig"));
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveAttribute("data-severity", "L0");
  });
});
