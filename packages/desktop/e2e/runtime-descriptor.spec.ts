/**
 * Runtime Descriptor E2E specs — runtime.json lifecycle.
 *
 * Tests cover:
 * - runtime.json is written during startup for CLI discovery
 * - runtime.json contains expected fields (url, authToken, pid, source)
 * - runtime.json is cleaned up on graceful shutdown
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

interface RuntimeDescriptor {
	url: string;
	authToken: string;
	pid: number;
	updatedAt: string;
	source: string;
	desktopSessionId?: string;
}

function findRuntimeDescriptor(descriptorDir: string): RuntimeDescriptor | null {
	const directPath = join(descriptorDir, "runtime.json");
	if (existsSync(directPath)) {
		return JSON.parse(readFileSync(directPath, "utf-8"));
	}
	try {
		for (const entry of readdirSync(descriptorDir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				const nested = join(descriptorDir, entry.name, "runtime.json");
				if (existsSync(nested)) {
					return JSON.parse(readFileSync(nested, "utf-8"));
				}
			}
		}
	} catch {
		// Directory may not exist yet.
	}
	return null;
}

test.describe("runtime descriptor file", () => {
	test.setTimeout(120_000);

	test("runtime.json is written during startup with expected fields", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { runtimeDescriptorDir, runtimeUrl } = launched;

			const descriptor = findRuntimeDescriptor(runtimeDescriptorDir);

			expect(descriptor).toBeTruthy();
			expect(descriptor!.url).toBeTruthy();
			expect(descriptor!.url.startsWith("http")).toBe(true);
			expect(descriptor!.authToken).toBeTruthy();
			expect(typeof descriptor!.pid).toBe("number");
			expect(descriptor!.pid).toBeGreaterThan(0);
			expect(descriptor!.source).toBe("desktop");
			expect(descriptor!.updatedAt).toBeTruthy();

			const descriptorOrigin = new URL(descriptor!.url).origin;
			expect(descriptorOrigin).toBe(runtimeUrl);
		} finally {
			await launched?.cleanup();
		}
	});

	test("runtime.json authToken matches the session auth token", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { runtimeDescriptorDir, runtimeUrl } = launched;

			const descriptor = findRuntimeDescriptor(runtimeDescriptorDir);
			expect(descriptor).toBeTruthy();

			const response = await fetch(
				`${runtimeUrl}/api/trpc/runtime.getConfig`,
				{
					headers: {
						Authorization: `Bearer ${descriptor!.authToken}`,
					},
				},
			);

			expect(response.ok).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});

	test("runtime.json is cleaned up on graceful shutdown", async () => {
		const harness = await launchDesktopApp();
		const { runtimeDescriptorDir } = harness;

		const preShutdown = findRuntimeDescriptor(runtimeDescriptorDir);
		expect(preShutdown).toBeTruthy();

		await harness.cleanup();

		const postShutdown = findRuntimeDescriptor(runtimeDescriptorDir);

		if (postShutdown) {
			let reachable = false;
			try {
				const ctrl = new AbortController();
				setTimeout(() => ctrl.abort(), 3_000);
				const res = await fetch(`${postShutdown.url}/api/health`, {
					signal: ctrl.signal,
				});
				reachable = res.ok;
			} catch {
				reachable = false;
			}
			expect(reachable).toBe(false);
		}
	});
});
