import { expect, test } from "@playwright/test";

test("renders kanban top bar and columns", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByText("Kanbanana", { exact: true })).toBeVisible();
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	await expect(page.getByText("To Do", { exact: true })).toBeVisible();
	await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
	await expect(page.getByText("Ready for Review", { exact: true })).toBeVisible();
	await expect(page.getByText("Done", { exact: true })).toBeVisible();
});

test("clicking a card opens detail view", async ({ page }) => {
	await page.goto("/");
	await page.getByText("Wire ACP task runs into board lifecycle").click();
	await expect(page.getByText("Type / for commands", { exact: true })).toBeVisible();
	await expect(page.getByText("No diff yet. Move this task to In Progress to generate changes.")).toBeVisible();
	await expect(page.getByText("Files touched by ACP tool calls will appear here.")).toBeVisible();
});

test("escape key returns to board from detail view", async ({ page }) => {
	await page.goto("/");
	await page.getByText("Wire ACP task runs into board lifecycle").click();
	await expect(page.getByText("Type / for commands", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
});
