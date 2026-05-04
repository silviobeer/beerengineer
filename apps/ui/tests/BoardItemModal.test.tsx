import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BoardItemModal } from "@/components/BoardItemModal";
import { nonImplementationCard } from "@/lib/fixtures";
import { SSETestProvider, noopSSEContext } from "./sseTestHarness";
import type { LifecycleStateByWave } from "@/lib/lifecycleEvents";

vi.mock("@/components/MiniStepper", () => ({
  MiniStepper: () => <div data-testid="mini-stepper" />,
}));

vi.mock("@/components/BoardCardActions", () => ({
  BoardCardActions: () => <div data-testid="board-card-actions" />,
}));

vi.mock("@/components/ItemChat", () => ({
  ItemChat: () => <div data-testid="item-chat" />,
}));

vi.mock("@/components/ItemMessages", () => ({
  ItemMessages: () => <div data-testid="item-messages" />,
}));

describe("BoardItemModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes from the close button and global Escape", () => {
    const onClose = vi.fn();
    render(
      <BoardItemModal
        card={nonImplementationCard("idea")}
        workspaceKey="demo"
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores non-Escape key presses on the dialog backdrop", () => {
    const onClose = vi.fn();
    render(
      <BoardItemModal
        card={nonImplementationCard("idea")}
        workspaceKey="demo"
        onClose={onClose}
      />
    );

    fireEvent.keyDown(screen.getByTestId("board-item-modal-backdrop"), { key: "Enter" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows design artifacts for frontend items and does not show preview controls", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/wireframes")) {
        return new Response(JSON.stringify({
          runId: "run-1",
          screenMapUrl: "/runs/run-1/artifacts/stages/visual-companion/artifacts/screen-map.html",
          screens: [
            {
              id: "home",
              name: "Home",
              url: "/runs/run-1/artifacts/stages/visual-companion/artifacts/home.html",
            },
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/design")) {
        return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BoardItemModal
        card={nonImplementationCard("frontend", { current_stage: "visual-companion" })}
        workspaceKey="demo"
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText("Local Preview")).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Open screen map" })).toHaveAttribute(
      "href",
      "/api/runs/run-1/artifacts/stages/visual-companion/artifacts/screen-map.html"
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/api/runs/run-1/artifacts/stages/visual-companion/artifacts/home.html"
    );
  });

  it("shows preview controls only for merge items", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/preview")) {
        expect(init).toMatchObject({ cache: "no-store" });
        return new Response(JSON.stringify({
          branch: "item/demo",
          worktreePath: "/tmp/demo",
          previewHost: "127.0.0.1",
          previewPort: 3362,
          previewUrl: "http://127.0.0.1:3362",
          running: false,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BoardItemModal
        card={nonImplementationCard("merge", { current_stage: "handoff" })}
        workspaceKey="demo"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText("Local Preview")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Start localhost" })).toBeInTheDocument();
  });

  it("renders reachable Supabase lifecycle and merge gates for a merge card", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/preview")) {
        expect(init).toMatchObject({ cache: "no-store" });
        return new Response(JSON.stringify({
          branch: "item/demo",
          worktreePath: "/tmp/demo",
          previewHost: "127.0.0.1",
          previewPort: 3362,
          previewUrl: "http://127.0.0.1:3362",
          running: false,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/api/runs/run-1/merge-status") {
        return new Response(JSON.stringify({
          gates: {
            finalValidation: { status: "pass", reason: "final wave validated" },
            protectionSwitch: { status: "block", reason: "protection switch off" },
            destructiveConfirmation: { status: "skipped", reason: "no destructive operations detected" },
            productionMigration: { status: "skipped", reason: "production-migration-skipped-because-off" },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BoardItemModal
        card={nonImplementationCard("merge", {
          latestRunId: "run-1",
          workspaceId: "ws-1",
          workspaceRoot: "/repo",
          supabaseProjectRef: "proj_1",
          dbRelevance: { value: true, source: "detector", reason: "Supabase branch provisioned" },
          supabaseBranch: {
            ref: "br_1",
            name: "beerengineer-demo-wave-1",
            lifecycleState: "retained-for-diagnosis",
          },
        })}
        workspaceKey="demo"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Supabase status")).toBeInTheDocument();
    expect(screen.getByText("DB")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Supabase" })).toHaveAttribute(
      "href",
      "https://supabase.com/dashboard/project/proj_1/branches/br_1"
    );
    expect(screen.getByRole("button", { name: "Retry validation" })).toBeInTheDocument();
    expect(await screen.findByTestId("merge-gate-panel")).toBeInTheDocument();
    expect(screen.getByText("protection switch off")).toBeInTheDocument();
  });

  it("BUG-PROJ4-QA-011: hides merge gate panel when engine reports supabaseRelevant: false", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/preview")) {
        return new Response(JSON.stringify({
          branch: "item/demo",
          worktreePath: "/tmp/demo",
          previewHost: "127.0.0.1",
          previewPort: 3362,
          previewUrl: "http://127.0.0.1:3362",
          running: false,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/api/runs/run-2/merge-status") {
        return new Response(JSON.stringify({ supabaseRelevant: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BoardItemModal
        card={nonImplementationCard("merge", {
          latestRunId: "run-2",
          workspaceId: "ws-2",
          workspaceRoot: "/repo",
          dbRelevance: { value: false, source: "detector", reason: "No Supabase branch provisioned" },
        })}
        workspaceKey="demo"
        onClose={vi.fn()}
      />
    );

    // Wait for the merge-status fetch to settle, then assert the gate panel
    // is not rendered. We use the Supabase status section as a stable anchor
    // — it always renders for runs with dbRelevance metadata.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/run-2/merge-status",
        expect.objectContaining({ cache: "no-store" })
      );
    });
    expect(screen.queryByTestId("merge-gate-panel")).not.toBeInTheDocument();
  });

  it("BUG-PROJ4-QA-026: refetches merge-status (debounced) when SSE lifecycle state changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/preview")) {
        return new Response(JSON.stringify({
          branch: "item/demo",
          worktreePath: "/tmp/demo",
          previewHost: "127.0.0.1",
          previewPort: 3362,
          previewUrl: "http://127.0.0.1:3362",
          running: false,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/api/runs/run-3/merge-status") {
        return new Response(JSON.stringify({
          gates: {
            finalValidation: { status: "pass", reason: "ok" },
            protectionSwitch: { status: "pass", reason: "ok" },
            destructiveConfirmation: { status: "skipped", reason: "none" },
            productionMigration: { status: "skipped", reason: "off" },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const card = nonImplementationCard("merge", {
      latestRunId: "run-3",
      workspaceId: "ws-3",
      workspaceRoot: "/repo",
      supabaseProjectRef: "proj_3",
      dbRelevance: { value: true, source: "detector", reason: "Supabase branch provisioned" },
      supabaseBranch: {
        ref: "br_3",
        name: "beerengineer-demo-wave-1",
        lifecycleState: "ready",
      },
    });
    const initialSse = { ...noopSSEContext, lifecycleState: {} as LifecycleStateByWave };

    const { rerender } = render(
      <SSETestProvider value={initialSse}>
        <BoardItemModal card={card} workspaceKey="demo" onClose={vi.fn()} />
      </SSETestProvider>
    );

    // Initial fetch fires immediately.
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        ([u]) => String(u) === "/api/runs/run-3/merge-status"
      ).length;
      expect(calls).toBe(1);
    });

    // Rerender with a new lifecycleState reference — simulates SSE update.
    const updatedLifecycle: LifecycleStateByWave = {
      "wave-1": [
        { id: "branch_creation", label: "Branch creation", status: "passed" },
        { id: "migrations", label: "Migrations", status: "passed" },
        { id: "seed", label: "Seed", status: "in_progress" },
        { id: "db_tests", label: "DB tests", status: "idle" },
        { id: "cleanup", label: "Cleanup", status: "idle" },
      ],
    };
    await act(async () => {
      rerender(
        <SSETestProvider value={{ ...noopSSEContext, lifecycleState: updatedLifecycle }}>
          <BoardItemModal card={card} workspaceKey="demo" onClose={vi.fn()} />
        </SSETestProvider>
      );
    });

    // After debounce window elapses, a refetch should have fired.
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        ([u]) => String(u) === "/api/runs/run-3/merge-status"
      ).length;
      expect(calls).toBe(2);
    }, { timeout: 2000 });
  });

  it("BUG-PROJ4-QA-026: skips refetch when supabaseRelevant is false", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/preview")) {
        return new Response(JSON.stringify({
          branch: "item/demo",
          worktreePath: "/tmp/demo",
          previewHost: "127.0.0.1",
          previewPort: 3362,
          previewUrl: "http://127.0.0.1:3362",
          running: false,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/api/runs/run-4/merge-status") {
        return new Response(JSON.stringify({ supabaseRelevant: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const card = nonImplementationCard("merge", {
      latestRunId: "run-4",
      workspaceId: "ws-4",
      workspaceRoot: "/repo",
      dbRelevance: { value: false, source: "detector", reason: "No Supabase branch provisioned" },
    });

    const { rerender } = render(
      <SSETestProvider value={{ ...noopSSEContext, lifecycleState: {} as LifecycleStateByWave }}>
        <BoardItemModal card={card} workspaceKey="demo" onClose={vi.fn()} />
      </SSETestProvider>
    );

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        ([u]) => String(u) === "/api/runs/run-4/merge-status"
      ).length;
      expect(calls).toBe(1);
    });

    await act(async () => {
      rerender(
        <SSETestProvider value={{
          ...noopSSEContext,
          lifecycleState: {
            "wave-1": [
              { id: "branch_creation", label: "Branch creation", status: "passed" },
              { id: "migrations", label: "Migrations", status: "in_progress" },
              { id: "seed", label: "Seed", status: "idle" },
              { id: "db_tests", label: "DB tests", status: "idle" },
              { id: "cleanup", label: "Cleanup", status: "idle" },
            ],
          },
        }}>
          <BoardItemModal card={card} workspaceKey="demo" onClose={vi.fn()} />
        </SSETestProvider>
      );
    });

    // Wait well past the debounce window with real timers.
    await new Promise(resolve => setTimeout(resolve, 800));

    const finalCalls = fetchMock.mock.calls.filter(
      ([u]) => String(u) === "/api/runs/run-4/merge-status"
    ).length;
    expect(finalCalls).toBe(1);
  });
});
