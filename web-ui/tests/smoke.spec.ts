import { expect, test } from "@playwright/test";

test("renders kanban top bar and columns", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByText("Kanbanana")).toBeVisible();
	await expect(page.getByText("Backlog")).toBeVisible();
	await expect(page.getByText("Planning")).toBeVisible();
	await expect(page.getByText("Running")).toBeVisible();
	await expect(page.getByText("Review")).toBeVisible();
	await expect(page.getByText("Done")).toBeVisible();
});
