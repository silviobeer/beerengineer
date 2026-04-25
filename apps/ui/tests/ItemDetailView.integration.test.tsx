import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ItemDetailView } from "../app/_ui/ItemDetailView";
import {
  FX_01,
  FX_02,
  FX_09,
  conflict409,
  unprocessable422,
  success,
} from "./fixtures";
import type { ActionResult } from "../app/_engine/types";

function isDisabled(button: HTMLElement): boolean {
  return (
    (button as HTMLButtonElement).disabled === true ||
    button.getAttribute("aria-disabled") === "true"
  );
}

function deferredAction() {
  let resolveFn!: (value: ActionResult) => void;
  const promise = new Promise<ActionResult>(resolve => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn };
}

describe("ItemDetail integration (TC-04, TC-09, TC-13..TC-15, TC-17..TC-19)", () => {
  it("TC-04: header data from FX-01 maps to itemCode, title, chip", () => {
    render(<ItemDetailView item={FX_01} onAction={() => Promise.resolve(success)} />);
    expect(screen.getByText("BEER-007")).toBeInTheDocument();
    expect(screen.getByText("Auth overhaul")).toBeInTheDocument();
    const chip = screen.getByTestId("status-chip");
    expect(chip.textContent).toMatch(/Implementation/);
    expect(chip.textContent).toMatch(/Exec/);
  });

  it("TC-09: clicking each enabled button calls onAction with the matching action name", async () => {
    const onAction = vi.fn().mockResolvedValue(success);
    const item = { ...FX_01, allowedActions: ["start_brainstorm", "start_implementation"] };
    render(<ItemDetailView item={item} onAction={onAction} />);
    const brainstorm = screen.getByRole("button", { name: "Start Brainstorm" });
    await act(async () => {
      fireEvent.click(brainstorm);
    });
    expect(onAction).toHaveBeenLastCalledWith("start_brainstorm");
    const impl = screen.getByRole("button", { name: "Start Implementation" });
    await act(async () => {
      fireEvent.click(impl);
    });
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction).toHaveBeenLastCalledWith("start_implementation");
  });

  it("TC-13: 409 response shows a visible inline error", async () => {
    const onAction = vi.fn().mockResolvedValue(conflict409);
    render(<ItemDetailView item={FX_01} onAction={onAction} />);
    const brainstorm = screen.getByRole("button", { name: "Start Brainstorm" });
    await act(async () => {
      fireEvent.click(brainstorm);
    });
    const error = await screen.findByTestId("toolbar-error");
    expect(error).toBeVisible();
    expect(error.textContent ?? "").toMatch(/409/);
    expect(error.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("TC-14: 422 response shows a visible inline error", async () => {
    const onAction = vi.fn().mockResolvedValue(unprocessable422);
    render(<ItemDetailView item={FX_01} onAction={onAction} />);
    const brainstorm = screen.getByRole("button", { name: "Start Brainstorm" });
    await act(async () => {
      fireEvent.click(brainstorm);
    });
    const error = await screen.findByTestId("toolbar-error");
    expect(error).toBeVisible();
    expect(error.textContent ?? "").toMatch(/422/);
  });

  it("TC-15: no button stuck pending after 409", async () => {
    const onAction = vi.fn().mockResolvedValue(conflict409);
    render(<ItemDetailView item={FX_01} onAction={onAction} />);
    const button = screen.getByRole("button", { name: "Start Brainstorm" });
    const labelBefore = button.textContent;
    await act(async () => {
      fireEvent.click(button);
    });
    await screen.findByTestId("toolbar-error");
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(button.textContent).toBe(labelBefore);
    for (const b of buttons) {
      expect(b.textContent ?? "").not.toMatch(/loading|spinner|pending|…|\.\.\./i);
    }
  });

  it("TC-19: no button stuck pending after 422", async () => {
    const onAction = vi.fn().mockResolvedValue(unprocessable422);
    render(<ItemDetailView item={FX_01} onAction={onAction} />);
    const button = screen.getByRole("button", { name: "Start Brainstorm" });
    const labelBefore = button.textContent;
    await act(async () => {
      fireEvent.click(button);
    });
    await screen.findByTestId("toolbar-error");
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(button.textContent).toBe(labelBefore);
    for (const b of buttons) {
      expect(b.textContent ?? "").not.toMatch(/loading|spinner|pending|…|\.\.\./i);
    }
  });

  it("TC-17: toolbar fully renders and is interactive when currentRunId is null (FX-09)", async () => {
    const onAction = vi.fn().mockResolvedValue(success);
    render(<ItemDetailView item={FX_09} onAction={onAction} />);
    expect(screen.getAllByRole("button")).toHaveLength(5);
    const brainstorm = screen.getByRole("button", { name: "Start Brainstorm" });
    expect(isDisabled(brainstorm)).toBe(false);
    for (const label of [
      "Start Implementation",
      "Rerun Design Prep",
      "Promote to Requirements",
      "Mark Done",
    ]) {
      expect(isDisabled(screen.getByRole("button", { name: label }))).toBe(true);
    }
    await act(async () => {
      fireEvent.click(brainstorm);
    });
    expect(onAction).toHaveBeenCalledWith("start_brainstorm");
  });

  it("TC-18: button appearance does not change after success POST resolves but before re-fetch", async () => {
    const deferred = deferredAction();
    const onAction = vi.fn().mockReturnValue(deferred.promise);
    const { rerender } = render(
      <ItemDetailView item={FX_01} onAction={onAction} />,
    );
    const brainstorm = screen.getByRole("button", { name: "Start Brainstorm" });
    const labelBefore = brainstorm.textContent;
    const phaseBefore = screen.getByTestId("status-chip").textContent;
    fireEvent.click(brainstorm);
    await act(async () => {
      deferred.resolve(success);
    });
    // POST succeeded but no re-fetch happened — page state must not have changed.
    expect(brainstorm.textContent).toBe(labelBefore);
    expect(screen.getByTestId("status-chip").textContent).toBe(phaseBefore);
    expect(screen.queryByTestId("toolbar-error")).toBeNull();
    expect(brainstorm).not.toBeDisabled();
    // Now simulate the re-fetch delivering new item state — only then should the chip change.
    rerender(
      <ItemDetailView
        item={{ ...FX_01, phase_status: "test", current_stage: null }}
        onAction={onAction}
      />,
    );
    expect(screen.getByTestId("status-chip").textContent).toMatch(/Test/);
  });
});

describe("ItemDetail integration — empty allowedActions (FX-02)", () => {
  it("renders all five buttons disabled when allowedActions is empty", () => {
    render(<ItemDetailView item={FX_02} onAction={() => Promise.resolve(success)} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
    for (const b of buttons) expect(isDisabled(b)).toBe(true);
  });
});
