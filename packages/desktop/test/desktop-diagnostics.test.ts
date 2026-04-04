import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks (vi.mock is hoisted, so variables must be hoisted too)
// ---------------------------------------------------------------------------

const { appMock, safeStorageMock, getBootStateMock, readRuntimeDescriptorMock } = vi.hoisted(() => ({
	appMock: {
		getVersion: vi.fn().mockReturnValue("0.1.1"),
		isPackaged: false,
	},
	safeStorageMock: {
		isEncryptionAvailable: vi.fn().mockReturnValue(true),
	},
	getBootStateMock: vi.fn(),
	readRuntimeDescriptorMock: vi.fn(),
}));

vi.mock("electron", () => ({
	app: appMock,
	safeStorage: safeStorageMock,
}));
vi.mock("../src/desktop-boot-state.js", () => ({
	getBootState: getBootStateMock,
}));
vi.mock("kanban", () => ({
	readRuntimeDescriptor: readRuntimeDescriptorMock,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
	collectDiagnosticsSnapshot,
	redactUrlToOrigin,
	type DiagnosticsContext,
} from "../src/desktop-diagnostics.js";
import type { ConnectionStore, SavedConnection } from "../src/connection-store.js";
import type { RuntimeChildManager } from "../src/runtime-child.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultBootState() {
	return {
		currentPhase: "ready" as const,
		lastSuccessfulPhase: "initialize-connections" as const,
		failureCode: null,
		failureMessage: null,
		startedAt: "2026-04-03T00:00:00.000Z",
		phaseHistory: [
			{ phase: "preflight", timestamp: "2026-04-03T00:00:00.000Z" },
			{ phase: "ready", timestamp: "2026-04-03T00:00:01.000Z" },
		],
	};
}


function defaultCtx(overrides: Partial<DiagnosticsContext> = {}): DiagnosticsContext {
	return {
		connectionManager: null,
		connectionStore: null,
		runtimeManager: null,
		runtimeUrl: null,
		preflightResult: null,
		desktopSessionId: "session-abc",
		...overrides,
	};
}

function fakeStore(activeId = "local", extra: SavedConnection[] = []): ConnectionStore {
	const all: SavedConnection[] = [
		{ id: "local", label: "Local", serverUrl: "" },
		...extra,
	];
	return {
		getActiveConnection: () => all.find((c) => c.id === activeId) ?? all[0],
		getActiveConnectionId: () => activeId,
		getConnections: () => all,
		setActiveConnection: vi.fn(),
		isEncryptionAvailable: true,
	} as unknown as ConnectionStore;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	getBootStateMock.mockReturnValue(defaultBootState());
	readRuntimeDescriptorMock.mockResolvedValue(null);
});

