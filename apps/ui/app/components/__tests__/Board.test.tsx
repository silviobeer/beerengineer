import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

import Board from "../Board";
import ItemDetail from "../ItemDetail";
import {
  fx01_itemsWithMixedAttention,
  fx01b_itemsOneAttention,
  fx02_itemsNoAttention,
  fx03_singleItemWorkspace,
  fx03_workspaceKey,
  fx04_firstNonAttentionThenTwo,
} from "./boardFixtures";

function getBadgeText(): string {
  const badge = screen.getByTestId("topbar-bell-badge");
  return (badge.textContent ?? "").trim();
}

function expectNoOverlayRoles() {
  for (const role of ["dialog", "tooltip", "menu", "listbox"] as const) {
    expect(screen.queryByRole(role)).toBeNull();
  }
}

beforeEach(() => {
  pushMock.mockReset();
  // jsdom does not implement scrollIntoView; define a no-op so it can be spied on.
  if (typeof (Element.prototype as any).scrollIntoView !== "function") {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: function scrollIntoView(): void {},
    });
  }
});

afterEach(() => {
  cleanup();
});

describe("S-02 Board navigation and bell behavior", () => {
  // TC-01 — card click navigates (verified via the rendered link href)
  it("TC-01: card click target is /w/[key]/items/[id]", async () => {
    render(<Board workspaceKey={fx03_workspaceKey} items={fx03_singleItemWorkspace} />);
    const card = screen.getByTestId("board-card");
    expect(card.tagName).toBe("A");
    expect(card.getAttribute("href")).toBe("/w/test-ws/items/item-42");
  });

  // TC-02 — board badge renders the fixture count, then re-renders to '1'
  it("TC-02: board badge equals attention count and updates on re-render", () => {
    const { rerender } = render(
      <Board workspaceKey="ws-1" items={fx01_itemsWithMixedAttention} />,
    );
    expect(getBadgeText()).toBe("3");
    rerender(<Board workspaceKey="ws-1" items={fx01b_itemsOneAttention} />);
    expect(getBadgeText()).toBe("1");
  });

  // TC-03 — Item-detail badge matches Board badge for same fixture
  it("TC-03: item-detail topbar bell badge matches Board badge", () => {
    const { unmount } = render(
      <Board workspaceKey="ws-1" items={fx01_itemsWithMixedAttention} />,
    );
    expect(getBadgeText()).toBe("3");
    unmount();
    render(
      <ItemDetail
        workspaceKey="ws-1"
        itemId="item-0"
        items={fx01_itemsWithMixedAttention}
      />,
    );
    expect(getBadgeText()).toBe("3");
    expect(screen.getByTestId("topbar-bell")).toBeInTheDocument();
  });

  // TC-04 — bell click on Board scrolls to first attention card
  it("TC-04: bell click scrolls first attention card into view; no overlay opens", async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    try {
      render(<Board workspaceKey="ws-1" items={fx01_itemsWithMixedAttention} />);
      await user.click(screen.getByTestId("topbar-bell"));
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      const calledOn = scrollSpy.mock.instances[0] as Element;
      const firstAttentionCard = screen
        .getAllByTestId("board-card")
        .find((el) => el.getAttribute("data-item-id") === "item-0");
      expect(calledOn).toBe(firstAttentionCard);
      expectNoOverlayRoles();
    } finally {
      scrollSpy.mockRestore();
    }
  });

  // TC-05 — bell click opens no ARIA overlay; focus stays on the bell button
  it("TC-05: bell click opens no ARIA dialog/tooltip/menu/listbox", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<Board workspaceKey="ws-1" items={fx01_itemsWithMixedAttention} />);
    const bell = screen.getByTestId("topbar-bell");
    await user.click(bell);
    expectNoOverlayRoles();
    // Focus stays on the bell, no new focus container injected
    expect(document.activeElement).toBe(bell);
    vi.restoreAllMocks();
  });

  // TC-06 — bell click does nothing when no attention items
  it("TC-06: bell click is a no-op when there are zero attention items", async () => {
    const user = userEvent.setup();
    const scrollIntoSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const scrollToSpy = vi.fn();
    const originalScrollTo = window.scrollTo;
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollToSpy });
    try {
      render(<Board workspaceKey="ws-1" items={fx02_itemsNoAttention} />);
      await user.click(screen.getByTestId("topbar-bell"));
      expect(scrollIntoSpy).not.toHaveBeenCalled();
      expect(scrollToSpy).not.toHaveBeenCalled();
      expectNoOverlayRoles();
    } finally {
      Object.defineProperty(window, "scrollTo", { configurable: true, value: originalScrollTo });
      scrollIntoSpy.mockRestore();
    }
  });

  // TC-07 — back link navigates to /w/[key] (verified via href)
  it("TC-07: back link href is /w/[key]", () => {
    render(
      <ItemDetail
        workspaceKey={fx03_workspaceKey}
        itemId="item-42"
        items={fx03_singleItemWorkspace}
      />,
    );
    const back = screen.getByTestId("topbar-back-link");
    expect(back.tagName).toBe("A");
    expect(back.textContent ?? "").toContain("← Board");
    expect(back.getAttribute("href")).toBe(`/w/${fx03_workspaceKey}`);
  });

  // TC-08 — back link renders correct label and href
  it("TC-08: exactly one '← Board' link with href /w/brwry", () => {
    render(<ItemDetail workspaceKey="brwry" itemId="item-1" items={[]} />);
    const links = screen
      .getAllByRole("link")
      .filter((el) => (el.textContent ?? "").includes("← Board"));
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/w/brwry");
  });

  // TC-09 — Item-detail bell + badge present and shows '3'
  it("TC-09: item-detail topbar bell visible with badge count", () => {
    render(
      <ItemDetail
        workspaceKey="ws-1"
        itemId="item-0"
        items={fx01_itemsWithMixedAttention}
      />,
    );
    const topbar = screen.getByTestId("topbar");
    const bell = within(topbar).getByTestId("topbar-bell");
    expect(bell).toBeInTheDocument();
    const badge = within(bell).getByTestId("topbar-bell-badge");
    expect(badge.textContent?.trim()).toBe("3");
  });

  // TC-10 — bell click on Item-Detail navigates to /w/[key]; no overlay
  it("TC-10: bell click on Item-Detail pushes /w/[key] and opens no overlay", async () => {
    const user = userEvent.setup();
    render(
      <ItemDetail
        workspaceKey={fx03_workspaceKey}
        itemId="item-42"
        items={fx03_singleItemWorkspace}
      />,
    );
    await user.click(screen.getByTestId("topbar-bell"));
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(`/w/${fx03_workspaceKey}`);
    expectNoOverlayRoles();
  });

  // TC-11 — bell targets first attention card by DOM order (not just any)
  it("TC-11: bell scrolls to items[1] when items[0] has no attention", async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    try {
      render(<Board workspaceKey="ws-1" items={fx04_firstNonAttentionThenTwo} />);
      const cards = screen.getAllByTestId("board-card");
      const item1Card = cards.find((el) => el.getAttribute("data-item-id") === "item-1");
      const item2Card = cards.find((el) => el.getAttribute("data-item-id") === "item-2");
      expect(item1Card).toBeTruthy();
      expect(item2Card).toBeTruthy();

      await user.click(screen.getByTestId("topbar-bell"));
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      const target = scrollSpy.mock.instances[0] as Element;
      expect(target).toBe(item1Card);
      expect(target).not.toBe(item2Card);
    } finally {
      scrollSpy.mockRestore();
    }
  });

  // TC-12 — badge shows '0' on Board when no attention items
  it("TC-12: board badge shows '0' when no items have attention", () => {
    render(<Board workspaceKey="ws-1" items={fx02_itemsNoAttention} />);
    const badge = screen.getByTestId("topbar-bell-badge");
    expect(badge).toBeInTheDocument();
    expect((badge.textContent ?? "").trim()).toBe("0");
  });

  // TC-13 — badge shows '0' on Item-Detail when items list is undefined/pending
  it("TC-13: item-detail badge shows '0' when items list is undefined", () => {
    render(<ItemDetail workspaceKey="ws-1" itemId="item-0" items={undefined} />);
    const badge = screen.getByTestId("topbar-bell-badge");
    expect(badge).toBeInTheDocument();
    expect((badge.textContent ?? "").trim()).toBe("0");
  });
});
