import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DestroyConfirmDialog } from "@/components/dialogs/DestroyConfirmDialog";

describe("DestroyConfirmDialog", () => {
  it("uses the project's neutral overlay token (bg-zinc-950/60) instead of bg-black/60", () => {
    const { container } = render(
      <DestroyConfirmDialog
        expectedName="branch-x"
        actionLabel="Destroy branch"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.className).toContain("bg-zinc-950/60");
    expect(dialog?.className).not.toContain("bg-black/60");
  });

  it("references the confirmation instruction via aria-describedby", () => {
    render(
      <DestroyConfirmDialog
        expectedName="branch-x"
        actionLabel="Destroy branch"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-describedby", "destroy-confirm-desc");

    const describedById = dialog.getAttribute("aria-describedby");
    const desc = describedById ? document.getElementById(describedById) : null;
    expect(desc).not.toBeNull();
    expect(desc?.tagName).toBe("P");
    expect(desc?.textContent).toMatch(/type/i);
    expect(desc?.textContent).toContain("branch-x");
  });
});
