import { useCallback, useEffect, useRef, useState } from "react";

import { isClineOauthAuthenticated } from "@/runtime/native-agent";
import { fetchFeaturebaseToken } from "@/runtime/runtime-config-query";
import type { RuntimeClineProviderSettings } from "@/runtime/types";

const FEATUREBASE_SDK_ID = "featurebase-sdk";
const FEATUREBASE_SDK_SRC = "https://do.featurebase.app/js/sdk.js";
const FEATUREBASE_ORGANIZATION = "cline";
const FEATUREBASE_FEEDBACK_OVERLAY_SELECTOR = ".fb-feedback-widget-overlay";
const FEATUREBASE_FEEDBACK_HIDDEN_CLASS = "fb-feedback-widget-overlay-hidden";

/**
 * Bounded retry delays (ms) after the initial attempt.
 * After these are exhausted the hook stays in "error".
 */
export const RETRY_DELAYS = [2_000, 5_000] as const;

// ---------------------------------------------------------------------------
// Featurebase auth readiness state machine
// ---------------------------------------------------------------------------

/** Tracks whether the Featurebase SDK has been successfully identified. */
export type FeaturebaseAuthState = "idle" | "loading" | "ready" | "error";

export interface FeaturebaseFeedbackState {
	/** Current identify readiness. */
	authState: FeaturebaseAuthState;
	/** Increments whenever the SDK confirms that the feedback widget opened. */
	widgetOpenCount: number;
	/** Authenticates the current user, then opens the feedback widget. */
	openFeedbackWidget: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Featurebase SDK internals
// ---------------------------------------------------------------------------

interface FeaturebaseCallbackPayload {
	action?: string;
	[key: string]: unknown;
}

type FeaturebaseCallback = (error: unknown, callback?: FeaturebaseCallbackPayload | null) => void;

interface FeaturebaseCommand {
	(command: string, payload?: unknown, callback?: FeaturebaseCallback): void;
	q?: unknown[][];
}

interface FeaturebaseWindow extends Window {
	Featurebase?: FeaturebaseCommand;
}

let featurebaseSdkLoadPromise: Promise<void> | null = null;

function ensureFeaturebaseCommand(win: FeaturebaseWindow): FeaturebaseCommand {
	if (typeof win.Featurebase === "function") {
		return win.Featurebase;
	}
	const queuedCommand: FeaturebaseCommand = (...args: unknown[]) => {
		queuedCommand.q = queuedCommand.q ?? [];
		queuedCommand.q.push(args);
	};
	win.Featurebase = queuedCommand;
	return queuedCommand;
}

function ensureFeaturebaseSdkLoaded(): Promise<void> {
	if (featurebaseSdkLoadPromise) {
		return featurebaseSdkLoadPromise;
	}

	featurebaseSdkLoadPromise = new Promise<void>((resolve, reject) => {
		const existingScript = document.getElementById(FEATUREBASE_SDK_ID) as HTMLScriptElement | null;
		if (existingScript?.dataset.loaded === "true") {
			resolve();
			return;
		}

		const script = existingScript ?? document.createElement("script");
		const handleLoad = () => {
			if (script.dataset) {
				script.dataset.loaded = "true";
			}
			resolve();
		};
		const handleError = () => {
			featurebaseSdkLoadPromise = null;
			reject(new Error("Failed to load Featurebase SDK."));
		};
		script.addEventListener("load", handleLoad, { once: true });
		script.addEventListener("error", handleError, { once: true });
		if (!existingScript) {
			script.id = FEATUREBASE_SDK_ID;
			script.src = FEATUREBASE_SDK_SRC;
			script.async = true;
			document.head.appendChild(script);
			return;
		}
		const existingScriptReadyState = (script as HTMLScriptElement & { readyState?: string }).readyState;
		if (existingScriptReadyState === "complete") {
			handleLoad();
		}
	});

	return featurebaseSdkLoadPromise;
}

function closeFeaturebaseFeedbackWidget(win: Window): void {
	postFeaturebaseWidgetAction(win, "closeWidget");
}

function openFeaturebaseFeedbackWidget(win: Window): void {
	postFeaturebaseWidgetAction(win, "openFeedbackWidget");
}

function postFeaturebaseWidgetAction(win: Window, action: string): void {
	// The SDK accepts same-window postMessage commands for the feedback widget.
	win.postMessage(
		{
			target: "FeaturebaseWidget",
			data: { action },
		},
		win.location.origin,
	);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFeaturebaseFeedbackWidget(input: {
	workspaceId: string | null;
	clineProviderSettings: RuntimeClineProviderSettings | null;
}): FeaturebaseFeedbackState {
	const { workspaceId, clineProviderSettings } = input;
	const isAuthenticated = isClineOauthAuthenticated(clineProviderSettings);

	const [authState, setAuthState] = useState<FeaturebaseAuthState>("idle");
	const [widgetOpenCount, setWidgetOpenCount] = useState(0);

	const widgetInitializedRef = useRef(false);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const openAttemptRef = useRef(0);
	const mountedRef = useRef(true);

	function clearRetryTimer() {
		if (retryTimerRef.current !== null) {
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
	}

	const ensureFeedbackWidgetInitialized = useCallback(async (): Promise<void> => {
		if (widgetInitializedRef.current) {
			return;
		}

		const win = window as FeaturebaseWindow;
		ensureFeaturebaseCommand(win);
		await ensureFeaturebaseSdkLoaded();

		await new Promise<void>((resolve) => {
			const featurebase = ensureFeaturebaseCommand(win);
			featurebase(
				"initialize_feedback_widget",
				{
					organization: FEATUREBASE_ORGANIZATION,
					theme: "dark",
					locale: "en",
					metadata: { app: "kanban" },
				},
				(_error, callback) => {
					if (callback?.action === "widgetOpened" && mountedRef.current) {
						setWidgetOpenCount((current) => current + 1);
					}
				},
			);
			widgetInitializedRef.current = true;
			resolve();
		});
	}, []);

	useEffect(() => {
		return () => {
			mountedRef.current = false;
			clearRetryTimer();
		};
	}, []);

	useEffect(() => {
		const handleDocumentClick = (event: MouseEvent) => {
			const overlay = document.querySelector(FEATUREBASE_FEEDBACK_OVERLAY_SELECTOR);
			if (!(overlay instanceof HTMLElement)) {
				return;
			}
			if (overlay.classList.contains(FEATUREBASE_FEEDBACK_HIDDEN_CLASS)) {
				return;
			}
			if (event.target !== overlay) {
				return;
			}
			closeFeaturebaseFeedbackWidget(window);
		};

		document.addEventListener("click", handleDocumentClick, true);
		return () => {
			document.removeEventListener("click", handleDocumentClick, true);
		};
	}, []);

	useEffect(() => {
		clearRetryTimer();
		openAttemptRef.current += 1;
		setAuthState("idle");
	}, [workspaceId, isAuthenticated]);

	const identifyWithRetries = useCallback(
		async (attempt: number, retryIndex: number): Promise<void> => {
			if (!workspaceId || !isAuthenticated) {
				return;
			}

			try {
				await ensureFeedbackWidgetInitialized();
				if (openAttemptRef.current !== attempt) {
					return;
				}

				const tokenResponse = await fetchFeaturebaseToken(workspaceId);
				if (openAttemptRef.current !== attempt) {
					return;
				}

				const win = window as FeaturebaseWindow;
				const featurebase = ensureFeaturebaseCommand(win);
				await new Promise<void>((resolve, reject) => {
					featurebase(
						"identify",
						{
							organization: FEATUREBASE_ORGANIZATION,
							featurebaseJwt: tokenResponse.featurebaseJwt,
						},
						(error) => {
							if (openAttemptRef.current !== attempt) {
								resolve();
								return;
							}
							if (error) {
								reject(error);
								return;
							}
							resolve();
						},
					);
				});

				if (openAttemptRef.current !== attempt || !mountedRef.current) {
					return;
				}
				clearRetryTimer();
				setAuthState("ready");
			} catch (error) {
				if (openAttemptRef.current !== attempt || !mountedRef.current) {
					return;
				}

				if (retryIndex >= RETRY_DELAYS.length) {
					setAuthState("error");
					throw error;
				}

				setAuthState("error");
				const delay = RETRY_DELAYS[retryIndex];
				await new Promise<void>((resolve) => {
					retryTimerRef.current = setTimeout(resolve, delay);
				});
				if (openAttemptRef.current !== attempt || !mountedRef.current) {
					return;
				}
				await identifyWithRetries(attempt, retryIndex + 1);
			}
		},
		[ensureFeedbackWidgetInitialized, isAuthenticated, workspaceId],
	);

	const openFeedbackWidget = useCallback(async (): Promise<void> => {
		if (!workspaceId || !isAuthenticated) {
			return;
		}

		const attempt = ++openAttemptRef.current;
		clearRetryTimer();
		setAuthState("loading");

		await identifyWithRetries(attempt, 0);
		if (openAttemptRef.current !== attempt || !mountedRef.current) {
			return;
		}

		openFeaturebaseFeedbackWidget(window);
	}, [identifyWithRetries, isAuthenticated, workspaceId]);

	return { authState, widgetOpenCount, openFeedbackWidget };
}
