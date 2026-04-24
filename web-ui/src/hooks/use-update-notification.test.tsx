import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeUpdateStatusResponse } from "@/runtime/types";

interface AvailableUpdate {
	currentVersion: string;
	latestVersion: string;
	installCommand: string;
}

interface UseUpdateNotificationResult {
	availableUpdate: AvailableUpdate | null;
	dismiss: () => void;
}

async function importHookModule() {
	const fetchRuntimeUpdateStatusMock = vi.fn<(workspaceId: string | null) => Promise<RuntimeUpdateStatusResponse>>();
	vi.resetModules();
	vi.doMock("@/runtime/runtime-config-query", () => ({
		fetchRuntimeUpdateStatus: fetchRuntimeUpdateStatusMock,
	}));
	const module = await import("@/hooks/use-update-notification");
	return { module, fetchRuntimeUpdateStatusMock };
}

const upToDateStatus: RuntimeUpdateStatusResponse = {
	currentVersion: "0.1.0",
	latestVersion: null,
	updateAvailable: false,
	updateTiming: null,
	installCommand: null,
};

const updateAvailableStatus: RuntimeUpdateStatusResponse = {
	currentVersion: "0.1.0",
	latestVersion: "0.2.0",
	updateAvailable: true,
	updateTiming: "startup",
	installCommand: "npm install -g kanban@latest",
};

describe("useUpdateNotification", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.resetModules();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
			return;
		}
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	async function renderHook(
		module: Awaited<ReturnType<typeof importHookModule>>["module"],
	): Promise<{ getState: () => UseUpdateNotificationResult }> {
		let hookResult: UseUpdateNotificationResult | null = null;

		function HookHarness(): null {
			hookResult = module.useUpdateNotification();
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
		});

		return {
			getState: () => {
				if (!hookResult) {
					throw new Error("Hook state not available");
				}
				return hookResult;
			},
		};
	}

	it("surfaces an available update from the runtime", async () => {
		const { module, fetchRuntimeUpdateStatusMock } = await importHookModule();
		fetchRuntimeUpdateStatusMock.mockResolvedValue(updateAvailableStatus);

		const { getState } = await renderHook(module);

		expect(getState().availableUpdate).toEqual({
			currentVersion: "0.1.0",
			latestVersion: "0.2.0",
			installCommand: "npm install -g kanban@latest",
		});
	});

	it("returns null when the runtime is up to date", async () => {
		const { module, fetchRuntimeUpdateStatusMock } = await importHookModule();
		fetchRuntimeUpdateStatusMock.mockResolvedValue(upToDateStatus);

		const { getState } = await renderHook(module);

		expect(getState().availableUpdate).toBeNull();
	});

	it("self-corrects to null when a later poll reports the runtime is up to date", async () => {
		vi.useFakeTimers();
		const { module, fetchRuntimeUpdateStatusMock } = await importHookModule();
		fetchRuntimeUpdateStatusMock.mockResolvedValueOnce(updateAvailableStatus).mockResolvedValueOnce(upToDateStatus);

		const { getState } = await renderHook(module);

		expect(getState().availableUpdate).not.toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
			await Promise.resolve();
		});

		expect(getState().availableUpdate).toBeNull();
	});

	it("dismiss() clears the available update for the session and stops further polling effects", async () => {
		const { module, fetchRuntimeUpdateStatusMock } = await importHookModule();
		fetchRuntimeUpdateStatusMock.mockResolvedValue(updateAvailableStatus);

		const { getState } = await renderHook(module);
		expect(getState().availableUpdate).not.toBeNull();

		await act(async () => {
			getState().dismiss();
		});

		expect(getState().availableUpdate).toBeNull();
	});

	it("does not throw when the runtime query rejects", async () => {
		const { module, fetchRuntimeUpdateStatusMock } = await importHookModule();
		fetchRuntimeUpdateStatusMock.mockRejectedValue(new Error("offline"));

		const { getState } = await renderHook(module);

		expect(getState().availableUpdate).toBeNull();
	});
});
