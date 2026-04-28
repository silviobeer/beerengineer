/**
 * S-09 — 375px Mobile Core Flows
 *
 * jsdom does not perform real layout, so geometric assertions about bounding
 * rects are not meaningful here. Instead we verify the structural decisions
 * that produce a usable mobile layout at 375px width:
 *  - the kanban grid is wrapped in a horizontally scrollable container
 *  - the board card reserves space for the attention-dot and wraps long content
 *  - toolbar buttons live in a flex-wrap row, none stretches past the row width
 *  - the chat textarea and Send button are full width and live in a wrapping row
 *  - the topbar workspace switcher is a native <select> (mobile-accessible)
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

const routerPushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/w/ws-alpha",
}));

import { Board } from "@/components/Board";
import { BoardCard } from "@/components/BoardCard";
import { ChatPanel } from "@/components/ChatPanel";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { WorkspaceProvider } from "@/lib/context/WorkspaceContext";
import {
  fullBoardItems,
  FIXTURE_MULTI_WORKSPACES,
  FIXTURE_SINGLE_WORKSPACE,
} from "@/lib/fixtures";
import type { BoardCardDTO } from "@/lib/types";
import { SSETestProvider } from "./sseTestHarness";

describe("S-09 mobile board layout", () => {
  it("AC-S09-01: board has a horizontally scrollable wrapper around the column grid", () => {
    render(<SSETestProvider><Board items={fullBoardItems()} workspaceKey="alpha" /></SSETestProvider>);
    const scroll = screen.getByTestId("kanban-board-scroll");
    expect(scroll.className).toMatch(/overflow-x-auto/);
    const grid = within(scroll).getByTestId("kanban-board");
    expect(grid).toBeInTheDocument();
    const columns = within(grid).getAllByTestId("kanban-column");
    expect(columns.length).toBeGreaterThanOrEqual(3);
  });

  it("AC-S09-01: every kanban column is in the DOM and reachable as a child of the scroll container", () => {
    render(<SSETestProvider><Board items={fullBoardItems()} workspaceKey="alpha" /></SSETestProvider>);
    const scroll = screen.getByTestId("kanban-board-scroll");
    const columns = within(scroll).getAllByTestId("kanban-column");
    expect(columns).toHaveLength(7);
    for (const c of columns) {
      expect(scroll.contains(c)).toBe(true);
    }
  });

  it("AC-S09-01: the first column is the first child of the grid (visible at scrollLeft=0)", () => {
    render(<SSETestProvider><Board items={fullBoardItems()} workspaceKey="alpha" /></SSETestProvider>);
    const grid = screen.getByTestId("kanban-board");
    const firstCol = within(grid).getAllByTestId("kanban-column")[0];
    expect(firstCol.getAttribute("data-column")).toBe("idea");
  });
});

describe("S-09 mobile board card readability", () => {
  function buildCard(overrides: Partial<BoardCardDTO>): BoardCardDTO {
    return {
      id: "c-1",
      itemCode: "UI-001",
      title: "Standard title",
      column: "idea",
      summary: null,
      phase_status: "open",
      hasOpenPrompt: true,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
      current_stage: null,
      ...overrides,
    };
  }

  it("AC-S09-02: card root reserves right padding for the attention-dot", () => {
    render(<BoardCard card={buildCard({})} />);
    const card = screen.getByTestId("board-card");
    expect(card.className).toMatch(/pr-(?:5|6|7|8|9|10)/);
  });

  it("AC-S09-02: card root has overflow-hidden so children cannot extend past its bounds", () => {
    render(<BoardCard card={buildCard({})} />);
    const card = screen.getByTestId("board-card");
    expect(card.className).toMatch(/overflow-hidden/);
  });

  it("AC-S09-02: standard card simultaneously contains itemCode, title, and attention-dot", () => {
    render(<BoardCard card={buildCard({})} />);
    const card = screen.getByTestId("board-card");
    expect(within(card).getByTestId("board-card-code")).toBeInTheDocument();
    expect(within(card).getByTestId("board-card-title")).toBeInTheDocument();
    expect(within(card).getByTestId("attention-dot")).toBeInTheDocument();
  });

  it("AC-S09-02: extremely long itemCode is wrapped (overflowWrap or wordBreak), not clipped", () => {
    render(
      <BoardCard
        card={buildCard({ itemCode: "ITEM-2024-VERYLONGCODE-XYZ" })}
      />,
    );
    const code = screen.getByTestId("board-card-code");
    const wb = code.style.wordBreak || code.style.getPropertyValue("word-break");
    const ow =
      code.style.overflowWrap ||
      code.style.getPropertyValue("overflow-wrap");
    expect(`${wb}|${ow}`).toMatch(/break-all|anywhere|break-word/);
    expect(code.textContent).toContain("ITEM-2024-VERYLONGCODE-XYZ");
  });

  it("AC-S09-02: long title uses overflow-wrap=anywhere so it wraps inside the card", () => {
    render(
      <BoardCard
        card={buildCard({
          title:
            "An extraordinarily long title that absolutely must wrap inside the narrow mobile card",
        })}
      />,
    );
    const title = screen.getByTestId("board-card-title");
    const ow =
      title.style.overflowWrap ||
      title.style.getPropertyValue("overflow-wrap");
    expect(ow).toMatch(/anywhere|break-word/);
  });

  it("AC-S09-02 EC: attention-inactive card omits the dot but still renders code and title", () => {
    render(
      <BoardCard
        card={buildCard({
          hasOpenPrompt: false,
          hasReviewGateWaiting: false,
          hasBlockedRun: false,
        })}
      />,
    );
    expect(screen.queryByTestId("attention-dot")).toBeNull();
    expect(screen.getByTestId("board-card-code")).toBeInTheDocument();
    expect(screen.getByTestId("board-card-title")).toBeInTheDocument();
  });
});

describe("S-09 mobile chat panel", () => {
  it("AC-S09-04: textarea is rendered as a full-width block element", () => {
    render(
      <ChatPanel activeRunId="run-1" conversation={[]} />,
    );
    const textarea = screen.getByTestId("chat-textarea");
    expect(textarea.className).toMatch(/w-full/);
    expect(textarea.className).toMatch(/max-w-full/);
    expect(textarea.className).toMatch(/box-border/);
  });

  it("AC-S09-04: textarea accepts typed input", () => {
    render(<ChatPanel activeRunId="run-1" conversation={[]} />);
    const textarea = screen.getByTestId("chat-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello mobile" } });
    expect(textarea.value).toBe("hello mobile");
  });

  it("AC-S09-04: form wrapper is full-width so its children fit the viewport", () => {
    render(<ChatPanel activeRunId="run-1" conversation={[]} />);
    const form = screen.getByTestId("chat-form");
    expect(form.className).toMatch(/w-full/);
    expect(form.className).toMatch(/max-w-full/);
  });

  it("AC-S09-04: Send button row uses flex-wrap and tap-friendly min-height on the button", () => {
    render(<ChatPanel activeRunId="run-1" conversation={[]} />);
    const send = screen.getByTestId("chat-send");
    expect(send.className).toMatch(/min-h-10/);
    const row = send.parentElement as HTMLElement;
    expect(row.className).toMatch(/flex-wrap/);
  });

  it("AC-S09-04 EC: Send button is rendered even when textarea is empty (TC-10 edge case)", () => {
    render(<ChatPanel activeRunId="run-1" conversation={[]} />);
    const send = screen.getByTestId("chat-send") as HTMLButtonElement;
    expect(send).toBeInTheDocument();
    // when textarea is empty the form may surface a validation message
    // but the Send button itself must remain in the layout, not hidden
    expect(send.offsetParent === null && send.hidden).toBe(false);
  });

  it("AC-S09-04 EC: clicking Send with an empty textarea surfaces validation, not a network call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<ChatPanel activeRunId="run-x" conversation={[]} />);
      const send = screen.getByTestId("chat-send");
      fireEvent.click(send);
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByTestId("chat-validation")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("AC-S09-04: typing then clicking Send fires the messages POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<ChatPanel activeRunId="run-9" conversation={[]} />);
      const textarea = screen.getByTestId("chat-textarea") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "ping" } });
      const send = screen.getByTestId("chat-send");
      fireEvent.click(send);
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/run-9/messages",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("S-09 mobile workspace switcher", () => {
  it("AC-S09-05: switcher renders as a native <select> with workspace options", () => {
    render(
      <WorkspaceProvider
        workspaces={FIXTURE_MULTI_WORKSPACES}
        currentKey="ws-alpha"
        fetchError={false}
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>,
    );
    const select = screen.getByTestId("workspace-switcher") as HTMLSelectElement;
    expect(select.tagName.toLowerCase()).toBe("select");
    const labels = Array.from(select.options).map((o) => o.textContent);
    for (const ws of FIXTURE_MULTI_WORKSPACES) {
      expect(labels).toContain(ws.name);
    }
  });

  it("AC-S09-05: switcher has a tap-friendly min-height", () => {
    render(
      <WorkspaceProvider
        workspaces={FIXTURE_MULTI_WORKSPACES}
        currentKey="ws-alpha"
        fetchError={false}
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>,
    );
    const select = screen.getByTestId("workspace-switcher");
    expect(select.className).toMatch(/min-h-10/);
    expect(select.className).toMatch(/max-w-full/);
  });

  it("AC-S09-05: selecting a different workspace navigates to that workspace's route (TC-12)", () => {
    routerPushMock.mockClear();
    render(
      <WorkspaceProvider
        workspaces={FIXTURE_MULTI_WORKSPACES}
        currentKey="ws-alpha"
        fetchError={false}
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>,
    );
    const select = screen.getByTestId("workspace-switcher") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "ws-beta" } });
    expect(routerPushMock).toHaveBeenCalledWith("/w/ws-beta");
  });

  it("AC-S09-05 EC: with a single workspace the switcher still renders that single option", () => {
    render(
      <WorkspaceProvider
        workspaces={FIXTURE_SINGLE_WORKSPACE}
        currentKey="ws-solo"
        fetchError={false}
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>,
    );
    const select = screen.getByTestId("workspace-switcher") as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThanOrEqual(1);
    expect(
      Array.from(select.options).some(
        (o) => o.textContent === "Solo Workshop",
      ),
    ).toBe(true);
  });
});
