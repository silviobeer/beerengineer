import { expect, test } from "@playwright/test";

test.describe("workspace board", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the active workspace and switches the board globally", async ({ page }) => {
    const workspaceSwitcher = page.getByLabel(/workspace/i);

    await expect(workspaceSwitcher).toHaveText(/alpha workspace/i);
    await expect(
      page.locator("article").filter({
        has: page.getByRole("heading", { name: /live board shell integration/i })
      })
    ).toBeVisible();

    await workspaceSwitcher.click();
    await page.getByRole("option", { name: /beta workspace/i }).click();

    await expect(workspaceSwitcher).toHaveText(/beta workspace/i);
    await expect(
      page.locator("article").filter({
        has: page.getByRole("heading", { name: /release readiness verification/i })
      })
    ).toBeVisible();
    await expect(page.getByText("Live board shell integration")).toHaveCount(0);
  });

  test("groups live items into their real workflow columns", async ({ page }) => {
    const expectedColumns = [
      ["Idea", "ITEM-0001"],
      ["Implementation", "ITEM-0002"]
    ] as const;

    for (const [columnTitle, itemCode] of expectedColumns) {
      const column = page.locator("section").filter({
        has: page.getByRole("heading", { name: columnTitle })
      });

      await expect(column).toBeVisible();
      await expect(column.getByText(itemCode)).toBeVisible();
    }
  });

  test("shows code, title, mode, and attention signal on each live board card", async ({ page }) => {
    const card = page.locator("article").filter({
      has: page.getByRole("heading", { name: /live read adapter hardening/i })
    });

    await expect(card.getByText("ITEM-0002")).toBeVisible();
    await expect(card.getByRole("heading", { name: /live read adapter hardening/i })).toBeVisible();
    await expect(card.getByLabel(/mode/i)).toHaveAttribute("aria-label", /mode: (manual|assisted|auto)/i);
    await expect(card.getByLabel(/attention/i)).toHaveAttribute("aria-label", /attention: failed/i);
  });

  test("shows an explicit empty state for a workspace without items", async ({ page }) => {
    const workspaceSwitcher = page.getByLabel(/workspace/i);
    await workspaceSwitcher.click();
    await page.getByRole("option", { name: /empty workspace/i }).click();

    await expect(page.getByText("No items")).toBeVisible();
    await expect(page.getByText(/this workspace has no board items yet/i)).toBeVisible();
  });

  test("shows a failure state when live board data is unavailable", async ({ page }) => {
    const workspaceSwitcher = page.getByLabel(/workspace/i);
    await workspaceSwitcher.click();
    await page.getByRole("option", { name: /broken workspace/i }).click();

    await expect(page.getByText("Live data unavailable")).toBeVisible();
    await expect(page.getByText(/configured to simulate a live-data outage/i)).toBeVisible();
  });
});
