import { expect, test, type Page } from "@playwright/test";

async function createTaskFromBacklog(page: Page, title: string) {
	await page.getByRole("button", { name: "New task" }).click();
	await page.getByPlaceholder("Task title...").fill(title);
	await page.getByPlaceholder("Task title...").press("Enter");
}

test("renders kanban top bar and columns", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByText("Kanbanana", { exact: true })).toBeVisible();
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	await expect(page.getByText("To Do", { exact: true })).toBeVisible();
	await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
	await expect(page.getByText("Ready for Review", { exact: true })).toBeVisible();
	await expect(page.getByText("Done", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "New task" })).toBeVisible();
});

test("creating and opening a task shows the detail view", async ({ page }) => {
	await page.goto("/");
	const taskTitle = "Smoke task";
	await createTaskFromBacklog(page, taskTitle);
	await page.getByText(taskTitle, { exact: true }).click();
	await expect(page.getByText("Type / for commands", { exact: true })).toBeVisible();
	await expect(page.getByText("No diff yet. Move this task out of Backlog to kick off agent work.")).toBeVisible();
	await expect(page.getByText("Files touched by ACP tool calls will appear here.")).toBeVisible();
});

test("escape key returns to board from detail view", async ({ page }) => {
	await page.goto("/");
	const taskTitle = "Escape task";
	await createTaskFromBacklog(page, taskTitle);
	await page.getByText(taskTitle, { exact: true }).click();
	await expect(page.getByText("Type / for commands", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
});

test("settings button opens runtime settings dialog", async ({ page }) => {
	await page.goto("/");
	await page.getByTestId("open-settings-button").click();
	await expect(page.getByText("ACP Runtime Setup", { exact: true })).toBeVisible();
});
