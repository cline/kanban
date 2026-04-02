import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeaturebaseFeedbackState } from "@/hooks/use-featurebase-feedback-widget";
import type { RuntimeClineProviderSettings } from "@/runtime/types";

const defaultClineProviderSettings: RuntimeClineProviderSettings = {
	providerId: null,
	modelId: null,
	baseUrl: null,
	apiKeyConfigured: false,
	oauthProvider: null,
	oauthAccessTokenConfigured: false,
	oauthRefreshTokenConfigured: false,
	oauthAccountId: null,
	oauthExpiresAt: null,
};

const authenticatedClineSettings: RuntimeClineProviderSettings = {
	...defaultClineProviderSettings,
	oauthProvider: "cline",
	oauthAccessTokenConfigured: true,
	oauthRefreshTokenConfigured: true,
	oauthAccountId: "acc-1",
};

const tokensOnlySettings: RuntimeClineProviderSettings = {
	...defaultClineProviderSettings,
	oauthProvider: null,
	oauthAccessTokenConfigured: true,
	oauthRefreshTokenConfigured: true,
};

async function importFeaturebaseModule() {
	const fetchFeaturebaseTokenMock = vi.fn();
	vi.resetModules();
	vi.doMock("@/runtime/runtime-config-query", () => ({
		fetchFeaturebaseToken: fetchFeaturebaseTokenMock,
	}));
	const nativeAgent = await import("@/runtime/native-agent");
	vi.doMock("@/runtime/native-agent", () => ({
		...nativeAgent,
		isClineOauthAuthenticated: nativeAgent.isClineOauthAuthenticated,
	}));
	const module = await import("@/hooks/use-featurebase-feedback-widget");
	return {
		module,
		fetchFeaturebaseTokenMock,
	};
}

