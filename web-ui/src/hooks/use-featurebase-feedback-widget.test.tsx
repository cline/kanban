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

	async function renderHook(
		module: Awaited<ReturnType<typeof importFeaturebaseModule>>["module"],
		input: {
			workspaceId: string | null;
			clineProviderSettings: RuntimeClineProviderSettings;
		},
	): Promise<{ getState: () => FeaturebaseFeedbackState }> {
		let hookResult: FeaturebaseFeedbackState | null = null;

		function HookHarness(): null {
			hookResult = module.useFeaturebaseFeedbackWidget(input);
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

	it("stays idle on mount for authenticated users until feedback is opened", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: authenticatedClineSettings,
		});

		expect(getState().authState).toBe("idle");
		expect(fetchFeaturebaseTokenMock).not.toHaveBeenCalled();
		expect(featurebaseMock).not.toHaveBeenCalled();
	});

	it("returns idle state when unauthenticated", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: defaultClineProviderSettings,
		});

		expect(getState().authState).toBe("idle");
		expect(fetchFeaturebaseTokenMock).not.toHaveBeenCalled();
		expect(featurebaseMock).not.toHaveBeenCalled();
	});

	it("requires oauthProvider=cline before opening", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: tokensOnlySettings,
		});

		await act(async () => {
			await getState().openFeedbackWidget();
			await Promise.resolve();
		});

		expect(getState().authState).toBe("idle");
		expect(fetchFeaturebaseTokenMock).not.toHaveBeenCalled();
		expect(featurebaseMock).not.toHaveBeenCalled();
	});

	it("initializes the feedback widget and identifies only after openFeedbackWidget is called", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock.mockResolvedValue({ featurebaseJwt: "jwt-abc" });
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: authenticatedClineSettings,
		});

		let openPromise: Promise<void> | null = null;
		await act(async () => {
			openPromise = getState().openFeedbackWidget();
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

		const identifyCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "identify");
		expect(identifyCall).toBeTruthy();
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);

		const postMessageSpy = vi.spyOn(window, "postMessage");
		await act(async () => {
			(identifyCall?.[2] as (error: unknown) => void)?.(null);
			await openPromise;
			await Promise.resolve();
		});

		expect(getState().authState).toBe("ready");
		expect(postMessageSpy).toHaveBeenCalledWith(
			{
				target: "FeaturebaseWidget",
				data: { action: "openFeedbackWidget" },
			},
			window.location.origin,
		);
	});

	it("increments widgetOpenCount when the SDK reports widgetOpened", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock.mockResolvedValue({ featurebaseJwt: "jwt-abc" });
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: authenticatedClineSettings,
		});

		let openPromise: Promise<void> | null = null;
		await act(async () => {
			openPromise = getState().openFeedbackWidget();
			await Promise.resolve();
			await Promise.resolve();
		});

		const initCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "initialize_feedback_widget");
		const identifyCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "identify");
		expect(initCall).toBeTruthy();
		expect(identifyCall).toBeTruthy();

		await act(async () => {
			(identifyCall?.[2] as (error: unknown) => void)?.(null);
			await openPromise;
			await Promise.resolve();
		});

		await act(async () => {
			(initCall?.[2] as (error: unknown, callback?: { action?: string } | null) => void)?.(null, {
				action: "widgetOpened",
			});
			await Promise.resolve();
		});

		expect(getState().widgetOpenCount).toBe(1);
	});

	it("closes the feedback widget when the visible overlay backdrop is clicked", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock.mockResolvedValue({ featurebaseJwt: "jwt-abc" });
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);
		const postMessageSpy = vi.spyOn(window, "postMessage");

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: authenticatedClineSettings,
		});

		let openPromise: Promise<void> | null = null;
		await act(async () => {
			openPromise = getState().openFeedbackWidget();
			await Promise.resolve();
			await Promise.resolve();
		});

		const identifyCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "identify");
		await act(async () => {
			(identifyCall?.[2] as (error: unknown) => void)?.(null);
			await openPromise;
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

	it("retries after token fetch failures only after openFeedbackWidget is called", async () => {
		vi.useFakeTimers();
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock.mockRejectedValue(new Error("Network error"));
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: authenticatedClineSettings,
		});

		expect(fetchFeaturebaseTokenMock).not.toHaveBeenCalled();

		await act(async () => {
			void getState()
				.openFeedbackWidget()
				.catch(() => {});
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(getState().authState).toBe("error");
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			vi.advanceTimersByTime(2_000);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(2);
		expect(getState().authState).toBe("error");

		await act(async () => {
			vi.advanceTimersByTime(5_000);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(3);
		expect(getState().authState).toBe("error");

		await act(async () => {
			vi.advanceTimersByTime(30_000);
			await Promise.resolve();
		});

		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(3);
	});

	it("becomes ready when a retry succeeds", async () => {
		vi.useFakeTimers();
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock
			.mockRejectedValueOnce(new Error("Transient error"))
			.mockResolvedValueOnce({ featurebaseJwt: "jwt-retry-ok" });
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: authenticatedClineSettings,
		});

		const openPromise = getState().openFeedbackWidget();
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(getState().authState).toBe("error");
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			vi.advanceTimersByTime(2_000);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		const identifyCalls = featurebaseMock.mock.calls.filter((call: unknown[]) => call[0] === "identify");
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(2);
		expect(identifyCalls.length).toBeGreaterThanOrEqual(1);

		const latestIdentify = identifyCalls[identifyCalls.length - 1];
		await act(async () => {
			(latestIdentify?.[2] as (error: unknown) => void)?.(null);
			await openPromise;
			await Promise.resolve();
		});

		expect(getState().authState).toBe("ready");
	});

	it("transitions to error on identify callback error", async () => {
		vi.useFakeTimers();
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock.mockResolvedValue({ featurebaseJwt: "jwt-abc" });
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: authenticatedClineSettings,
		});

		const openPromise = getState().openFeedbackWidget();
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});
		void openPromise.catch(() => {});

		const identifyCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "identify");
		await act(async () => {
			(identifyCall?.[2] as (error: unknown) => void)?.(new Error("Featurebase error"));
			await Promise.resolve();
		});

		expect(getState().authState).toBe("error");
	});

	it("retries after identify callback error and becomes ready on success", async () => {
		vi.useFakeTimers();
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock
			.mockResolvedValueOnce({ featurebaseJwt: "jwt-first" })
			.mockResolvedValueOnce({ featurebaseJwt: "jwt-second" });
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: authenticatedClineSettings,
		});

		const openPromise = getState().openFeedbackWidget();
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		const firstIdentifyCall = featurebaseMock.mock.calls.find((call: unknown[]) => call[0] === "identify");
		expect(firstIdentifyCall).toBeTruthy();
		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			(firstIdentifyCall?.[2] as (error: unknown) => void)?.(new Error("identify failed"));
			await Promise.resolve();
		});

		expect(getState().authState).toBe("error");

		await act(async () => {
			vi.advanceTimersByTime(2_000);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(2);
		const identifyCalls = featurebaseMock.mock.calls.filter((call: unknown[]) => call[0] === "identify");
		expect(identifyCalls.length).toBe(2);

		const secondIdentifyCall = identifyCalls[1];
		await act(async () => {
			(secondIdentifyCall?.[2] as (error: unknown) => void)?.(null);
			await openPromise;
			await Promise.resolve();
		});

		expect(getState().authState).toBe("ready");
	});

	it("does not identify when workspaceId is null", async () => {
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: null,
			clineProviderSettings: authenticatedClineSettings,
		});

		await act(async () => {
			await getState().openFeedbackWidget();
			await Promise.resolve();
		});

		expect(getState().authState).toBe("idle");
		expect(fetchFeaturebaseTokenMock).not.toHaveBeenCalled();
		expect(featurebaseMock).not.toHaveBeenCalled();
	});

	it("cancels retry timers on unmount", async () => {
		vi.useFakeTimers();
		const { module, fetchFeaturebaseTokenMock } = await importFeaturebaseModule();
		fetchFeaturebaseTokenMock.mockRejectedValue(new Error("Network error"));
		const featurebaseMock = vi.fn();
		mockSdkLoad(featurebaseMock);

		const { getState } = await renderHook(module, {
			workspaceId: "workspace-1",
			clineProviderSettings: authenticatedClineSettings,
		});

		await act(async () => {
			void getState()
				.openFeedbackWidget()
				.catch(() => {});
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			root.render(<></>);
			await Promise.resolve();
		});

		await act(async () => {
			vi.advanceTimersByTime(10_000);
			await Promise.resolve();
		});

		expect(fetchFeaturebaseTokenMock).toHaveBeenCalledTimes(1);
	});
});
