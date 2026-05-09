import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemChat } from "@/components/ItemChat";
import { ItemMessages } from "@/components/ItemMessages";
import {
  readRunEntryFallbackTelemetry,
  resetRunEntryFallbackTelemetry,
} from "@/lib/runEntryFacts";
import { noopSSEContext, SSETestProvider } from "./sseTestHarness";

type FetchInput = Parameters<typeof fetch>[0];

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetRunEntryFallbackTelemetry();
});

describe("run entry facts", () => {
  it("uses engine-owned chat and messages entry facts on the happy path with zero fallback activations", async () => {
    const fetchMock = vi.fn(async (input: FetchInput) => {
      const url = urlOf(input);
      if (url === "/api/runs/run-chat/conversation") {
        return jsonResponse({
          runId: "run-chat",
          updatedAt: "2026-05-09T12:00:00.000Z",
          entries: [],
          openPrompt: null,
        });
      }
      if (url === "/api/runs/run-msg/messages?level=0&limit=500") {
        return jsonResponse({
          runId: "run-msg",
          schema: "messages-v1",
          nextSince: null,
          entries: [
            {
              id: "msg-1",
              ts: "2026-05-09T12:01:00.000Z",
              runId: "run-msg",
              stageRunId: null,
              type: "run_started",
              level: 2,
              payload: { title: "Started" },
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", undefined);

    render(
      <SSETestProvider value={noopSSEContext}>
        <>
          <ItemChat itemId="item-1" chatEntry={{ status: "resolved", targetRunId: "run-chat" }} />
          <ItemMessages itemId="item-1" messagesEntry={{ status: "resolved", targetRunId: "run-msg" }} />
        </>
      </SSETestProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("item-messages")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([input]) => urlOf(input) === "/api/runs")).toBe(false);
    expect(readRunEntryFallbackTelemetry()).toEqual({
      chat: 0,
      messages: 0,
      events: [],
    });
  });

  it("shows the existing no-target state without opening a guessed run when no fact target exists", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("no fetch expected");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", undefined);

    render(
      <SSETestProvider value={noopSSEContext}>
        <>
          <ItemChat itemId="item-1" chatEntry={{ status: "none", targetRunId: null }} />
          <ItemMessages itemId="item-1" messagesEntry={{ status: "none", targetRunId: null }} />
        </>
      </SSETestProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("chat-no-active-run")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("item-messages-no-run")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readRunEntryFallbackTelemetry()).toEqual({
      chat: 0,
      messages: 0,
      events: [],
    });
  });

  it("uses the compatibility fallback only when entry facts are omitted and records telemetry", async () => {
    const fetchMock = vi.fn(async (input: FetchInput) => {
      const url = urlOf(input);
      if (url === "/api/runs") {
        return jsonResponse({
          runs: [
            {
              id: "run-1",
              item_id: "item-1",
              status: "running",
              created_at: 10,
            },
          ],
        });
      }
      if (url === "/api/runs/run-1/conversation") {
        return jsonResponse({
          runId: "run-1",
          updatedAt: "2026-05-09T12:00:00.000Z",
          entries: [],
          openPrompt: {
            promptId: "prompt-1",
            runId: "run-1",
            stageKey: null,
            text: "Need input",
            createdAt: "2026-05-09T12:00:00.000Z",
          },
        });
      }
      if (url === "/api/runs/run-1/messages?level=2&limit=1") {
        return jsonResponse({
          runId: "run-1",
          schema: "messages-v1",
          nextSince: null,
          entries: [
            {
              id: "msg-1",
              ts: "2026-05-09T12:01:00.000Z",
              runId: "run-1",
              stageRunId: null,
              type: "run_started",
              level: 2,
              payload: { title: "Started" },
            },
          ],
        });
      }
      if (url === "/api/runs/run-1/messages?level=0&limit=500") {
        return jsonResponse({
          runId: "run-1",
          schema: "messages-v1",
          nextSince: null,
          entries: [],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", undefined);

    render(
      <SSETestProvider value={noopSSEContext}>
        <>
          <ItemChat itemId="item-1" />
          <ItemMessages itemId="item-1" />
        </>
      </SSETestProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("item-messages")).toBeInTheDocument());
    expect(readRunEntryFallbackTelemetry()).toEqual({
      chat: 1,
      messages: 1,
      events: [
        { itemId: "item-1", surface: "chat" },
        { itemId: "item-1", surface: "messages" },
      ],
    });
  });

  it("does not guess a run from compatibility fallback when no qualifying chat or messages target exists", async () => {
    const fetchMock = vi.fn(async (input: FetchInput) => {
      const url = urlOf(input);
      if (url === "/api/runs") {
        return jsonResponse({
          runs: [
            {
              id: "run-2",
              item_id: "item-1",
              status: "failed",
              created_at: 20,
            },
            {
              id: "run-1",
              item_id: "item-1",
              status: "completed",
              created_at: 10,
            },
          ],
        });
      }
      if (url === "/api/runs/run-2/conversation" || url === "/api/runs/run-1/conversation") {
        return jsonResponse({
          runId: url.includes("run-2") ? "run-2" : "run-1",
          updatedAt: "2026-05-09T12:00:00.000Z",
          entries: [],
          openPrompt: null,
        });
      }
      if (url === "/api/runs/run-2/messages?level=2&limit=1" || url === "/api/runs/run-1/messages?level=2&limit=1") {
        return jsonResponse({
          runId: url.includes("run-2") ? "run-2" : "run-1",
          schema: "messages-v1",
          nextSince: null,
          entries: [],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", undefined);

    render(
      <SSETestProvider value={noopSSEContext}>
        <>
          <ItemChat itemId="item-1" />
          <ItemMessages itemId="item-1" />
        </>
      </SSETestProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("chat-no-active-run")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("item-messages-no-run")).toBeInTheDocument());
    expect(screen.queryByTestId("item-messages")).not.toBeInTheDocument();
    expect(readRunEntryFallbackTelemetry()).toEqual({
      chat: 1,
      messages: 1,
      events: [
        { itemId: "item-1", surface: "chat" },
        { itemId: "item-1", surface: "messages" },
      ],
    });
  });

  it("skips failed compatibility probes and keeps searching for a qualifying run", async () => {
    const fetchMock = vi.fn(async (input: FetchInput) => {
      const url = urlOf(input);
      if (url === "/api/runs") {
        return jsonResponse({
          runs: [
            {
              id: "run-2",
              item_id: "item-1",
              status: "failed",
              created_at: 20,
            },
            {
              id: "run-1",
              item_id: "item-1",
              status: "running",
              created_at: 10,
            },
          ],
        });
      }
      if (url === "/api/runs/run-2/conversation" || url === "/api/runs/run-2/messages?level=2&limit=1") {
        return new Response("boom", { status: 500 });
      }
      if (url === "/api/runs/run-1/conversation") {
        return jsonResponse({
          runId: "run-1",
          updatedAt: "2026-05-09T12:00:00.000Z",
          entries: [],
          openPrompt: {
            promptId: "prompt-1",
            runId: "run-1",
            stageKey: null,
            text: "Need input",
            createdAt: "2026-05-09T12:00:00.000Z",
          },
        });
      }
      if (url === "/api/runs/run-1/messages?level=2&limit=1") {
        return jsonResponse({
          runId: "run-1",
          schema: "messages-v1",
          nextSince: null,
          entries: [
            {
              id: "msg-1",
              ts: "2026-05-09T12:01:00.000Z",
              runId: "run-1",
              stageRunId: null,
              type: "run_started",
              level: 2,
              payload: { title: "Started" },
            },
          ],
        });
      }
      if (url === "/api/runs/run-1/messages?level=0&limit=500") {
        return jsonResponse({
          runId: "run-1",
          schema: "messages-v1",
          nextSince: null,
          entries: [],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", undefined);

    render(
      <SSETestProvider value={noopSSEContext}>
        <>
          <ItemChat itemId="item-1" />
          <ItemMessages itemId="item-1" />
        </>
      </SSETestProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("item-messages")).toBeInTheDocument());
    expect(readRunEntryFallbackTelemetry()).toEqual({
      chat: 1,
      messages: 1,
      events: [
        { itemId: "item-1", surface: "chat" },
        { itemId: "item-1", surface: "messages" },
      ],
    });
  });
});