describe("useFeaturebaseFeedbackWidget", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		document.head.querySelector("#featurebase-sdk")?.remove();
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
		delete (window as Window & { Featurebase?: unknown }).Featurebase;
		document.head.querySelector("#featurebase-sdk")?.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
			return;
		}
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	function mockSdkLoad(featurebaseMock: ReturnType<typeof vi.fn>) {
		const originalAppendChild = document.head.appendChild.bind(document.head);
		vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
			const result = originalAppendChild(node);
			if (node instanceof HTMLScriptElement && node.id === "featurebase-sdk") {
				(window as Window & { Featurebase?: unknown }).Featurebase = featurebaseMock;
				node.dispatchEvent(new Event("load"));
			}
			return result;
		});
	}

	it("initializes the feedback widget on mount", async () => {
		const { module } = await importFeaturebaseModule();
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		function HookHarness(): null {
			module.useFeaturebaseFeedbackWidget({
				workspaceId: null,
				clineProviderSettings: defaultClineProviderSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
		});

		const initCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "initialize_feedback_widget");
		expect(initCall).toBeTruthy();
		expect(initCall?.[1]).toEqual(
			expect.objectContaining({
				organization: "cline",
				theme: "dark",
				locale: "en",
				metadata: { app: "kanban" },
			}),
		);
		expect(typeof initCall?.[2]).toBe("function");
	});

	it("returns idle state when unauthenticated", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		let hookResult: FeaturebaseFeedbackState | null = null;
		function HookHarness(): null {
			hookResult = module.useFeaturebaseFeedbackWidget({
				workspaceId: "workspace-1",
				clineProviderSettings: defaultClineProviderSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(hookResult!.authState).toBe("idle");
		expect(fetchFeaturebaseTokenMock).not.toHaveBeenCalled();
	});

	it("requires oauthProvider=cline (tokens alone stay idle)", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		let hookResult: FeaturebaseFeedbackState | null = null;
		function HookHarness(): null {
			hookResult = module.useFeaturebaseFeedbackWidget({
				workspaceId: "workspace-1",
				clineProviderSettings: tokensOnlySettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(hookResult!.authState).toBe("idle");
		expect(fetchFeaturebaseTokenMock).not.toHaveBeenCalled();
	});

	it("transitions to ready on successful pre-identify (no retries scheduled)", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock.mockResolvedValue({ featurebaseJwt: "jwt-abc" });
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		let hookResult: FeaturebaseFeedbackState | null = null;
		function HookHarness(): null {
			hookResult = module.useFeaturebaseFeedbackWidget({
				workspaceId: "workspace-1",
				clineProviderSettings: authenticatedClineSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		const identifyCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "identify");
		expect(identifyCall).toBeTruthy();

		await act(async () => {
			(identifyCall?.[2] as (error: unknown) => void)?.(null);
			await Promise.resolve();
		});

		expect(hookResult!.authState).toBe("ready");
		expect(hookResult!.widgetOpenCount).toBe(0);
		// Only one token fetch — no retries needed
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);
	});

	it("increments widgetOpenCount when the SDK reports widgetOpened", async () => {
		const { module } = await importFeaturebaseModule();
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		let hookResult: FeaturebaseFeedbackState | null = null;
		function HookHarness(): null {
			hookResult = module.useFeaturebaseFeedbackWidget({
				workspaceId: null,
				clineProviderSettings: defaultClineProviderSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
		});

		const initCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "initialize_feedback_widget");
		expect(initCall).toBeTruthy();

		await act(async () => {
			(initCall?.[2] as (error: unknown, callback?: { action?: string } | null) => void)?.(null, {
				action: "widgetOpened",
			});
			await Promise.resolve();
		});

		expect(hookResult!.widgetOpenCount).toBe(1);
	});

	it("closes the feedback widget when the visible overlay backdrop is clicked", async () => {
		const { module } = await importFeaturebaseModule();
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);
		const postMessageSpy = vi.spyOn(window, "postMessage");

		function HookHarness(): null {
			module.useFeaturebaseFeedbackWidget({
				workspaceId: null,
				clineProviderSettings: defaultClineProviderSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
		});

		const overlay = document.createElement("div");
		overlay.className = "fb-feedback-widget-overlay";
		document.body.appendChild(overlay);

		await act(async () => {
			overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});

		expect(postMessageSpy).toHaveBeenCalledWith(
			{
				target: "FeaturebaseWidget",
				data: { action: "closeWidget" },
			},
			window.location.origin,
		);

		overlay.remove();
	});

	it("transitions to error on token fetch failure then auto-retries", async () => {
		vi.useFakeTimers();
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		// All attempts fail
		fetchFeaturebaseTokenMock.mockRejectedValue(new Error("Network error"));
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		let hookResult: FeaturebaseFeedbackState | null = null;
		function HookHarness(): null {
			hookResult = module.useFeaturebaseFeedbackWidget({
				workspaceId: "workspace-1",
				clineProviderSettings: authenticatedClineSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// Initial attempt failed
		expect(hookResult!.authState).toBe("error");
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);

		// Advance past first retry delay (2s)
		await act(async () => {
			vi.advanceTimersByTime(2_000);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(2);
		expect(hookResult!.authState).toBe("error");

		// Advance past second retry delay (5s)
		await act(async () => {
			vi.advanceTimersByTime(5_000);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// 3 total attempts (initial + 2 retries), then stops
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(3);
		expect(hookResult!.authState).toBe("error");

		// No more retries after that
		await act(async () => {
			vi.advanceTimersByTime(30_000);
			await Promise.resolve();
		});
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(3);
	});

	it("first attempt fails, auto-retry succeeds => becomes ready", async () => {
		vi.useFakeTimers();
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		// First call fails, second succeeds
		fetchFeaturebaseTokenMock
			.mockRejectedValueOnce(new Error("Transient error"))
			.mockResolvedValueOnce({ featurebaseJwt: "jwt-retry-ok" });
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		let hookResult: FeaturebaseFeedbackState | null = null;
		function HookHarness(): null {
			hookResult = module.useFeaturebaseFeedbackWidget({
				workspaceId: "workspace-1",
				clineProviderSettings: authenticatedClineSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(hookResult!.authState).toBe("error");
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);

		// Advance past first retry delay (2s)
		await act(async () => {
			vi.advanceTimersByTime(2_000);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(2);

		// Identify should have been called on the retry
		const identifyCalls = featurebaseMock.mock.calls.filter((call: unknown[]) => call[0] === "identify");
		expect(identifyCalls.length).toBeGreaterThanOrEqual(1);

		// Simulate identify success
		const latestIdentify = identifyCalls[identifyCalls.length - 1];
		await act(async () => {
			(latestIdentify?.[2] as (error: unknown) => void)?.(null);
			await Promise.resolve();
		});

		expect(hookResult!.authState).toBe("ready");
	});

	it("transitions to error on identify callback error (silent degradation)", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock.mockResolvedValue({ featurebaseJwt: "jwt-abc" });
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		let hookResult: FeaturebaseFeedbackState | null = null;
		function HookHarness(): null {
			hookResult = module.useFeaturebaseFeedbackWidget({
				workspaceId: "workspace-1",
				clineProviderSettings: authenticatedClineSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		const identifyCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "identify");
		await act(async () => {
			(identifyCall?.[2] as (error: unknown) => void)?.(new Error("Featurebase error"));
			await Promise.resolve();
		});

		expect(hookResult!.authState).toBe("error");
	});

	it("auto-retries after identify callback error and transitions to ready on success", async () => {
		vi.useFakeTimers();
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		// Both token fetches succeed
		fetchFeaturebaseTokenMock
			.mockResolvedValueOnce({ featurebaseJwt: "jwt-first" })
			.mockResolvedValueOnce({ featurebaseJwt: "jwt-second" });
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		let hookResult: FeaturebaseFeedbackState | null = null;
		function HookHarness(): null {
			hookResult = module.useFeaturebaseFeedbackWidget({
				workspaceId: "workspace-1",
				clineProviderSettings: authenticatedClineSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// First identify call should have happened
		const firstIdentifyCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "identify");
		expect(firstIdentifyCall).toBeTruthy();
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);

		// Invoke the first identify callback with an error
		await act(async () => {
			(firstIdentifyCall?.[2] as (error: unknown) => void)?.(new Error("identify failed"));
			await Promise.resolve();
		});

		expect(hookResult!.authState).toBe("error");

		// Advance timers by the first retry delay (2s)
		await act(async () => {
			vi.advanceTimersByTime(2_000);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// Token should be fetched again and a second identify call issued
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(2);
		const identifyCalls = featurebaseMock.mock.calls.filter((call: unknown[]) => call[0] === "identify");
		expect(identifyCalls.length).toBe(2);

		// Invoke the second identify callback with null (success)
		const secondIdentifyCall = identifyCalls[1];
		await act(async () => {
			(secondIdentifyCall?.[2] as (error: unknown) => void)?.(null);
			await Promise.resolve();
		});

		expect(hookResult!.authState).toBe("ready");
	});

	it("does not pre-identify when workspaceId is null", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		let hookResult: FeaturebaseFeedbackState | null = null;
		function HookHarness(): null {
			hookResult = module.useFeaturebaseFeedbackWidget({
				workspaceId: null,
				clineProviderSettings: authenticatedClineSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(hookResult!.authState).toBe("idle");
		expect(fetchFeaturebaseTokenMock).not.toHaveBeenCalled();
	});

	it("cancels retry timers on unmount", async () => {
		vi.useFakeTimers();
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock.mockRejectedValue(new Error("Network error"));
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		function HookHarness(): null {
			module.useFeaturebaseFeedbackWidget({
				workspaceId: "workspace-1",
				clineProviderSettings: authenticatedClineSettings,
			});
			return null;
		}

		await act(async () => {
			root.render(<HookHarness />);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);

		// Unmount before retry fires
		await act(async () => {
			root.render(<></>);
			await Promise.resolve();
		});

		// Advance timers — retry should NOT fire
		await act(async () => {
			vi.advanceTimersByTime(10_000);
			await Promise.resolve();
		});

		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);
	});
});
