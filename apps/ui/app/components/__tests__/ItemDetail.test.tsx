import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SSEConnectionManager } from "../../lib/sse/SSEContext";
import { MockEventSource, makeMockEventSourceFactory } from "../../lib/sse/mockEventSource";
import ItemDetail from "../ItemDetail";

function getRunSource(runId: string) {
  const es = MockEventSource.instances.find((e) =>
    e.url === `/runs/${runId}/events`
  );
  if (!es) throw new Error(`No run EventSource for ${runId}`);
  return es;
}

function getWorkspaceSource() {
  const es = MockEventSource.instances.find((e) =>
    e.url.startsWith("/events?workspace=")
  );
  if (!es) throw new Error("No workspace EventSource");
  return es;
}

function fireRun(runId: string, type: string, data: unknown) {
  act(() => {
    getRunSource(runId).simulateEvent(type, data);
  });
}

function fireWorkspace(type: string, data: unknown) {
  act(() => {
    getWorkspaceSource().simulateEvent(type, data);
  });
}

describe("ItemDetail live updates via SSE", () => {
  afterEach(() => {
    MockEventSource.reset();
  });

  // TC-05
  it("status chip updates via workspace SSE", () => {
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running" }]}
      >
        <ItemDetail itemId="i-1" runId={null} />
      </SSEConnectionManager>
    );
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Running");
    fireWorkspace("state-change", { id: "i-1", status: "done" });
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Done");
  });

  // TC-06 — chat append via run SSE
  it("chat history appends a new bubble via run SSE", () => {
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running" }]}
        initialRunId="run-1"
      >
        <ItemDetail
          itemId="i-1"
          runId="run-1"
          conversationMode={{ kind: "clarification" }}
          initialChat={[
            { id: "c1", runId: "run-1", role: "system", content: "hello world" },
          ]}
        />
      </SSEConnectionManager>
    );
    expect(screen.getAllByTestId("chat-bubble")).toHaveLength(1);
    fireRun("run-1", "chat", {
      runId: "run-1",
      role: "assistant",
      content: "second message",
      id: "c2",
    });
    const bubbles = screen.getAllByTestId("chat-bubble");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1]).toHaveTextContent("second message");
  });

  // TC-07 — log rail append via run SSE
  it("log rail appends a new line via run SSE", () => {
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running" }]}
        initialRunId="run-1"
      >
        <ItemDetail itemId="i-1" runId="run-1" />
      </SSEConnectionManager>
    );
    expect(screen.queryAllByTestId("log-line")).toHaveLength(0);
    fireRun("run-1", "log", {
      runId: "run-1",
      severity: "WARN",
      timestamp: "2024-01-15T10:30:00Z",
      message: "deploy started",
      id: "l1",
    });
    const lines = screen.getAllByTestId("log-line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("deploy started");
  });

  // TC-16 — Send button does not change before SSE confirmation
  it("Send button and textarea are unchanged before SSE confirms", async () => {
    const user = userEvent.setup();
    const factory = makeMockEventSourceFactory();
    const sent: string[] = [];
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running" }]}
        initialRunId="run-1"
      >
        <ItemDetail
          itemId="i-1"
          runId="run-1"
          conversationMode={{ kind: "clarification", promptText: "Need clarification" }}
          onSend={(text) => {
            sent.push(text);
          }}
        />
      </SSEConnectionManager>
    );

    const textarea = screen.getByTestId("conversation-input") as HTMLTextAreaElement;
    await user.type(textarea, "my answer");
    expect(textarea.value).toBe("my answer");

    const sendBtn = screen.getByTestId("conversation-send");
    const labelBefore = sendBtn.getAttribute("aria-label");
    const enabledBefore = !sendBtn.hasAttribute("disabled");

    await user.click(sendBtn);

    expect(sendBtn.getAttribute("aria-label")).toBe(labelBefore);
    expect(!sendBtn.hasAttribute("disabled")).toBe(enabledBefore);
    expect(textarea.value).toBe("my answer");
    expect(sent).toEqual(["my answer"]);
    // Bubble has not appeared yet
    expect(screen.queryAllByTestId("chat-bubble")).toHaveLength(0);

    fireRun("run-1", "chat", {
      runId: "run-1",
      role: "user",
      content: "my answer",
      id: "u-1",
    });
    expect(screen.getAllByTestId("chat-bubble")).toHaveLength(1);
    expect((screen.getByTestId("conversation-input") as HTMLTextAreaElement).value).toBe(
      ""
    );
  });

  // TC-18 — review-gate action click does not change chip before SSE
  it("review-gate action click does not change status chip before SSE", async () => {
    const user = userEvent.setup();
    const factory = makeMockEventSourceFactory();
    const fired: string[] = [];
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "review" }]}
        initialRunId="run-1"
      >
        <ItemDetail
          itemId="i-1"
          runId="run-1"
          conversationMode={{
            kind: "review_gate",
            actions: [
              { name: "approve", label: "Approve" },
              { name: "reject", label: "Reject" },
            ],
          }}
          onAction={(name) => {
            fired.push(name);
          }}
        />
      </SSEConnectionManager>
    );
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Review");
    await user.click(screen.getByTestId("gate-action-approve"));
    expect(fired).toEqual(["approve"]);
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Review");

    fireWorkspace("state-change", { id: "i-1", status: "done" });
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Done");
  });

  it("renders inert conversation/log placeholders when runId is null", () => {
    const factory = makeMockEventSourceFactory();
    render(
      <SSEConnectionManager
        workspaceKey="ws-a"
        eventSourceFactory={factory}
        initialItems={[{ id: "i-1", status: "running" }]}
      >
        <ItemDetail itemId="i-1" runId={null} />
      </SSEConnectionManager>
    );
    expect(screen.getByTestId("conversation-inert")).toBeInTheDocument();
    expect(screen.getByTestId("log-rail-inert")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-input")).toBeNull();
    expect(screen.queryByTestId("log-filter")).toBeNull();
  });
});
