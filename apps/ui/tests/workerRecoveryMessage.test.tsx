import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BoardCard } from "@/components/BoardCard";
import { BoardItemModal } from "@/components/BoardItemModal";
import { RunOverviewBanners } from "@/components/run/RunOverviewBanners";
import type { BoardCardDTO } from "@/lib/types";

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

const recoveryMessage = "Worker lost. Resume this run to continue.";

function card(): BoardCardDTO {
  return {
    id: "item-1",
    itemCode: "ITEM-0001",
    title: "Recovered item",
    summary: "Needs resume",
    column: "requirements",
    phase_status: "failed",
    recovery_user_message: recoveryMessage,
  };
}

describe("worker recovery user message", () => {
  it("renders the engine-provided message on board cards", () => {
    render(<BoardCard card={card()} workspaceKey="demo" />);

    expect(screen.getByText(recoveryMessage)).toBeInTheDocument();
  });

  it("renders the engine-provided message in the item modal", () => {
    render(<BoardItemModal card={card()} workspaceKey="demo" onClose={vi.fn()} />);

    expect(screen.getByText(recoveryMessage)).toBeInTheDocument();
  });

  it("renders the engine-provided message on run overview banners", () => {
    render(<RunOverviewBanners recoveryUserMessage={recoveryMessage} />);

    expect(screen.getByText(recoveryMessage)).toBeInTheDocument();
    expect(screen.queryByText(/dashboard/i)).not.toBeInTheDocument();
  });
});
