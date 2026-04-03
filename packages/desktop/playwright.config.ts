import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	retries: 0,
	use: {
		headless: true,
	},
	/* No browser projects — Electron-only testing. */
	/* No webServer block — Electron launches the real app. */

	/* Future global setup / teardown:
	 * globalSetup: './e2e/global-setup.ts',
	 * globalTeardown: './e2e/global-teardown.ts',
	 */
});
