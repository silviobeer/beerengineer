import { expect, test } from "@playwright/test";

test.describe("UI shell smoke", () => {
  test("renders the board shell and primary workflow columns", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Workspace board" })).toBeVisible();
    await expect(page.getByLabel("Workspace")).toHaveText(/alpha workspace/i);
    await expect(page.getByRole("heading", { level: 3, name: "Idea" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Brainstorm" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Requirements" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Implementation" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Done" })).toBeVisible();
  });

  test("exposes the current workspace summary in the top control bar", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".workspace-switcher").getByText("Active workspace", { exact: true })).toBeVisible();
    await expect(page.locator(".workspace-switcher")).toContainText("Primary delivery scope");
  });
});
