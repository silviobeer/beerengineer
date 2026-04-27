import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import { ItemDetailToolbar } from "../app/_ui/ItemDetailToolbar";
import type { ActionResult, ItemAction } from "../app/_engine/types";
import { neverResolves, success } from "./fixtures";

const ALL_ACTIONS = [
  "start_brainstorm",
  "start_implementation",
  "rerun_design_prep",
  "promote_to_requirements",
  "mark_done",
] as const;

const LABELS: Record<(typeof ALL_ACTIONS)[number], string> = {
  start_brainstorm: "Start Brainstorm",
  start_implementation: "Start Implementation",
  rerun_design_prep: "Rerun Design Prep",
  promote_to_requirements: "Promote to Requirements",
  mark_done: "Mark Done",
};

function noopAction(): Promise<ActionResult> {
  return Promise.resolve(success);
}

function isDisabled(button: HTMLElement): boolean {
  return (
    (button as HTMLButtonElement).disabled === true ||
    button.getAttribute("aria-disabled") === "true"
  );
}

describe("ItemDetailToolbar — buttons + enable/disable (TC-05..TC-08, TC-16)", () => {
  it("TC-05: renders exactly five buttons with the specified labels", () => {
    render(
      <ItemDetailToolbar allowedActions={[...ALL_ACTIONS]} onAction={noopAction} />,
    );
    const toolbar = screen.getByRole("toolbar", { name: /item actions/i });
    const buttons = within(toolbar).getAllByRole("button");
    expect(buttons).toHaveLength(5);
    const labels = buttons.map(b => b.textContent?.trim());
    expect(labels).toEqual([
      "Start Brainstorm",
      "Start Implementation",
      "Rerun Design Prep",
      "Promote to Requirements",
      "Mark Done",
    ]);
  });

  it("TC-06: per-action enable mapping — only the listed action is enabled", () => {
    for (const enabled of ALL_ACTIONS) {
      const { unmount } = render(
        <ItemDetailToolbar allowedActions={[enabled]} onAction={noopAction} />,
      );
      for (const action of ALL_ACTIONS) {
        const btn = screen.getByRole("button", { name: LABELS[action] });
        if (action === enabled) {
          expect(isDisabled(btn)).toBe(false);
        } else {
          expect(isDisabled(btn)).toBe(true);
        }
      }
      unmount();
    }
  });

  it("TC-07: button is disabled when its action is absent", () => {
    const allowed = ALL_ACTIONS.filter(a => a !== "rerun_design_prep");
    render(<ItemDetailToolbar allowedActions={allowed} onAction={noopAction} />);
    const rerun = screen.getByRole("button", { name: "Rerun Design Prep" });
    expect(isDisabled(rerun)).toBe(true);
    for (const action of allowed) {
      const btn = screen.getByRole("button", { name: LABELS[action] });
      expect(isDisabled(btn)).toBe(false);
    }
  });

  it("TC-08: mixed allowedActions produces correct enabled/disabled split", () => {
    render(
      <ItemDetailToolbar
        allowedActions={["start_brainstorm", "mark_done"]}
        onAction={noopAction}
      />,
    );
    expect(isDisabled(screen.getByRole("button", { name: "Start Brainstorm" }))).toBe(false);
    expect(isDisabled(screen.getByRole("button", { name: "Mark Done" }))).toBe(false);
    expect(isDisabled(screen.getByRole("button", { name: "Start Implementation" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Rerun Design Prep" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Promote to Requirements" }))).toBe(true);
  });

  it("TC-16: empty allowedActions disables all five buttons", () => {
    render(<ItemDetailToolbar allowedActions={[]} onAction={noopAction} />);
    for (const action of ALL_ACTIONS) {
      const btn = screen.getByRole("button", { name: LABELS[action] });
      expect(isDisabled(btn)).toBe(true);
    }
  });
});

describe("ItemDetailToolbar — click behavior (TC-10, TC-11, TC-12)", () => {
  it("TC-10: button appearance does not change while POST is in flight", () => {
    const onAction = vi.fn().mockImplementation(neverResolves);
    render(
      <ItemDetailToolbar
        allowedActions={["start_brainstorm"]}
        onAction={onAction}
      />,
    );
    const button = screen.getByRole("button", { name: "Start Brainstorm" });
    const labelBefore = button.textContent;
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe(labelBefore);
    expect(isDisabled(button)).toBe(false);
    const toolbar = screen.getByRole("toolbar", { name: /item actions/i });
    expect(within(toolbar).queryByRole("status")).toBeNull();
    expect(toolbar.textContent).not.toMatch(/loading|spinner|pending/i);
  });

  it("TC-11: clicking a disabled button sends no network request", () => {
    const onAction = vi.fn().mockResolvedValue(success);
    render(<ItemDetailToolbar allowedActions={[]} onAction={onAction} />);
    for (const action of ALL_ACTIONS) {
      const btn = screen.getByRole("button", { name: LABELS[action] });
      fireEvent.click(btn);
    }
    expect(onAction).not.toHaveBeenCalled();
  });

  it("TC-12: clicking a disabled button produces no operator-visible change", () => {
    const onAction = vi.fn().mockResolvedValue(success);
    render(
      <ItemDetailToolbar allowedActions={["mark_done"]} onAction={onAction} />,
    );
    const button = screen.getByRole("button", { name: "Start Brainstorm" });
    expect(isDisabled(button)).toBe(true);
    fireEvent.click(button);
    expect(button.textContent?.trim()).toBe("Start Brainstorm");
    expect(isDisabled(button)).toBe(true);
    expect(screen.queryByTestId("toolbar-error")).toBeNull();
    const toolbar = screen.getByRole("toolbar", { name: /item actions/i });
    expect(toolbar.textContent).not.toMatch(/loading|spinner/i);
  });
});

describe("ItemDetailToolbar — duplicate submission guard (EC-05)", () => {
  it("does not stack duplicate submissions while a request is in flight", () => {
    const onAction = vi.fn().mockImplementation(neverResolves);
    render(
      <ItemDetailToolbar
        allowedActions={["start_brainstorm"]}
        onAction={onAction}
      />,
    );
    const button = screen.getByRole("button", { name: "Start Brainstorm" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
