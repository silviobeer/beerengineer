import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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

  it("closes when the backdrop is clicked or Escape is pressed on the dialog backdrop", () => {
    const onClose = vi.fn();
    render(
      <BoardItemModal
        card={nonImplementationCard("idea")}
        workspaceKey="demo"
        onClose={onClose}
      />
    );

    const backdrop = screen.getByTestId("board-item-modal-backdrop");
    fireEvent.click(backdrop);
    fireEvent.keyDown(backdrop, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(3);
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
});
