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

test("clicking a card opens detail view", async ({ page }) => {
	await page.goto("/");
	await page.getByText("Implement board shell").click();
	await expect(page.getByText("Agent Chat")).toBeVisible();
	await expect(page.getByText("Changes")).toBeVisible();
	await expect(page.getByText("Files")).toBeVisible();
});

test("escape key returns to board from detail view", async ({ page }) => {
	await page.goto("/");
	await page.getByText("Implement board shell").click();
	await expect(page.getByText("Agent Chat")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByText("Backlog")).toBeVisible();
});
