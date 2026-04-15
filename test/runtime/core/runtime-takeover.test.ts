import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock the runtime-descriptor module so handleRuntimeDisconnect never
// touches the real ~/.cline/kanban/ directory.
const mockReadRuntimeDescriptor = vi.fn();
const mockIsDescriptorStale = vi.fn();
const mockGetRuntimeDescriptorDir = vi.fn();

vi.mock("../../../src/core/runtime-descriptor", () => ({
	readRuntimeDescriptor: (...args: unknown[]) => mockReadRuntimeDescriptor(...args),
	isDescriptorStale: (...args: unknown[]) => mockIsDescriptorStale(...args),
	getRuntimeDescriptorDir: () => mockGetRuntimeDescriptorDir(),
}));

// Dynamic import so the mock is in place before the module loads.
const { handleRuntimeDisconnect } = await import("../../../src/core/runtime-takeover");

describe("handleRuntimeDisconnect", () => {
	let tempDir: string;
	const failedUrl = "http://127.0.0.1:9999";
	const failedAuthToken = "failed-token";

	beforeEach(async () => {
		vi.resetAllMocks();
		tempDir = join(tmpdir(), `takeover-test-${randomUUID()}`);
		await mkdir(tempDir, { recursive: true });
		mockGetRuntimeDescriptorDir.mockReturnValue(tempDir);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	it("proceeds to start runtime when lock owner PID is dead", async () => {
		// Simulate a lock left behind by a dead process.
		const lockPath = join(tempDir, "runtime.takeover.lock");
		// Use PID 999999999 which is almost certainly dead.
		await writeFile(lockPath, JSON.stringify({ pid: 999999999, at: Date.now() }));

		// Grace window: runtime stays unreachable (no mock server).
		// Descriptor: nothing usable.
		mockReadRuntimeDescriptor.mockResolvedValue(null);

		const startRuntimeMock = vi.fn().mockResolvedValue({
			url: "http://127.0.0.1:12345",
			authToken: "new-token",
		});

		// After startRuntime(), simulate descriptor being written.
		const newDescriptor = {
			url: "http://127.0.0.1:12345",
			authToken: "new-token",
			pid: process.pid,
			updatedAt: new Date().toISOString(),
			source: "cli" as const,
		};
		// First calls during grace/re-read return null, last call returns the new descriptor.
		mockReadRuntimeDescriptor
			.mockResolvedValue(null) // grace + re-read
			.mockResolvedValueOnce(null) // double-check under lock
			.mockResolvedValueOnce(newDescriptor); // after startRuntime

		const onAttachMock = vi.fn().mockResolvedValue(undefined);
		const logs: string[] = [];

		await handleRuntimeDisconnect(failedUrl, failedAuthToken, {
			startRuntime: startRuntimeMock,
			onAttach: onAttachMock,
			warn: (msg: string) => logs.push(msg),
		});

		// startRuntime should have been called — the dead-PID lock didn't block us.
		expect(startRuntimeMock).toHaveBeenCalled();

		// Lock file should have been cleaned up (released after takeover).
		const lockExists = await readFile(lockPath, "utf-8").then(
			() => true,
			() => false,
		);
		expect(lockExists).toBe(false);
	});

	it("warns when descriptor is missing after startRuntime", async () => {
		// No existing lock, no descriptor.
		mockReadRuntimeDescriptor.mockResolvedValue(null);

		const startRuntimeMock = vi.fn().mockResolvedValue({
			url: "http://127.0.0.1:12345",
			authToken: "new-token",
		});

		const onAttachMock = vi.fn().mockResolvedValue(undefined);
		const logs: string[] = [];

		await handleRuntimeDisconnect(failedUrl, failedAuthToken, {
			startRuntime: startRuntimeMock,
			onAttach: onAttachMock,
			warn: (msg: string) => logs.push(msg),
		});

		// startRuntime was called.
		expect(startRuntimeMock).toHaveBeenCalled();

		// onAttach should NOT have been called — descriptor was missing after start.
		expect(onAttachMock).not.toHaveBeenCalled();

		// Should have logged a warning about missing descriptor.
		const warningLog = logs.find((l) => l.includes("WARNING") && l.includes("descriptor is missing"));
		expect(warningLog).toBeDefined();
	});

	it("attaches when descriptor appears after startRuntime", async () => {
		const newDescriptor = {
			url: "http://127.0.0.1:12345",
			authToken: "new-token",
			pid: process.pid,
			updatedAt: new Date().toISOString(),
			source: "cli" as const,
		};

		// First few calls return null (grace, re-read, double-check), then return descriptor.
		mockReadRuntimeDescriptor
			.mockResolvedValueOnce(null) // re-read after grace
			.mockResolvedValueOnce(null) // double-check under lock
			.mockResolvedValueOnce(newDescriptor); // after startRuntime

		const startRuntimeMock = vi.fn().mockResolvedValue({
			url: "http://127.0.0.1:12345",
			authToken: "new-token",
		});

		const onAttachMock = vi.fn().mockResolvedValue(undefined);
		const logs: string[] = [];

		await handleRuntimeDisconnect(failedUrl, failedAuthToken, {
			startRuntime: startRuntimeMock,
			onAttach: onAttachMock,
			warn: (msg: string) => logs.push(msg),
		});

		// startRuntime was called and descriptor was found — should attach.
		expect(startRuntimeMock).toHaveBeenCalled();
		expect(onAttachMock).toHaveBeenCalledWith(newDescriptor);

		// Should have logged success, not a warning.
		const successLog = logs.find((l) => l.includes("Descriptor published"));
		expect(successLog).toBeDefined();
	});
});
