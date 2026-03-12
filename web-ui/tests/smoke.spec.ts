import { expect, type Page, test } from "@playwright/test";

const PROJECT_PATH = "/Users/jose/Documents/GitHub/kanban";

/**
 * Ensure the kanban project exists and is selected, making the board visible.
 * 1. Calls the tRPC addProject API (idempotent).
 * 2. Waits for a project row and clicks it to select the project.
 * 3. Waits for the board to become visible.
 */
async function ensureProjectAndBoard(page: Page): Promise<void> {
	// Add the project if not already registered (raw JSON body, no superjson wrapper)
	await page.request.post("/api/trpc/projects.add", {
		headers: { "Content-Type": "application/json" },
		data: JSON.stringify({ path: PROJECT_PATH }),
	});

	// Wait for a project row and click it (it may already be selected)
	const projectRow = page.locator(".kb-project-row").first();
	await projectRow.waitFor({ state: "visible", timeout: 10000 });

	// Check if the board is already showing columns
	const boardColumn = page.locator(".kb-column-title-path").first();
	const isVisible = await boardColumn.isVisible().catch(() => false);

	if (!isVisible) {
		await projectRow.click();
		// Wait for the project-selected board to appear
		await boardColumn.waitFor({ state: "visible", timeout: 15000 });
	}
}

async function createTaskFromBacklog(page: Page, title: string) {
	// Use CSS class selector — more reliable than accessible name for styled buttons
	await page.locator("button.kb-create-task-trigger").click();
	await page.getByPlaceholder("Describe the task").fill(title);
	await page.getByPlaceholder("Describe the task").press("Enter");
}

test("renders kanban brand and navigation panel", async ({ page }) => {
	await page.goto("/");

	// The brand is always visible in the nav panel
	await expect(page.getByText("kanban", { exact: true })).toBeVisible();
	// Projects section header
	await expect(page.getByText("Projects", { exact: true })).toBeVisible();
	// Settings button always present in top bar
	await expect(page.getByTestId("open-settings-button")).toBeVisible();
});

test("renders kanban board columns", async ({ page }) => {
	await page.goto("/");
	await ensureProjectAndBoard(page);

	// Column headers
	await expect(page.locator(".kb-column-title-path").filter({ hasText: "Backlog" })).toBeVisible();
	await expect(page.locator(".kb-column-title-path").filter({ hasText: "In Progress" })).toBeVisible();
	await expect(page.locator(".kb-column-title-path").filter({ hasText: "Review" })).toBeVisible();
	await expect(page.locator(".kb-column-title-path").filter({ hasText: "Trash" })).toBeVisible();

	// Create task trigger
	await expect(page.locator("button.kb-create-task-trigger")).toBeVisible();
});

test("creating a task adds it to the backlog", async ({ page }) => {
	await page.goto("/");
	await ensureProjectAndBoard(page);

	// Use a timestamp to avoid collisions with tasks from previous test runs
	const taskTitle = `Smoke-${Date.now()}`;
	await createTaskFromBacklog(page, taskTitle);

	// The created task should appear on the board
	await expect(page.getByText(taskTitle)).toBeVisible();
});

test("escape key dismisses the inline task editor", async ({ page }) => {
	await page.goto("/");
	await ensureProjectAndBoard(page);

	// Open the create task form
	await page.locator("button.kb-create-task-trigger").click();
	await expect(page.getByPlaceholder("Describe the task")).toBeVisible();

	// Escape should close the form and return to the board
	await page.keyboard.press("Escape");
	await expect(page.locator(".kb-column-title-path").first()).toBeVisible();
});

test("clicking a backlog task opens its inline editor", async ({ page }) => {
	await page.goto("/");
	await ensureProjectAndBoard(page);

	// Create a task so there's something to click
	const taskTitle = `Edit-${Date.now()}`;
	await createTaskFromBacklog(page, taskTitle);

	// Click the created task card to open its inline editor
	await page.getByText(taskTitle).click();

	// The inline editor should appear pre-filled with the task prompt
	const editor = page.getByPlaceholder("Describe the task");
	await expect(editor).toBeVisible();

	// Escape should close the editor and return to the board
	await page.keyboard.press("Escape");
	await expect(page.locator(".kb-column-title-path").first()).toBeVisible();
});

test("settings button opens runtime settings dialog", async ({ page }) => {
	await page.goto("/");
	await page.getByTestId("open-settings-button").click();
	// The settings dialog contains the "Agent runtime" section
	await expect(page.getByText("Agent runtime", { exact: true })).toBeVisible();
});
