import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { ItemMessages } from "@/components/ItemMessages";

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

beforeEach(() => {
  vi.useRealTimers();
  vi.stubGlobal("EventSource", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ItemMessages", () => {
  it("renders newest messages first", async () => {
    const fetchSpy = vi.fn(async (input: FetchInput) => {
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
      if (url === "/api/runs/run-1/messages?level=0&limit=500") {
        return jsonResponse({
          runId: "run-1",
          schema: "beerengineer.messages.v1",
          nextSince: null,
          entries: [
            {
              id: "old",
              ts: "2026-04-29T10:00:00.000Z",
              runId: "run-1",
              stageRunId: null,
              type: "agent_message",
              level: 1,
              payload: { message: "older message" },
            },
            {
              id: "new",
              ts: "2026-04-29T10:01:00.000Z",
              runId: "run-1",
              stageRunId: null,
              type: "agent_message",
              level: 1,
              payload: { message: "newer message" },
            },
          ],
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<ItemMessages itemId="item-1" />);

    await waitFor(() =>
      expect(screen.getAllByTestId("item-messages-entry")).toHaveLength(2)
    );
    const entries = screen.getAllByTestId("item-messages-entry");
    expect(within(entries[0]).getByText("newer message")).toBeInTheDocument();
    expect(within(entries[1]).getByText("older message")).toBeInTheDocument();
  });

  it("backfills paged history and tails SSE from the last seen message", async () => {
    const eventSourceUrls: string[] = [];
    class MockEventSource {
      readonly url: string;
      constructor(url: string) {
        this.url = url;
        eventSourceUrls.push(url);
      }
      addEventListener = vi.fn();
      close = vi.fn();
    }
    vi.stubGlobal("EventSource", MockEventSource);

    const fetchSpy = vi.fn(async (input: FetchInput) => {
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
      if (url === "/api/runs/run-1/messages?level=0&limit=500") {
        return jsonResponse({
          runId: "run-1",
          schema: "beerengineer.messages.v1",
          nextSince: "page-1",
          entries: [
            {
              id: "page-1",
              ts: "2026-04-29T10:00:00.000Z",
              runId: "run-1",
              stageRunId: null,
              type: "agent_message",
              level: 1,
              payload: { message: "first page" },
            },
          ],
        });
      }
      if (url === "/api/runs/run-1/messages?level=0&limit=500&since=page-1") {
        return jsonResponse({
          runId: "run-1",
          schema: "beerengineer.messages.v1",
          nextSince: null,
          entries: [
            {
              id: "page-2",
              ts: "2026-04-29T10:01:00.000Z",
              runId: "run-1",
              stageRunId: null,
              type: "agent_message",
              level: 1,
              payload: { message: "second page" },
            },
          ],
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<ItemMessages itemId="item-1" />);

    await waitFor(() =>
      expect(screen.getAllByTestId("item-messages-entry")).toHaveLength(2)
    );
    await waitFor(() =>
      expect(eventSourceUrls).toEqual([
        "/api/runs/run-1/events?level=0&since=page-2",
      ])
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/runs/run-1/messages?level=0&limit=500",
      { cache: "no-store" }
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/runs/run-1/messages?level=0&limit=500&since=page-1",
      { cache: "no-store" }
    );
  });
});
