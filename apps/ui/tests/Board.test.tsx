import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Board } from "@/components/Board";
import { BoardCard } from "@/components/BoardCard";
import { KanbanColumn } from "@/components/KanbanColumn";
import {
  attentionFlagCard,
  emptyBoardItems,
  fullBoardItems,
  implementationCardWithStage,
  longSummaryCard,
  nonImplementationCard,
} from "@/lib/fixtures";
import {
  BOARD_COLUMNS,
  BOARD_COLUMN_LABELS,
  type BoardColumn,
} from "@/lib/types";

const COLUMN_LABEL_ORDER = [
  "Idea",
  "Frontend",
  "Requirements",
  "Implementation",
  "Test",
  "Merge",
];

const STEPPER_LABELS = ["Arch", "Plan", "Exec", "Review"];

function getColumnByLabel(label: string): HTMLElement {
  const columns = screen.getAllByTestId("kanban-column");
  const match = columns.find(
    (col) =>
      within(col).getByTestId("kanban-column-header").textContent?.trim() ===
      label
  );
  if (!match) throw new Error(`column not found: ${label}`);
  return match;
}

describe("Board layout (S-01)", () => {
  it("TC-01: renders exactly six columns", () => {
    render(<Board items={fullBoardItems()} />);
    const columns = screen.getAllByTestId("kanban-column");
    expect(columns).toHaveLength(6);
  });

  it("TC-02: columns appear in prescribed order", () => {
    render(<Board items={fullBoardItems()} />);
    const headers = screen
      .getAllByTestId("kanban-column-header")
      .map((el) => el.textContent?.trim());
    expect(headers).toEqual(COLUMN_LABEL_ORDER);
  });

  it("TC-03: each column carries its correct label", () => {
    for (const column of BOARD_COLUMNS) {
      const { unmount } = render(<KanbanColumn column={column} />);
      const header = screen.getByTestId("kanban-column-header");
      expect(header.textContent?.trim()).toBe(BOARD_COLUMN_LABELS[column]);
      unmount();
    }
  });
});

describe("BoardCard content (S-01)", () => {
  it("TC-04: card itemCode renders in a monospace typeface", () => {
    render(<BoardCard card={fullBoardItems()[0]} />);
    const code = screen.getByTestId("board-card-code");
    const fontFamily = window.getComputedStyle(code).fontFamily.toLowerCase();
    expect(fontFamily).toMatch(
      /monospace|consolas|courier|menlo|monaco|sfmono|ui-monospace/
    );
  });

  it("TC-05: card displays title and phase_status chip", () => {
    const card = {
      ...fullBoardItems()[0],
      title: "distinct-title-zzz",
      phase_status: "blocked",
    };
    render(<BoardCard card={card} />);
    expect(screen.getByText("distinct-title-zzz")).toBeInTheDocument();
    const chip = screen.getByTestId("board-card-status-chip");
    expect(chip.textContent?.trim()).toBe("blocked");
  });

  it("TC-06: card summary container has overflow:hidden and ellipsis or 2-line clamp", () => {
    render(<BoardCard card={longSummaryCard()} />);
    const summary = screen.getByTestId("board-card-summary");
    const cs = window.getComputedStyle(summary);
    expect(cs.overflow === "hidden" || cs.overflowY === "hidden").toBe(true);
    const lineClamp =
      (summary.style as unknown as { WebkitLineClamp?: string })
        .WebkitLineClamp ?? summary.style.getPropertyValue("-webkit-line-clamp");
    const hasClamp = String(lineClamp) === "2" || cs.textOverflow === "ellipsis";
    expect(hasClamp).toBe(true);
  });
});

describe("Item placement (S-01)", () => {
  it("TC-07: items land in the column matching their phase", () => {
    render(<Board items={fullBoardItems()} />);
    for (const item of fullBoardItems()) {
      const column = getColumnByLabel(BOARD_COLUMN_LABELS[item.column as BoardColumn]);
      expect(within(column).getByText(item.title)).toBeInTheDocument();

      const otherColumns = screen
        .getAllByTestId("kanban-column")
        .filter((c) => c !== column);
      for (const other of otherColumns) {
        expect(within(other).queryByText(item.title)).toBeNull();
      }
    }
  });

  it("TC-08: multiple items in the same phase all appear in that column", () => {
    const items = [
      implementationCardWithStage("arch"),
      implementationCardWithStage("plan"),
      implementationCardWithStage("exec"),
    ];
    render(<Board items={items} />);
    const impl = getColumnByLabel("Implementation");
    for (const item of items) {
      expect(
        within(impl).getByText(item.itemCode!, { exact: false })
      ).toBeInTheDocument();
    }
    const otherColumns = screen
      .getAllByTestId("kanban-column")
      .filter((c) => c !== impl);
    for (const other of otherColumns) {
      for (const item of items) {
        expect(
          within(other).queryByText(item.itemCode!, { exact: false })
        ).toBeNull();
      }
    }
  });
});

