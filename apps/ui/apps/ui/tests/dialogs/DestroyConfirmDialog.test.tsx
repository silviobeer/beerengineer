import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DestroyConfirmDialog } from "@/components/dialogs/DestroyConfirmDialog";

describe("DestroyConfirmDialog", () => {
  it("requires exact typed branch name and supports cancel/escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DestroyConfirmDialog expectedName="branch-a" actionLabel="Destroy branch" onConfirm={onConfirm} onCancel={onCancel} />);
    const confirm = screen.getByRole("button", { name: "Destroy branch" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Branch name confirmation/), { target: { value: "Branch-a" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Branch name confirmation/), { target: { value: "branch-a" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