describe("redactUrlToOrigin", () => {
	it("returns origin only from a full URL", () => {
		expect(redactUrlToOrigin("http://127.0.0.1:3000/api/v1?token=secret"))
			.toBe("http://127.0.0.1:3000");
	});

	it("returns origin for HTTPS URLs", () => {
		expect(redactUrlToOrigin("https://kanban.example.com/path?x=1"))
			.toBe("https://kanban.example.com");
	});

	it("returns null for null input", () => {
		expect(redactUrlToOrigin(null)).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(redactUrlToOrigin("")).toBeNull();
	});

	it("returns raw string for invalid URL", () => {
		expect(redactUrlToOrigin("not-a-url")).toBe("not-a-url");
	});

describe("collectDiagnosticsSnapshot", () => {
	it("includes boot state", async () => {
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx());
		expect(snapshot.bootPhase).toBe("ready");
		expect(snapshot.lastSuccessfulPhase).toBe("initialize-connections");
		expect(snapshot.failureCode).toBeNull();
		expect(snapshot.bootStartedAt).toBe("2026-04-03T00:00:00.000Z");
		expect(snapshot.phaseHistory).toHaveLength(2);
	});

	it("includes failure info when boot failed", async () => {
		getBootStateMock.mockReturnValue({
			...defaultBootState(),
			currentPhase: "failed",
			failureCode: "RUNTIME_CHILD_START_FAILED",
			failureMessage: "spawn ENOENT",
		});
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx());
		expect(snapshot.bootPhase).toBe("failed");
		expect(snapshot.failureCode).toBe("RUNTIME_CHILD_START_FAILED");
		expect(snapshot.failureMessage).toBe("spawn ENOENT");
	});

	it("redacts runtime URL to origin", async () => {
		const ctx = defaultCtx({
			runtimeUrl: "http://127.0.0.1:3000/api/v1?token=secret",
		});
		const snapshot = await collectDiagnosticsSnapshot(ctx);
		expect(snapshot.runtimeUrl).toBe("http://127.0.0.1:3000");
	});

	it("does NOT contain auth tokens", async () => {
		const store = fakeStore("remote-1", [
			{ id: "remote-1", label: "Server", serverUrl: "https://example.com", authToken: "super-secret-123" },
		]);
		const ctx = defaultCtx({
			connectionStore: store,
			runtimeUrl: "https://example.com/path?token=abc",
		});
		const snapshot = await collectDiagnosticsSnapshot(ctx);
		const json = JSON.stringify(snapshot);
		expect(json).not.toContain("super-secret-123");
		expect(json).not.toContain("token=abc");
	});

	it("includes descriptor state when descriptor exists", async () => {
		readRuntimeDescriptorMock.mockResolvedValue({
			url: "http://127.0.0.1:12345",
			authToken: "secret-token",
			pid: process.pid,
			updatedAt: "2026-04-03T00:00:00.000Z",
			source: "desktop",
			desktopSessionId: "session-abc",
		});
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx());
		expect(snapshot.descriptorExists).toBe(true);
		expect(snapshot.descriptorPidAlive).toBe(true);
		expect(snapshot.descriptorSource).toBe("desktop");
		expect(snapshot.descriptorSessionMatch).toBe(true);
		const json = JSON.stringify(snapshot);
		expect(json).not.toContain("secret-token");
	});


	it("reports descriptor session mismatch", async () => {
		readRuntimeDescriptorMock.mockResolvedValue({
			url: "http://127.0.0.1:12345", authToken: "t",
			pid: process.pid, updatedAt: "2026-04-03T00:00:00.000Z",
			source: "desktop", desktopSessionId: "other-session",
		});
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx());
		expect(snapshot.descriptorSessionMatch).toBe(false);
	});

	it("handles no descriptor gracefully", async () => {
		readRuntimeDescriptorMock.mockResolvedValue(null);
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx());
		expect(snapshot.descriptorExists).toBe(false);
		expect(snapshot.descriptorPidAlive).toBeNull();
		expect(snapshot.descriptorSource).toBeNull();
	});

	it("includes connection type and ID", async () => {
		const store = fakeStore("local");
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx({ connectionStore: store }));
		expect(snapshot.connectionType).toBe("local");
		expect(snapshot.connectionId).toBe("local");
	});

	it("identifies remote connection type", async () => {
		const store = fakeStore("remote-1", [
			{ id: "remote-1", label: "Server", serverUrl: "https://example.com" },
		]);
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx({ connectionStore: store }));
		expect(snapshot.connectionType).toBe("remote");
		expect(snapshot.connectionId).toBe("remote-1");
	});

	it("includes runtime child PID when running", async () => {
		const manager = { running: true, pid: 12345 } as unknown as RuntimeChildManager;
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx({ runtimeManager: manager }));
		expect(snapshot.runtimeChildRunning).toBe(true);
		expect(snapshot.runtimeChildPid).toBe(12345);
	});

	it("includes preflight resources when available", async () => {
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx({
			preflightResult: {
				ok: true, failures: [],
				resources: { preloadExists: true, runtimeChildEntryExists: true, cliShimExists: true, nodePtyLoadable: null },
			},
		}));
		expect(snapshot.resources).toEqual({
			preloadExists: true, runtimeChildEntryExists: true, cliShimExists: true, nodePtyLoadable: null,
		});
	});

	it("includes Electron metadata", async () => {
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx());
		expect(snapshot.appVersion).toBe("0.1.1");
		expect(snapshot.platform).toBe(process.platform);
		expect(snapshot.arch).toBe(process.arch);
		expect(snapshot.isPackaged).toBe(false);
	});

	it("includes safeStorage encryption status", async () => {
		safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx());
		expect(snapshot.safeStorageEncryptionAvailable).toBe(true);
	});

	it("collects fresh snapshot each time (not cached)", async () => {
		getBootStateMock.mockReturnValue(defaultBootState());
		const s1 = await collectDiagnosticsSnapshot(defaultCtx());
		getBootStateMock.mockReturnValue({
			...defaultBootState(), currentPhase: "failed", failureCode: "PREFLIGHT_FAILED",
		});
		const s2 = await collectDiagnosticsSnapshot(defaultCtx());
		expect(s1.bootPhase).toBe("ready");
		expect(s2.bootPhase).toBe("failed");
		expect(s2.failureCode).toBe("PREFLIGHT_FAILED");
	});

	it("includes collectedAt timestamp", async () => {
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx());
		expect(snapshot.collectedAt).toBeTruthy();
		expect(new Date(snapshot.collectedAt).toISOString()).toBe(snapshot.collectedAt);
	});

	it("handles readRuntimeDescriptor failure gracefully", async () => {
		readRuntimeDescriptorMock.mockRejectedValue(new Error("ENOENT"));
		const snapshot = await collectDiagnosticsSnapshot(defaultCtx());
		expect(snapshot.descriptorExists).toBe(false);
	});
});

});
