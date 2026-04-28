import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeUpdateStatusResponse } from "@/runtime/types";
import { useUpdateNotification } from "./use-update-notification";

const runtimeConfigQueryMocks = vi.hoisted(() => ({
	fetchRuntimeUpdateStatus: vi.fn<(workspaceId: string | null) => Promise<RuntimeUpdateStatusResponse>>(),
}));

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchRuntimeUpdateStatus: runtimeConfigQueryMocks.fetchRuntimeUpdateStatus,
}));

interface AvailableUpdate {
	currentVersion: string;
	latestVersion: string;
	installCommand: string;
}

interface UseUpdateNotificationResult {
	availableUpdate: AvailableUpdate | null;
	dismiss: () => void;
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
		runtimeConfigQueryMocks.fetchRuntimeUpdateStatus.mockReset();
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
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
			return;
		}
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	async function renderHook(): Promise<{ getState: () => UseUpdateNotificationResult }> {
		let hookResult: UseUpdateNotificationResult | null = null;

		function HookHarness(): null {
			hookResult = useUpdateNotification();
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
		runtimeConfigQueryMocks.fetchRuntimeUpdateStatus.mockResolvedValue(updateAvailableStatus);

		const { getState } = await renderHook();

		expect(getState().availableUpdate).toEqual({
			currentVersion: "0.1.0",
			latestVersion: "0.2.0",
			installCommand: "npm install -g kanban@latest",
		});
	});

	it("returns null when the runtime is up to date", async () => {
		runtimeConfigQueryMocks.fetchRuntimeUpdateStatus.mockResolvedValue(upToDateStatus);

		const { getState } = await renderHook();

		expect(getState().availableUpdate).toBeNull();
	});

	it("self-corrects to null when a later poll reports the runtime is up to date", async () => {
		vi.useFakeTimers();
		runtimeConfigQueryMocks.fetchRuntimeUpdateStatus
			.mockResolvedValueOnce(updateAvailableStatus)
			.mockResolvedValueOnce(upToDateStatus);

		const { getState } = await renderHook();

		expect(getState().availableUpdate).not.toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
			await Promise.resolve();
		});

		expect(getState().availableUpdate).toBeNull();
	});

	it("dismiss() clears the available update for the session and stops further polling effects", async () => {
		runtimeConfigQueryMocks.fetchRuntimeUpdateStatus.mockResolvedValue(updateAvailableStatus);

		const { getState } = await renderHook();
		expect(getState().availableUpdate).not.toBeNull();

		await act(async () => {
			getState().dismiss();
		});

		expect(getState().availableUpdate).toBeNull();
	});

	it("does not throw when the runtime query rejects", async () => {
		runtimeConfigQueryMocks.fetchRuntimeUpdateStatus.mockRejectedValue(new Error("offline"));

		const { getState } = await renderHook();

		expect(getState().availableUpdate).toBeNull();
	});
});
