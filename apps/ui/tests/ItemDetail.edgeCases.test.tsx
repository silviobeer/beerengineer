import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import { ItemDetailHeader } from "../app/_ui/ItemDetailHeader";
import { ItemDetailToolbar } from "../app/_ui/ItemDetailToolbar";
import { ItemDetailView } from "../app/_ui/ItemDetailView";
import { FX_01 } from "./fixtures";
import type { ActionResult } from "../app/_engine/types";

const ALL_LABELS = [
  "Start Brainstorm",
  "Start Implementation",
  "Rerun Design Prep",
  "Promote to Requirements",
  "Mark Done",
];

function isDisabled(button: HTMLElement): boolean {
  return (
    (button as HTMLButtonElement).disabled === true ||
    button.getAttribute("aria-disabled") === "true"
  );
}

const MONO_TOKENS = ["monospace", "courier", "menlo", "monaco", "consolas", "ui-monospace"];
function isMonospace(family: string): boolean {
  const f = family.toLowerCase();
  return MONO_TOKENS.some(t => f.includes(t));
}

describe("EC-01: unrecognized action name in allowedActions", () => {
  it("ignores unknown action and produces no extra button", () => {
    const onAction = vi.fn().mockResolvedValue({ ok: true, status: 200 } satisfies ActionResult);
    render(
      <ItemDetailToolbar
        allowedActions={["start_brainstorm", "totally_made_up_action"]}
        onAction={onAction}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
    const labels = buttons.map(b => b.textContent?.trim());
    expect(labels).toEqual(ALL_LABELS);
    expect(isDisabled(screen.getByRole("button", { name: "Start Brainstorm" }))).toBe(false);
    for (const label of ALL_LABELS.filter(l => l !== "Start Brainstorm")) {
      expect(isDisabled(screen.getByRole("button", { name: label }))).toBe(true);
    }
  });
});

describe("EC-02: itemCode with special characters preserves text + monospace", () => {
  it("renders 'BEER/042-v2' verbatim with a monospace family", () => {
    render(
      <ItemDetailHeader
        itemCode="BEER/042-v2"
        title="Special chars"
        phaseStatus="idea"
        currentStage={null}
      />,
    );
    const codeEl = screen.getByText("BEER/042-v2");
    expect(codeEl).toBeInTheDocument();
    const family = window.getComputedStyle(codeEl).fontFamily;
    expect(isMonospace(family)).toBe(true);
  });
});

describe("EC-03: very long title does not hide itemCode or status chip", () => {
  it("itemCode and chip remain present and not aria-hidden when title is 250 chars", () => {
    const longTitle = "A".repeat(250);
    render(
      <ItemDetailHeader
        itemCode="BEER-007"
        title={longTitle}
        phaseStatus="implementation"
        currentStage="exec"
      />,
    );
    const header = screen.getByRole("banner");
    const code = within(header).getByText("BEER-007");
    expect(code).toBeVisible();
    expect(code).not.toHaveAttribute("aria-hidden", "true");
    const chip = within(header).getByTestId("status-chip");
    expect(chip).toBeVisible();
    expect(chip).not.toHaveAttribute("aria-hidden", "true");
    // Title is rendered as a complete H1 (truncation, if any, must not remove it from the tree).
    expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent(longTitle);
  });
});

describe("EC-04: network failure during POST surfaces inline error", () => {
  it("rendered inline error when onAction rejects, no button stays pending", async () => {
    const onAction = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    render(<ItemDetailView item={FX_01} onAction={onAction} />);
    const button = screen.getByRole("button", { name: "Start Brainstorm" });
    const labelBefore = button.textContent;
    await act(async () => {
      fireEvent.click(button);
    });
    const error = await screen.findByTestId("toolbar-error");
    expect(error).toBeVisible();
    expect(error.textContent ?? "").toMatch(/ECONNREFUSED|Network|failed/i);
    // No stuck pending appearance.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(button.textContent).toBe(labelBefore);
    for (const b of buttons) {
      expect(b.textContent ?? "").not.toMatch(/loading|spinner|pending|…|\.\.\./i);
    }
  });

  it("after a failed click the button accepts a second attempt (in-flight guard releases on error)", async () => {
    let calls = 0;
    const onAction = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return { ok: true, status: 200 } as ActionResult;
    });
    render(<ItemDetailView item={FX_01} onAction={onAction} />);
    const button = screen.getByRole("button", { name: "Start Brainstorm" });
    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(onAction).toHaveBeenCalledTimes(2);
  });
});
