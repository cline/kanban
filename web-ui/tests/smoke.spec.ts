import { expect, test } from "@playwright/test";

test("renders hello world", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Hello world" })).toBeVisible();
});