describe("Attention dot (S-01)", () => {
  it("TC-09: attention-dot is present when hasOpenPrompt is true", () => {
    render(<BoardCard card={attentionFlagCard("open")} />);
    expect(screen.getByTestId("attention-dot")).toBeInTheDocument();
  });

  it("TC-10: attention-dot is present when hasReviewGateWaiting is true", () => {
    render(<BoardCard card={attentionFlagCard("review")} />);
    expect(screen.getByTestId("attention-dot")).toBeInTheDocument();
  });

  it("TC-11: attention-dot is present when hasBlockedRun is true", () => {
    render(<BoardCard card={attentionFlagCard("blocked")} />);
    expect(screen.getByTestId("attention-dot")).toBeInTheDocument();
  });

  it("TC-12: no attention-dot when all three flags are false", () => {
    const { container } = render(<BoardCard card={attentionFlagCard("none")} />);
    expect(within(container).queryByTestId("attention-dot")).toBeNull();
  });

  it("TC-13: attention-dot uses a gold color", () => {
    render(<BoardCard card={attentionFlagCard("open")} />);
    const dot = screen.getByTestId("attention-dot");
    const bg = window.getComputedStyle(dot).backgroundColor;
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    expect(m).not.toBeNull();
    const [, r, g, b] = m!.map(Number);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThanOrEqual(140);
    expect(g).toBeLessThanOrEqual(200);
    expect(b).toBeLessThan(50);
  });

  it("EC: attention-dot appears exactly once when all flags are true", () => {
    const card = {
      ...attentionFlagCard("open"),
      hasOpenPrompt: true,
      hasReviewGateWaiting: true,
      hasBlockedRun: true,
    };
    const { container } = render(<BoardCard card={card} />);
    expect(within(container).getAllByTestId("attention-dot")).toHaveLength(1);
  });
});

describe("Mini-Stepper visibility on board (S-01)", () => {
  it("TC-14: Mini-Stepper is present on Implementation cards with all four labels", () => {
    render(<BoardCard card={implementationCardWithStage("plan")} />);
    const stepper = screen.getByTestId("mini-stepper");
    for (const label of STEPPER_LABELS) {
      expect(within(stepper).getByText(label)).toBeInTheDocument();
    }
    const segments = within(stepper).getAllByRole("listitem");
    expect(segments).toHaveLength(4);
  });

  it("TC-15: exactly one segment has a unique computed-style fingerprint", () => {
    render(<BoardCard card={implementationCardWithStage("plan")} />);
    const stepper = screen.getByTestId("mini-stepper");
    const segments = within(stepper).getAllByRole("listitem");
    const fingerprints = segments.map((seg) => {
      const cs = window.getComputedStyle(seg);
      return [
        cs.backgroundColor,
        cs.color,
        cs.fontWeight,
        cs.borderColor,
        cs.borderWidth,
        cs.opacity,
        cs.textDecoration,
        cs.outline,
        cs.boxShadow,
        cs.fontStyle,
      ].join("|");
    });
    const counts = new Map<string, number>();
    for (const fp of fingerprints) counts.set(fp, (counts.get(fp) ?? 0) + 1);
    const uniqueFingerprints = [...counts.values()].filter((n) => n === 1);
    expect(uniqueFingerprints).toHaveLength(1);
    const planFp = fingerprints[1];
    expect(counts.get(planFp)).toBe(1);

    const { container } = render(
      <BoardCard card={implementationCardWithStage("arch")} />
    );
    const stepper2 = within(container).getByTestId("mini-stepper");
    const segments2 = within(stepper2).getAllByRole("listitem");
    const fps2 = segments2.map((seg) => {
      const cs = window.getComputedStyle(seg);
      return [
        cs.backgroundColor,
        cs.color,
        cs.fontWeight,
        cs.borderColor,
        cs.borderWidth,
        cs.opacity,
        cs.textDecoration,
        cs.outline,
        cs.boxShadow,
        cs.fontStyle,
      ].join("|");
    });
    const counts2 = new Map<string, number>();
    for (const fp of fps2) counts2.set(fp, (counts2.get(fp) ?? 0) + 1);
    expect([...counts2.values()].filter((n) => n === 1)).toHaveLength(1);
    expect(counts2.get(fps2[0])).toBe(1);
  });

  it("TC-16: Mini-Stepper absent on cards in non-Implementation columns", () => {
    const items = (["idea", "brainstorm", "requirements", "done"] as const).map(
      (col) => nonImplementationCard(col)
    );
    render(<Board items={items} />);
    for (const item of items) {
      const card = screen.getByText(item.title).closest("[data-testid='board-card']");
      expect(card).not.toBeNull();
      expect(
        within(card as HTMLElement).queryByTestId("mini-stepper")
      ).toBeNull();
    }
  });
});

