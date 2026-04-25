import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SSEConnectionManager } from "../../lib/sse/SSEContext";
import { MockEventSource, makeMockEventSourceFactory } from "../../lib/sse/mockEventSource";
import BoardCard from "../BoardCard";

function fireWorkspaceEvent(payload: { id: string } & Record<string, unknown>) {
  const ws = MockEventSource.instances.find((es) =>
    es.url.startsWith("/events?workspace=")
  );
  if (!ws) throw new Error("No workspace EventSource registered");
  act(() => {
    ws.simulateEvent("state-change", payload);
  });
}

function renderBoard(
  initialItems: Array<{ id: string; status?: string; attention?: boolean; step?: number }>,
  options: { showMiniStepper?: boolean } = {}
) {
  const factory = makeMockEventSourceFactory();
  const utils = render(
    <SSEConnectionManager
      workspaceKey="ws-a"
      eventSourceFactory={factory}
      initialItems={initialItems}
    >
      {initialItems.map((it) => (
        <BoardCard
          key={it.id}
          itemId={it.id}
          showMiniStepper={options.showMiniStepper}
        />
      ))}
    </SSEConnectionManager>
  );
  return utils;
}

describe("BoardCard live updates via SSE", () => {
  afterEach(() => {
    MockEventSource.reset();
  });

  // TC-01
  it("attention-dot appears when SSE delivers attention:true", () => {
    renderBoard([{ id: "i-1", status: "running", attention: false }]);
    expect(screen.queryByTestId("attention-dot")).toBeNull();
    fireWorkspaceEvent({ id: "i-1", attention: true });
    expect(screen.getByTestId("attention-dot")).toBeInTheDocument();
  });

  // TC-02
  it("attention-dot disappears when SSE delivers attention:false", () => {
    renderBoard([{ id: "i-1", status: "running", attention: true }]);
    expect(screen.getByTestId("attention-dot")).toBeInTheDocument();
    fireWorkspaceEvent({ id: "i-1", attention: false });
    expect(screen.queryByTestId("attention-dot")).toBeNull();
  });

  // TC-03
  it("status chip text updates via SSE", () => {
    renderBoard([{ id: "i-1", status: "running" }]);
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Running");
    fireWorkspaceEvent({ id: "i-1", status: "review" });
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Review");
  });

  // TC-04
  it("mini-stepper active segment advances via SSE", () => {
    renderBoard([{ id: "i-1", step: 1 }], { showMiniStepper: true });
    const segments = screen.getAllByTestId("mini-stepper-segment");
    expect(segments[0]).toHaveAttribute("data-active", "true");
    expect(segments[1]).toHaveAttribute("data-active", "false");

    fireWorkspaceEvent({ id: "i-1", step: 2 });

    const after = screen.getAllByTestId("mini-stepper-segment");
    expect(after[0]).toHaveAttribute("data-active", "false");
    expect(after[1]).toHaveAttribute("data-active", "true");
  });

  // TC-15 — no optimistic chip change when an action button is clicked
  it("status chip does not change before SSE event when an action button is clicked", async () => {
    const user = userEvent.setup();
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running", attention: true }]}
      >
        <BoardCard
          itemId="i-1"
          actions={[{ name: "approve", label: "Approve", onClick: () => {} }]}
        />
      </SSEConnectionManager>
    );

    expect(screen.getByTestId("status-chip")).toHaveTextContent("Running");
    expect(screen.getByTestId("attention-dot")).toBeInTheDocument();

    await user.click(screen.getByTestId("card-action-approve"));

    expect(screen.getByTestId("status-chip")).toHaveTextContent("Running");
    expect(screen.getByTestId("attention-dot")).toBeInTheDocument();
  });

  // TC-21 — final state wins after rapid sequential events
  it("rapid sequential SSE events apply in order; final state wins", () => {
    renderBoard([{ id: "i-1", status: "running" }]);
    fireWorkspaceEvent({ id: "i-1", status: "review" });
    fireWorkspaceEvent({ id: "i-1", status: "done" });
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Done");
  });

  // EC-03 — partial payload missing 'step' must not change step
  it("partial payload (missing step) leaves prior step unchanged", () => {
    renderBoard([{ id: "i-1", status: "running", step: 2 }], { showMiniStepper: true });
    let segments = screen.getAllByTestId("mini-stepper-segment");
    expect(segments[1]).toHaveAttribute("data-active", "true");

    fireWorkspaceEvent({ id: "i-1", status: "review" });

    segments = screen.getAllByTestId("mini-stepper-segment");
    expect(segments[1]).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Review");
  });

  // EC-04 — event for unknown item must not crash and not change other cards
  it("event for an unknown item id does not crash and does not change other cards", () => {
    renderBoard([{ id: "i-1", status: "running" }]);
    fireWorkspaceEvent({ id: "ghost", status: "done" });
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Running");
  });
});
