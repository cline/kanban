/**
 * Auth Enforcement E2E specs — Desktop auth token model.
 *
 * Proves that the desktop auth token model is active and requests are
 * differentiated correctly:
 *
 * 1. Renderer-context fetch (page.evaluate) goes through the Electron session
 *    interceptor and gets the Authorization header injected automatically.
 * 2. Raw Node-side fetch bypasses the Electron session and is rejected by the
 *    runtime auth middleware.
 * 3. Node-side fetch with the correct Authorization header succeeds.
 *
 * Claims covered:
 * - Desktop auth token model and runtime auth middleware are active
 * - installAuthHeaderInterceptor() in auth.ts is wired correctly
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

test.describe("auth enforcement", () => {
	// Generous timeout to accommodate Electron startup + runtime child init.
	test.setTimeout(120_000);

	test("authenticated renderer request succeeds (auth injected by Electron session)", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { page } = launched;

			// Use renderer-side fetch (page.evaluate), NOT page.request, to
			// exercise the real Electron session / cookie path.  The session
			// interceptor (installAuthHeaderInterceptor) injects the
			// Authorization: Bearer header automatically for requests to the
			// runtime origin.
			const ok = await page.evaluate(async () => {
				const res = await fetch("/api/trpc/runtime.getConfig", {
					method: "GET",
					credentials: "same-origin",
				});
				return res.ok;
			});

			expect(ok).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});

	test("direct unauthenticated request to runtime is rejected", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { runtimeUrl } = launched;

			// Use Node-side fetch (from the test process, NOT page.evaluate)
			// against the runtime URL with NO Authorization header.  This
			// bypasses the Electron session interceptor entirely.
			const response = await fetch(
				`${runtimeUrl}/api/trpc/runtime.getConfig`,
			);

			// The runtime auth middleware should reject this with 401 or 403.
			expect([401, 403]).toContain(response.status);
		} finally {
			await launched?.cleanup();
		}
	});

	test("node-side request with explicit auth header succeeds", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { runtimeUrl, runtimeDescriptorDir } = launched;

			// Read the runtime descriptor file written by the desktop app to
			// obtain the ephemeral auth token.  The descriptor is written to
			// the isolated temp directory provided via
			// KANBAN_DESKTOP_RUNTIME_DESCRIPTOR_DIR.
			const descriptorPath = join(runtimeDescriptorDir, "runtime.json");
			const raw = await readFile(descriptorPath, "utf-8");
			const descriptor = JSON.parse(raw) as { authToken: string };

			expect(descriptor.authToken).toBeTruthy();

			// Make a Node-side request WITH the correct Authorization header.
			const response = await fetch(
				`${runtimeUrl}/api/trpc/runtime.getConfig`,
				{
					headers: {
						Authorization: `Bearer ${descriptor.authToken}`,
					},
				},
			);

			expect(response.ok).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});
});
