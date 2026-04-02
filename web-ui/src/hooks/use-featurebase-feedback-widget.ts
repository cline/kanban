import { useCallback, useEffect, useRef, useState } from "react";

import { isClineOauthAuthenticated } from "@/runtime/native-agent";
import { fetchFeaturebaseToken } from "@/runtime/runtime-config-query";
import type { RuntimeClineProviderSettings } from "@/runtime/types";

const FEATUREBASE_SDK_ID = "featurebase-sdk";
const FEATUREBASE_SDK_SRC = "https://do.featurebase.app/js/sdk.js";
const FEATUREBASE_ORGANIZATION = "cline";

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
	/** Current pre-identify readiness. */
	authState: FeaturebaseAuthState;
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

	// Track the latest attempt so we can cancel stale ones.
	const attemptRef = useRef(0);
	// Track the pending retry timer so we can cancel it on cleanup.
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	function clearRetryTimer() {
		if (retryTimerRef.current !== null) {
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
	}

	// Initialize the Featurebase feedback widget once on mount.
	useEffect(() => {
		const win = window as FeaturebaseWindow;
		ensureFeaturebaseCommand(win);
		let cancelled = false;

		void ensureFeaturebaseSdkLoaded()
			.then(() => {
				if (cancelled) {
					return;
				}
				const featurebase = ensureFeaturebaseCommand(win);
				featurebase("initialize_feedback_widget", {
					organization: FEATUREBASE_ORGANIZATION,
					theme: "dark",
					locale: "en",
					metadata: { app: "kanban" },
				});
			})
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	}, []);

	// Core pre-identify routine with bounded automatic retries.
	const runPreIdentify = useCallback(
		(attempt: number, retryIndex: number) => {
			if (!workspaceId || !isAuthenticated) {
				return;
			}

			setAuthState("loading");
			const win = window as FeaturebaseWindow;

			const scheduleRetry = () => {
				if (attemptRef.current !== attempt) {
					return;
				}
				if (retryIndex < RETRY_DELAYS.length) {
					const delay = RETRY_DELAYS[retryIndex];
					retryTimerRef.current = setTimeout(() => {
						if (attemptRef.current !== attempt) {
							return;
						}
						runPreIdentify(attempt, retryIndex + 1);
					}, delay);
				}
			};

			void ensureFeaturebaseSdkLoaded()
				.then(async () => {
					if (attemptRef.current !== attempt) {
						return;
					}
					const tokenResponse = await fetchFeaturebaseToken(workspaceId);
					if (attemptRef.current !== attempt) {
						return;
					}
					const featurebase = ensureFeaturebaseCommand(win);
					featurebase(
						"identify",
						{
							organization: FEATUREBASE_ORGANIZATION,
							featurebaseJwt: tokenResponse.featurebaseJwt,
						},
						(error) => {
							if (attemptRef.current !== attempt) {
								return;
							}
							if (error) {
								setAuthState("error");
								scheduleRetry();
								return;
							}
							clearRetryTimer();
							setAuthState("ready");
						},
					);
				})
				.catch(() => {
					if (attemptRef.current !== attempt) {
						return;
					}
					setAuthState("error");
					scheduleRetry();
				});
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps -- retryTimerRef is a ref
		[workspaceId, isAuthenticated],
	);

	// Pre-identify whenever auth state or workspace changes.
	useEffect(() => {
		clearRetryTimer();

		if (!workspaceId || !isAuthenticated) {
			// Reset to idle when the user signs out or workspace disappears.
			setAuthState("idle");
			return;
		}

		const attempt = ++attemptRef.current;
		runPreIdentify(attempt, 0);

		return () => {
			// Cancel this attempt and any pending retries.
			attemptRef.current++;
			clearRetryTimer();
		};
	}, [workspaceId, isAuthenticated, runPreIdentify]);

	return { authState };
}