describe("Empty columns (S-01)", () => {
  it("TC-17: empty column is not removed from layout and header is visible", () => {
    const items = fullBoardItems().filter((item) => item.column !== "test");
    render(<Board items={items} />);
    const test = getColumnByLabel("Test");
    expect(test).toBeInTheDocument();
    expect(within(test).getByText("Test")).toBeInTheDocument();
    const body = within(test).getByTestId("kanban-column-body");
    expect(body).toBeInTheDocument();
    expect(within(body).queryAllByTestId("board-card")).toHaveLength(0);
  });

  it("TC-18: all six columns present with empty card-list when board has no items", () => {
    render(<Board items={emptyBoardItems()} />);
    const columns = screen.getAllByTestId("kanban-column");
    expect(columns).toHaveLength(6);
    for (const column of columns) {
      expect(within(column).getByTestId("kanban-column-header")).toBeInTheDocument();
      const body = within(column).getByTestId("kanban-column-body");
      expect(within(body).queryAllByTestId("board-card")).toHaveLength(0);
    }
  });
});

describe("Card navigation target (S-01)", () => {
  it("TC-19: card subtree has exactly one interactive target", () => {
    const { container } = render(
      <BoardCard card={fullBoardItems()[0]} workspaceKey="alpha" />
    );
    const card = within(container).getByTestId("board-card");
    const semantic = Array.from(
      card.querySelectorAll("a[href], button, input, select, textarea")
    );
    const ariaInteractive = Array.from(
      card.querySelectorAll(
        "[role='button'], [role='link'], [role='checkbox'], [role='menuitem'], [role='option'], [role='tab'], [role='switch']"
      )
    );
    const set = new Set<Element>();
    if (
      card.tagName.toLowerCase() === "a" &&
      (card as HTMLAnchorElement).hasAttribute("href")
    ) {
      set.add(card);
    }
    if (
      card.matches(
        "button, input, select, textarea, [role='button'], [role='link'], [role='checkbox'], [role='menuitem'], [role='option'], [role='tab'], [role='switch']"
      )
    ) {
      set.add(card);
    }
    semantic.forEach((el) => set.add(el));
    ariaInteractive.forEach((el) => set.add(el));
    expect(set.size).toBe(1);
    const only = [...set][0];
    expect(only.tagName.toLowerCase()).toBe("a");
    expect((only as HTMLAnchorElement).getAttribute("href")).toContain(
      "UI-IDEA"
    );
  });

  it("TC-20: clicking interior regions does not stop the navigation event", () => {
    render(
      <BoardCard card={fullBoardItems()[0]} workspaceKey="alpha" />
    );
    const card = screen.getByTestId("board-card") as HTMLAnchorElement;
    const code = screen.getByTestId("board-card-code");
    const title = screen.getByTestId("board-card-title");
    const chip = screen.getByTestId("board-card-status-chip");

    for (const region of [code, title, chip]) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      region.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      let cursor: HTMLElement | null = region as HTMLElement;
      let foundAnchor = false;
      while (cursor) {
        if (cursor.tagName === "A") {
          foundAnchor = true;
          break;
        }
        cursor = cursor.parentElement;
      }
      expect(foundAnchor).toBe(true);
    }
    expect(card.getAttribute("href")).toContain("UI-IDEA");
  });

  it("TC-21: card root is the navigation anchor with the item-detail href", () => {
    render(
      <BoardCard card={fullBoardItems()[0]} workspaceKey="alpha" />
    );
    const card = screen.getByTestId("board-card");
    expect(card.tagName.toLowerCase()).toBe("a");
    const href = (card as HTMLAnchorElement).getAttribute("href") ?? "";
    expect(href).toContain("UI-IDEA");
    expect(href).toContain("alpha");
  });
});

describe("Edge cases (S-01)", () => {
  it("EC-stage-null: implementation card with null current_stage renders inactive stepper", () => {
    render(<BoardCard card={implementationCardWithStage(null)} />);
    const stepper = screen.getByTestId("mini-stepper");
    const segments = within(stepper).getAllByRole("listitem");
    for (const seg of segments) {
      expect(seg.getAttribute("data-active")).toBe("false");
    }
  });
});
