import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
import { CreateIdeaLauncher } from "@/components/CreateIdeaLauncher";
import { fullBoardItems } from "@/lib/fixtures";
import { BOARD_MUTATION_CONVERGENCE_WINDOW_MS } from "@/lib/api";
import { SSETestProvider } from "./sseTestHarness";

function renderBoard() {
  return render(
    <SSETestProvider>
      <Board
        items={fullBoardItems()}
        workspaceKey="alpha"
        renderLauncher={(context) => <CreateIdeaLauncher {...context} />}
      />
    </SSETestProvider>,
  );
}

describe("CreateIdeaLauncher", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens a single required free-form field for idea content", async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByRole("button", { name: "Create idea" }));

    const launcher = screen.getByTestId("create-idea-launcher");
    const textboxes = within(launcher).getAllByRole("textbox");
    expect(textboxes).toHaveLength(1);
    expect(textboxes[0]).toHaveAttribute("required");
    expect(textboxes[0]).toHaveAttribute("aria-multiline", "true");
  });

  it("maps idea text into the selected workspace create payload", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ itemId: "item-created", runId: "run-created", status: "accepted" }, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    renderBoard();
    await user.click(screen.getByRole("button", { name: "Create idea" }));

    const idea =
      "\n\n   This is a very long first line that should be trimmed before being capped to exactly eighty characters for launch      \nSecond paragraph stays intact.\nThird line too.";
    await user.type(screen.getByLabelText("Idea content"), idea);
    await user.click(screen.getByRole("button", { name: "Start idea" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([path]) => path === "/api/runs")).toBe(true),
    );
    const runMutationCalls = fetchMock.mock.calls.filter(([path]) => path === "/api/runs");
    expect(runMutationCalls[0]).toEqual([
      "/api/runs",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceKey: "alpha",
          title: "This is a very long first line that should be trimmed before being capped to exa",
          description: idea,
        }),
      }),
    ]);
  });

  it("blocks empty and whitespace-only submissions with required feedback", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    renderBoard();
    await user.click(screen.getByRole("button", { name: "Create idea" }));

    const field = screen.getByLabelText("Idea content");
    const submit = screen.getByRole("button", { name: "Start idea" });

    await user.click(submit);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Idea content is required.")).toBeInTheDocument();

    await user.type(field, "   \t  ");
    await user.click(submit);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a pending indicator and prevents duplicate submissions while creating", async () => {
    const user = userEvent.setup();
    let resolveRequest: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    renderBoard();
    await user.click(screen.getByRole("button", { name: "Create idea" }));
    await user.type(screen.getByLabelText("Idea content"), "Launch the next operator flow");
    await user.click(screen.getByRole("button", { name: "Start idea" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating idea..." })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Creating idea...");

    await user.click(screen.getByRole("button", { name: "Creating idea..." }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRequest?.(
      Response.json({ itemId: "item-created", runId: "run-created", status: "accepted" }, { status: 202 }),
    );
    await screen.findByTestId("board-item-modal-backdrop");
  });

  it("opens the existing item detail modal immediately after success", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ itemId: "item-created", runId: "run-created", status: "accepted" }, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    renderBoard();
    await user.click(screen.getByRole("button", { name: "Create idea" }));
    await user.type(screen.getByLabelText("Idea content"), "Fresh concept");
    await user.click(screen.getByRole("button", { name: "Start idea" }));

    expect(await screen.findByTestId("board-item-modal-backdrop")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Opening item..." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open full detail page" })).toHaveAttribute(
      "href",
      "/w/alpha/items/item-created",
    );
  });

  it("surfaces the engine error message and preserves the entered idea after failure", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: "workflow_git_blocked",
          message: "Git identity must be configured before creating work.",
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    renderBoard();
    await user.click(screen.getByRole("button", { name: "Create idea" }));

    const field = screen.getByLabelText("Idea content") as HTMLTextAreaElement;
    const idea = "Idea line one\nIdea line two";
    await user.type(field, idea);
    await user.click(screen.getByRole("button", { name: "Start idea" }));

    expect(await screen.findByText("Git identity must be configured before creating work.")).toBeInTheDocument();
    expect(field.value).toBe(idea);
  });

  it("falls back to a generic failure message when the engine gives none", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: "engine_500" }, { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    renderBoard();
    await user.click(screen.getByRole("button", { name: "Create idea" }));
    await user.type(screen.getByLabelText("Idea content"), "Fallback path");
    await user.click(screen.getByRole("button", { name: "Start idea" }));

    expect(await screen.findByText("Unable to create the idea right now. Try again.")).toBeInTheDocument();
  });

  it("keeps the launcher field and primary action usable at 375px", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: "workflow_git_blocked", message: "Workspace is blocked." }, { status: 409 }),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    globalThis.innerWidth = 375;

    renderBoard();
    await user.click(screen.getByRole("button", { name: "Create idea" }));

    const launcher = screen.getByTestId("create-idea-launcher");
    const field = screen.getByLabelText("Idea content");
    const submit = screen.getByRole("button", { name: "Start idea" });

    expect(launcher.className).toMatch(/w-full/);
    expect(field.className).toMatch(/w-full/);
    expect(submit.className).toMatch(/w-full/);

    await user.click(submit);
    expect(screen.getByText("Idea content is required.")).toBeInTheDocument();

    await user.type(field, "Mobile launcher");
    await user.click(submit);
    expect(await screen.findByText("Workspace is blocked.")).toBeInTheDocument();
  });

  it("waits about 3 seconds for board convergence before giving up on refreshes", () => {
    expect(BOARD_MUTATION_CONVERGENCE_WINDOW_MS).toBe(3000);
  });
});
