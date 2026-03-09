import { expect, type Page, test } from "@playwright/test";

async function createTaskFromBacklog(page: Page, title: string) {
	await page.getByRole("button", { name: "Create task" }).click();
	await page.getByPlaceholder("Describe the task").fill(title);
	await page.getByPlaceholder("Describe the task").press("Enter");
}

test("renders kanban top bar and columns", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByText("Kanban", { exact: true })).toBeVisible();
	await expect(page).toHaveTitle(/Kanban/);
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
	await expect(page.getByText("Review", { exact: true })).toBeVisible();
	await expect(page.getByText("Trash", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Create task" })).toBeVisible();
});

test("creating and opening a task shows the detail view", async ({ page }) => {
	await page.goto("/");
	const taskTitle = "Smoke task";
	await createTaskFromBacklog(page, taskTitle);
	await page.getByText(taskTitle, { exact: true }).click();
	await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
	await expect(page.getByText("No diff yet for this task.")).toBeVisible();
	await expect(page.getByText("Changed files will appear here.")).toBeVisible();
});

test("escape key returns to board from detail view", async ({ page }) => {
	await page.goto("/");
	const taskTitle = "Escape task";
	await createTaskFromBacklog(page, taskTitle);
	await page.getByText(taskTitle, { exact: true }).click();
	await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
});

test("settings button opens runtime settings dialog", async ({ page }) => {
	await page.goto("/");
	await page.getByTestId("open-settings-button").click();
	await expect(page.getByText("Agent Runtime Setup", { exact: true })).toBeVisible();
});
