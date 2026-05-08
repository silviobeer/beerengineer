import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: routerRefreshMock,
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

import { Board } from "@/components/Board";
import { BOARD_MUTATION_REFRESH_INTERVAL_MS, type BoardLauncherMutationSuccess } from "@/lib/api";
import { fullBoardItems } from "@/lib/fixtures";
import { SSETestProvider } from "./sseTestHarness";

function renderBoardWithLauncher(renderLauncher?: Parameters<typeof Board>[0]["renderLauncher"]) {
  return render(
    <SSETestProvider>
      <Board items={fullBoardItems()} workspaceKey="alpha" renderLauncher={renderLauncher} />
    </SSETestProvider>,
  );
}

describe("board launcher setup shell", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("exposes a stable launcher host tied to the selected workspace", () => {
    renderBoardWithLauncher(({ selectedWorkspaceKey, isWorkspaceSelected }) => (
      <div
        data-testid="launcher-probe"
        data-selected-workspace={selectedWorkspaceKey ?? ""}
        data-workspace-selected={isWorkspaceSelected ? "true" : "false"}
      >
        launcher slot
      </div>
    ));

    const shell = screen.getByTestId("board-launcher-shell");
    const slot = screen.getByTestId("board-launcher-slot");
    const probe = screen.getByTestId("launcher-probe");

    expect(shell).toHaveAttribute("data-selected-workspace", "alpha");
    expect(shell).toHaveAttribute("data-workspace-selected", "true");
    expect(slot.className).toMatch(/flex-wrap/);
    expect(probe).toHaveAttribute("data-selected-workspace", "alpha");
    expect(probe).toHaveAttribute("data-workspace-selected", "true");
  });

  it("opens the item modal immediately from a synchronous mutation result and refreshes for convergence", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)) as typeof fetch,
    );

    renderBoardWithLauncher(({ openItemModalFromMutation }) => (
      <button
        type="button"
        onClick={() =>
          openItemModalFromMutation({
            ok: true,
            itemId: "item-created",
            runId: "run-created",
            status: "accepted",
          } satisfies BoardLauncherMutationSuccess)
        }
      >
        Open created item
      </button>
    ));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open created item" }));
    });

    expect(screen.getByTestId("board-item-modal-backdrop")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Opening item..." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open full detail page" })).toHaveAttribute(
      "href",
      "/w/alpha/items/item-created",
    );
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_MUTATION_REFRESH_INTERVAL_MS + 25);
    });

    expect(routerRefreshMock).toHaveBeenCalledTimes(2);
  });
});
