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
      if (url === "/api/runs/run-1/messages?level=0") {
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
});
