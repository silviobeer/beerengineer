import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { BoardImportLauncher } from "@/components/BoardImportLauncher";
import { BOARD_MUTATION_CONVERGENCE_WINDOW_MS } from "@/lib/api";
import { fullBoardItems } from "@/lib/fixtures";
import { SSETestProvider } from "./sseTestHarness";

function renderBoardWithImportLauncher() {
  return render(
    <SSETestProvider>
      <Board
        items={fullBoardItems()}
        workspaceKey="alpha"
        renderLauncher={(context) => <BoardImportLauncher {...context} />}
      />
    </SSETestProvider>,
  );
}

function openImportLauncher() {
  fireEvent.click(screen.getByRole("button", { name: "Import feature" }));
}

describe("BoardImportLauncher", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens a single required path intake and blocks blank submissions locally", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    renderBoardWithImportLauncher();
    openImportLauncher();

    const input = screen.getByLabelText("Local folder path");
    expect(input).toBeRequired();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Folder path is required.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Folder path is required.")).toBeInTheDocument();
  });

  it("keeps the import launcher controls full-width for a 375px viewport", () => {
    vi.stubGlobal("innerWidth", 375);
    const view = renderBoardWithImportLauncher();

    const launcherButton = screen.getByRole("button", { name: "Import feature" });
    expect(launcherButton.className).toContain("w-full");

    openImportLauncher();

    const input = screen.getByLabelText("Local folder path");
    const submitButton = screen.getByRole("button", { name: "Start import" });
    const panel = view.container.querySelector("#board-import-launcher-panel");

    expect(panel).not.toBeNull();
    expect(panel?.className).toContain("w-full");
    expect(input.className).toContain("w-full");
    expect(input.className).toContain("min-w-0");
    expect(submitButton.className).toContain("w-full");
  });

  it("submits any non-empty path, disables re-submission while pending, and preserves engine failures", async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    renderBoardWithImportLauncher();
    openImportLauncher();

    const input = screen.getByLabelText("Local folder path") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "relative/import-source" } });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/items/import-prepared",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceKey: "alpha",
          path: "relative/import-source",
        }),
      }),
    );

    const submitButton = screen.getByRole("button", { name: "Importing..." });
    expect(submitButton).toBeDisabled();
    expect(screen.getByText("Processing import request...")).toBeInTheDocument();

    fireEvent.click(submitButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(Response.json(
      {
        error: "workflow_git_blocked",
        message: "Git identity must be configured before importing prepared work.",
      },
      { status: 409 },
    ));

    await waitFor(() => {
      expect(
        screen.getByText("Git identity must be configured before importing prepared work."),
      ).toBeInTheDocument();
    });
    expect(input.value).toBe("relative/import-source");
  });

  it("shows a generic failure message when the engine provides no user-facing copy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: "invalid_path" }, { status: 422 }),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    renderBoardWithImportLauncher();
    openImportLauncher();

    fireEvent.change(screen.getByLabelText("Local folder path"), {
      target: { value: "/tmp/import-me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));

    await waitFor(() => {
      expect(screen.getByText("Import failed. Check the folder and try again.")).toBeInTheDocument();
    });
  });

  it("opens the returned item immediately and stops board convergence retries after the wait window", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { itemId: "item-imported", runId: "run-imported", status: "accepted" },
          { status: 200 },
        ),
      )
      .mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    renderBoardWithImportLauncher();
    openImportLauncher();

    fireEvent.change(screen.getByLabelText("Local folder path"), {
      target: { value: "/tmp/prepared-feature" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    });

    expect(screen.getByTestId("board-item-modal-backdrop")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Opening item..." })).toBeInTheDocument();
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_MUTATION_CONVERGENCE_WINDOW_MS + 50);
    });

    const refreshCountAfterWindow = routerRefreshMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(routerRefreshMock.mock.calls.length).toBe(refreshCountAfterWindow);
    expect(refreshCountAfterWindow).toBeGreaterThan(1);
    expect(screen.getByTestId("board-item-modal-backdrop")).toBeInTheDocument();
  });
});
