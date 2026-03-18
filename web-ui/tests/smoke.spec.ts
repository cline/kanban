import { expect, type Page, test } from "@playwright/test";

async function createTaskFromBacklog(page: Page, title: string) {
	const backlogColumn = page.locator('[data-column-id="backlog"]').first();
	await backlogColumn.getByRole("button", { name: "Create task" }).click();
	const prompt = page.getByPlaceholder("Describe the task");
	await prompt.fill(title);
	await prompt.press("Control+Enter");
}

async function openTaskFromBoard(page: Page, title: string) {
	const card = page.locator("[data-task-id]").filter({ hasText: title }).first();
	await expect(card).toBeVisible();
	await card.click();
}

test("renders kanban top bar and columns", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle(/Kanban/);
	await expect(page.getByRole("button", { name: "Projects" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Agent" })).toBeVisible();
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
	await expect(page.getByText("Review", { exact: true })).toBeVisible();
	await expect(page.getByText("Trash", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Create task" })).toBeVisible();
});

test("creating and opening a backlog task shows the inline editor", async ({ page }) => {
	await page.goto("/");
	const taskTitle = `smoke-${Date.now()}`;
	await createTaskFromBacklog(page, taskTitle);
	await openTaskFromBoard(page, taskTitle);
	await expect(page.getByPlaceholder("Describe the task")).toHaveValue(taskTitle);
	await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
});

test("escape key closes the backlog inline editor", async ({ page }) => {
	await page.goto("/");
	const taskTitle = `escape-${Date.now()}`;
	await createTaskFromBacklog(page, taskTitle);
	await openTaskFromBoard(page, taskTitle);
	await expect(page.getByPlaceholder("Describe the task")).toHaveValue(taskTitle);
	await page.keyboard.press("Escape");
	await expect(page.getByPlaceholder("Describe the task")).toHaveCount(0);
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	await expect(page.locator("[data-task-id]").filter({ hasText: taskTitle }).first()).toBeVisible();
});

test("settings button opens runtime settings dialog", async ({ page }) => {
	await page.goto("/");
	await page.getByTestId("open-settings-button").click();
	await expect(page.getByRole("dialog").getByText("Settings", { exact: true })).toBeVisible();
});
