import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemChat } from "@/components/ItemChat";
import { noopSSEContext, SSETestProvider } from "./sseTestHarness";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ItemChat", () => {
  it("activates run-scoped SSE for the latest item run", async () => {
    const setRunId = vi.fn();
    globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url === "/api/runs") {
        return jsonResponse({
          runs: [
            {
              id: "run-old",
              item_id: "item-1",
              status: "completed",
              created_at: 10,
            },
            {
              id: "run-new",
              item_id: "item-1",
              status: "needs_answer",
              created_at: 20,
            },
          ],
        });
      }
      if (url === "/api/runs/run-new/conversation") {
        return jsonResponse({
          runId: "run-new",
          updatedAt: "2026-05-07T18:00:00.000Z",
          entries: [],
          openPrompt: null,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    render(
      <SSETestProvider value={{ ...noopSSEContext, setRunId }}>
        <ItemChat itemId="item-1" />
      </SSETestProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument());
    expect(setRunId).toHaveBeenCalledWith(null);
    expect(setRunId).toHaveBeenCalledWith("run-new");
  });
});
