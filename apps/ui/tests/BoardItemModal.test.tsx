import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BoardItemModal } from "@/components/BoardItemModal";
import { nonImplementationCard } from "@/lib/fixtures";

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
});
