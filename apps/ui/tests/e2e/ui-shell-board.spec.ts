import { expect, test } from "@playwright/test";

test.describe("workspace board", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the active workspace and switches the board globally", async ({ page }) => {
    const workspaceSwitcher = page.getByLabel(/workspace/i);

    await expect(workspaceSwitcher).toHaveText(/alpha workspace/i);

    await workspaceSwitcher.click();
    await page.getByRole("option", { name: /beta workspace/i }).click();

    await expect(workspaceSwitcher).toHaveText(/beta workspace/i);
    await expect(page.getByRole("heading", { name: /beta workspace/i })).toBeVisible();
    await expect(page.getByText("ITEM-0200")).toBeVisible();
    await expect(page.getByText("ITEM-0100")).toHaveCount(0);
  });

  test("groups real items into idea, brainstorm, requirements, implementation, and done", async ({ page }) => {
    const expectedColumns = [
      ["Idea", "ITEM-0100"],
      ["Brainstorm", "ITEM-0101"],
      ["Requirements", "ITEM-0102"],
      ["Implementation", "ITEM-0103"],
      ["Done", "ITEM-0104"]
    ] as const;

    for (const [columnTitle, itemCode] of expectedColumns) {
      const column = page.locator("section").filter({
        has: page.getByRole("heading", { name: columnTitle })
      });

      await expect(column).toBeVisible();
      await expect(column.getByText(itemCode)).toBeVisible();
    }
  });

  test("shows code, title, mode, and attention signal on each board card", async ({ page }) => {
    const card = page.locator("article").filter({
      has: page.getByRole("heading", { name: /board workspace query service/i })
    });

    await expect(card.getByText("ITEM-0103")).toBeVisible();
    await expect(card.getByRole("heading", { name: /board workspace query service/i })).toBeVisible();
    await expect(card.getByLabel(/mode/i)).toHaveText(/auto/i);
    await expect(card.getByLabel(/attention/i)).toHaveText(/failed/i);
  });
});
