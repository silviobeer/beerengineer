import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SSEConnectionManager } from "../../lib/sse/SSEContext";
import { MockEventSource, makeMockEventSourceFactory } from "../../lib/sse/mockEventSource";
import Topbar from "../Topbar";
import BoardCard from "../BoardCard";
import ItemDetail from "../ItemDetail";
import { OFFLINE_BANNER_TEXT } from "../OfflineBanner";

function getWorkspaceSource() {
  const es = MockEventSource.instances.find((e) =>
    e.url.startsWith("/events?workspace=")
  );
  if (!es) throw new Error("No workspace EventSource");
  return es;
}

describe("Topbar offline banner", () => {
  afterEach(() => {
    MockEventSource.reset();
    vi.useRealTimers();
  });

  // TC-08 — banner appears in Board route topbar on SSE close
  it("appears in Board route topbar when SSE closes", () => {
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running", attention: true }]}
      >
        <Topbar attentionCount={1} />
        <BoardCard itemId="i-1" />
      </SSEConnectionManager>
    );
    expect(screen.queryByTestId("offline-banner")).toBeNull();

    act(() => {
      getWorkspaceSource().simulateClose();
    });

    const topbar = screen.getByTestId("topbar");
    expect(within(topbar).getByTestId("offline-banner")).toHaveTextContent(
      OFFLINE_BANNER_TEXT
    );
  });

  // TC-09 — banner appears in Item-Detail route topbar on SSE close
  it("appears in Item-Detail route topbar when SSE closes", () => {
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running" }]}
      >
        <Topbar attentionCount={0} />
        <ItemDetail itemId="i-1" runId={null} />
      </SSEConnectionManager>
    );
    act(() => {
      getWorkspaceSource().simulateClose();
    });
    const topbar = screen.getByTestId("topbar");
    expect(within(topbar).getByTestId("offline-banner")).toHaveTextContent(
      OFFLINE_BANNER_TEXT
    );
  });

  // TC-13 — SSE data emitted after disconnect is silently dropped
  it("post-disconnect SSE data is dropped; cards stay frozen and banner remains", () => {
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[
          { id: "i-1", status: "running", attention: true },
          { id: "i-2", status: "review", attention: false },
        ]}
      >
        <Topbar attentionCount={1} />
        <BoardCard itemId="i-1" />
        <BoardCard itemId="i-2" />
      </SSEConnectionManager>
    );

    const ws = getWorkspaceSource();
    act(() => {
      ws.simulateClose();
    });
    expect(screen.getByTestId("offline-banner")).toHaveTextContent(OFFLINE_BANNER_TEXT);

    act(() => {
      ws.simulateEvent("state-change", { id: "i-1", status: "done", attention: false });
    });
    const cards = screen.getAllByTestId("board-card");
    const i1 = cards.find((c) => c.getAttribute("data-item-id") === "i-1")!;
    expect(within(i1).getByTestId("status-chip")).toHaveTextContent("Running");
    expect(within(i1).getByTestId("attention-dot")).toBeInTheDocument();
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
  });

  // TC-14 — banner persists; no self-clearing timer
  it("banner persists across long fake-timer advance, no reconnect EventSource is opened", () => {
    vi.useFakeTimers();
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running" }]}
      >
        <Topbar attentionCount={0} />
        <BoardCard itemId="i-1" />
      </SSEConnectionManager>
    );
    const wsCountBefore = MockEventSource.instances.filter((e) =>
      e.url.startsWith("/events?workspace=")
    ).length;
    act(() => {
      getWorkspaceSource().simulateClose();
    });
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
    const wsCountAfter = MockEventSource.instances.filter((e) =>
      e.url.startsWith("/events?workspace=")
    ).length;
    expect(wsCountAfter).toBe(wsCountBefore);
  });

  // TC-17 — bell badge does not change when bell is clicked
  it("bell badge count does not change when the bell is clicked", async () => {
    const user = userEvent.setup();
    const factory = makeMockEventSourceFactory();
    let clicks = 0;
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[]}
      >
        <Topbar attentionCount={3} onBellClick={() => clicks++} />
      </SSEConnectionManager>
    );
    expect(screen.getByTestId("bell-badge")).toHaveTextContent("3");
    await user.click(screen.getByTestId("bell"));
    expect(clicks).toBe(1);
    expect(screen.getByTestId("bell-badge")).toHaveTextContent("3");
  });

  // TC-19 — onerror triggers banner identically
  it("onerror triggers the offline banner identically to onclose", () => {
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running" }]}
      >
        <Topbar attentionCount={0} />
        <BoardCard itemId="i-1" />
      </SSEConnectionManager>
    );
    act(() => {
      getWorkspaceSource().simulateError();
    });
    const topbar = screen.getByTestId("topbar");
    expect(within(topbar).getByTestId("offline-banner")).toHaveTextContent(
      OFFLINE_BANNER_TEXT
    );
  });

  // TC-20 — offline state persists across route navigation when provider is shared
  it("offline state persists across route swap when provider is shared", () => {
    const factory = makeMockEventSourceFactory();

    function Switcher() {
      const [route, setRoute] = useState<"board" | "detail">("board");
      return (
        <>
          <Topbar attentionCount={0} />
          <button data-testid="go-detail" onClick={() => setRoute("detail")}>
            go-detail
          </button>
          {route === "board" ? (
            <BoardCard itemId="i-1" />
          ) : (
            <ItemDetail itemId="i-1" runId={null} />
          )}
        </>
      );
    }

    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running" }]}
      >
        <Switcher />
      </SSEConnectionManager>
    );

    act(() => {
      getWorkspaceSource().simulateClose();
    });
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();

    act(() => {
      screen.getByTestId("go-detail").click();
    });

    expect(screen.getByTestId("item-detail")).toBeInTheDocument();
    const topbar = screen.getByTestId("topbar");
    expect(within(topbar).getByTestId("offline-banner")).toBeInTheDocument();
  });

  // EC-01 — close fires before items load → banner appears, no crash
  it("SSE close before items load shows banner without crashing", () => {
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[]}
      >
        <Topbar attentionCount={0} />
      </SSEConnectionManager>
    );
    expect(() =>
      act(() => {
        getWorkspaceSource().simulateClose();
      })
    ).not.toThrow();
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
  });
});
