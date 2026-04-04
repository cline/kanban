/**
 * Remote Connection E2E specs — switching to/from remote runtime servers.
 *
 * Tests cover:
 * - Switching from local to a remote HTTP server
 * - Auth header injection for the remote origin
 * - Fallback to local when a persisted remote connection is invalid
 *
 * A lightweight mock HTTP server acts as the "remote runtime".
 */

import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

// ---------------------------------------------------------------------------
// Mock remote server
// ---------------------------------------------------------------------------

interface MockRemoteServer {
	url: string;
	port: number;
	server: http.Server;
	receivedAuthHeaders: (string | undefined)[];
	close: () => Promise<void>;
}

function startMockRemoteServer(): Promise<MockRemoteServer> {
	return new Promise((resolve, reject) => {
		const receivedAuthHeaders: (string | undefined)[] = [];
		const server = http.createServer((req, res) => {
			receivedAuthHeaders.push(req.headers.authorization);
			if (req.url === "/api/health") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true, version: "mock" }));
				return;
			}
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(`<!DOCTYPE html><html><head><title>Mock Remote Kanban</title></head>
<body><h1>Mock Remote Runtime</h1></body></html>`);
		});
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(new Error("Failed to get server address"));
				return;
			}
			resolve({
				url: `http://127.0.0.1:${addr.port}`,
				port: addr.port,
				server,
				receivedAuthHeaders,
				close: () => new Promise<void>((r) => server.close(() => r())),
			});
		});
		server.on("error", reject);
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("remote connections", () => {
	test.setTimeout(180_000);

	test("can navigate to a remote server and receive requests", async () => {
		let launched: LaunchedDesktopApp | undefined;
		let remote: MockRemoteServer | undefined;

		try {
			remote = await startMockRemoteServer();
			launched = await launchDesktopApp();
			const { page, electronApp } = launched;

			// Verify we start in local mode.
			const initialUrl = new URL(page.url());
			expect(
				initialUrl.hostname === "localhost" || initialUrl.hostname === "127.0.0.1",
			).toBe(true);

			// Navigate the window to the mock remote server.
			await electronApp.evaluate(
				async ({ BrowserWindow }, { remoteUrl }) => {
					const win = BrowserWindow.getAllWindows()[0];
					if (win) await win.loadURL(remoteUrl);
				},
				{ remoteUrl: remote.url },
			);

			await page.waitForLoadState("domcontentloaded");
			const remotePageUrl = new URL(page.url());
			expect(remotePageUrl.port).toBe(String(remote.port));
			await expect(page.getByText("Mock Remote Runtime")).toBeVisible({ timeout: 10_000 });

			// The remote server received at least one request.
			expect(remote.receivedAuthHeaders.length).toBeGreaterThan(0);
		} finally {
			await launched?.cleanup();
			await remote?.close();
		}
	});

	test("auth header is injected for remote origin via session interceptor", async () => {
		let launched: LaunchedDesktopApp | undefined;
		let remote: MockRemoteServer | undefined;

		try {
			remote = await startMockRemoteServer();
			launched = await launchDesktopApp();
			const { page, electronApp } = launched;

			const remoteAuthToken = "test-remote-token-12345";

			// Install auth interceptor and navigate to remote.
			await electronApp.evaluate(
				async ({ BrowserWindow }, { remoteUrl, token }) => {
					const win = BrowserWindow.getAllWindows()[0];
					if (!win) return;
					const session = win.webContents.session;
					const origin = new URL(remoteUrl).origin;
					session.webRequest.onBeforeSendHeaders(
						{ urls: [`${origin}/*`] },
						(details, callback) => {
							const headers = { ...details.requestHeaders };
							headers["Authorization"] = `Bearer ${token}`;
							callback({ requestHeaders: headers });
						},
					);
					await win.loadURL(remoteUrl);
				},
				{ remoteUrl: remote.url, token: remoteAuthToken },
			);

			await page.waitForLoadState("domcontentloaded");

			// Trigger a renderer-side fetch to exercise the interceptor.
			await page.evaluate(async () => {
				await fetch("/api/health");
			});

			const bearerHeaders = remote.receivedAuthHeaders.filter(
				(h) => h?.startsWith("Bearer "),
			);
			expect(bearerHeaders.length).toBeGreaterThan(0);
			expect(bearerHeaders[0]).toBe(`Bearer ${remoteAuthToken}`);
		} finally {
			await launched?.cleanup();
			await remote?.close();
		}
	});

	test("fallback to local when persisted remote is unreachable", async () => {
		const sharedUserDataDir = await mkdtemp(
			join(tmpdir(), "kanban-e2e-remote-fallback-"),
		);
		let launched: LaunchedDesktopApp | undefined;

		try {
			mkdirSync(sharedUserDataDir, { recursive: true });
			const connectionsPath = join(sharedUserDataDir, "connections.json");
			writeFileSync(
				connectionsPath,
				JSON.stringify({
					connections: [
						{ id: "local", label: "Local", serverUrl: "" },
						{ id: "remote-dead", label: "Dead", serverUrl: "http://127.0.0.1:1", authToken: "x" },
					],
					activeConnectionId: "remote-dead",
				}, null, "\t"),
				"utf-8",
			);

			launched = await launchDesktopApp({ userDataDir: sharedUserDataDir });
			const { page } = launched;

			// If launchDesktopApp succeeded the fallback worked — runtime is healthy.
			const pageUrl = new URL(page.url());
			expect(
				pageUrl.hostname === "localhost" || pageUrl.hostname === "127.0.0.1",
			).toBe(true);

			// Persisted active connection should now be "local".
			const raw = readFileSync(connectionsPath, "utf-8");
			const data = JSON.parse(raw) as { activeConnectionId: string };
			expect(data.activeConnectionId).toBe("local");
		} finally {
			await launched?.cleanup();
			await rm(sharedUserDataDir, { recursive: true, force: true }).catch(() => {});
		}
	});
});
