import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ItemDetailPage from "../app/w/[key]/items/[id]/page";

const FX_01_RAW = {
  id: "item-007",
  itemCode: "BEER-007",
  title: "Auth overhaul",
  phase_status: "implementation",
  current_stage: "exec",
  currentRunId: "run-abc",
  allowedActions: [
    "start_brainstorm",
    "start_implementation",
    "rerun_design_prep",
    "promote_to_requirements",
    "mark_done",
  ],
};

describe("ItemDetailPage server component (TC-04: real GET /items/:id round-trip)", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches /items/:id, normalizes, and renders header + toolbar from FX-01", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toMatch(/\/items\/item-007$/);
      return new Response(JSON.stringify(FX_01_RAW), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const element = await ItemDetailPage({
      params: Promise.resolve({ key: "ws", id: "item-007" }),
    });
    render(element as React.ReactElement);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("BEER-007")).toBeInTheDocument();
    expect(screen.getByText("Auth overhaul")).toBeInTheDocument();
    const chip = screen.getByTestId("status-chip");
    expect(chip.textContent).toMatch(/Implementation/);
    expect(chip.textContent).toMatch(/Exec/);
    // All five buttons present.
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("renders an inline error region when GET /items/:id fails", async () => {
    globalThis.fetch = (async () =>
      new Response("oops", { status: 500 })) as unknown as typeof fetch;

    const element = await ItemDetailPage({
      params: Promise.resolve({ key: "ws", id: "item-missing" }),
    });
    render(element as React.ReactElement);

    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/Failed to load item/);
    expect(alert.textContent ?? "").toMatch(/item-missing/);
  });

  it("normalizes snake_case fields (allowed_actions, current_run_id, item_code)", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "item-snake",
          item_code: "SNAKE-1",
          title: "Snake-case shape",
          phase_status: "idea",
          current_stage: null,
          current_run_id: null,
          allowed_actions: ["mark_done"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const element = await ItemDetailPage({
      params: Promise.resolve({ key: "ws", id: "item-snake" }),
    });
    render(element as React.ReactElement);

    expect(screen.getByText("SNAKE-1")).toBeInTheDocument();
    expect(screen.getByText("Snake-case shape")).toBeInTheDocument();
    const markDone = screen.getByRole("button", { name: "Mark Done" });
    expect((markDone as HTMLButtonElement).disabled).toBe(false);
  });
});
