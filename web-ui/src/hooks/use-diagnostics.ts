import { useCallback, useEffect, useRef, useState } from "react";

import { fetchClineAccountProfile } from "@/runtime/runtime-config-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiagnosticsWsState = "connected" | "disconnected" | "reconnecting";

export interface DiagnosticsData {
	/** "local" or "remote" connection to the runtime server. */
	connectionType: "local" | "remote";
	/** Round-trip latency to the runtime server in milliseconds, or null if unmeasured. */
	latencyMs: number | null;
	/** Runtime server version string from the initial snapshot. */
	runtimeVersion: string;
	/** Current WebSocket stream state. */
	wsState: DiagnosticsWsState;
	/** Whether the Cline account / API key is configured (not necessarily validated). */
	authStatus: "authenticated" | "unauthenticated" | "unknown";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseDiagnosticsInput {
	open: boolean;
	isLocal: boolean;
	runtimeVersion: string;
	isRuntimeDisconnected: boolean;
	streamError: string | null;
	hasReceivedSnapshot: boolean;
	workspaceId: string | null;
}

export interface UseDiagnosticsResult {
	isDiagnosticsOpen: boolean;
	diagnostics: DiagnosticsData;
	handleOpenDiagnostics: () => void;
	handleDiagnosticsOpenChange: (nextOpen: boolean) => void;
}

const LATENCY_POLL_INTERVAL_MS = 5_000;

function deriveWsState(
	hasReceivedSnapshot: boolean,
	isRuntimeDisconnected: boolean,
	streamError: string | null,
): DiagnosticsWsState {
	if (isRuntimeDisconnected) {
		return "disconnected";
	}
	if (streamError && !hasReceivedSnapshot) {
		return "reconnecting";
	}
	if (streamError) {
		return "reconnecting";
	}
	if (hasReceivedSnapshot) {
		return "connected";
	}
	return "reconnecting";
}

async function measureLatency(): Promise<number | null> {
	try {
		const start = performance.now();
		const response = await fetch("/api/trpc/runtime.getConfig?batch=1&input=%7B%7D", {
			method: "HEAD",
			cache: "no-store",
		});
		const end = performance.now();
		if (response.ok || response.status === 400 || response.status === 405) {
			// Any response from the server counts — we are measuring round-trip time.
			return Math.round(end - start);
		}
		return null;
	} catch {
		return null;
	}
}

export function useDiagnostics({
	open,
	isLocal,
	runtimeVersion,
	isRuntimeDisconnected,
	streamError,
	hasReceivedSnapshot,
	workspaceId,
}: UseDiagnosticsInput): UseDiagnosticsResult {
	const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
	const [latencyMs, setLatencyMs] = useState<number | null>(null);
	const [authStatus, setAuthStatus] = useState<DiagnosticsData["authStatus"]>("unknown");
	const latencyTimerRef = useRef<number | null>(null);

	const effectiveOpen = open || isDiagnosticsOpen;

	// Latency polling while the diagnostics panel is open.
	useEffect(() => {
		if (!effectiveOpen) {
			setLatencyMs(null);
			return;
		}

		let cancelled = false;

		const poll = async () => {
			if (cancelled) return;
			const ms = await measureLatency();
			if (!cancelled) setLatencyMs(ms);
		};

		void poll();
		const timer = window.setInterval(() => {
			void poll();
		}, LATENCY_POLL_INTERVAL_MS);
		latencyTimerRef.current = timer;

		return () => {
			cancelled = true;
			if (latencyTimerRef.current !== null) {
				window.clearInterval(latencyTimerRef.current);
				latencyTimerRef.current = null;
			}
		};
	}, [effectiveOpen]);

	// Auth status check when the panel opens.
	useEffect(() => {
		if (!effectiveOpen) {
			setAuthStatus("unknown");
			return;
		}

		let cancelled = false;

		void (async () => {
			try {
				const profile = await fetchClineAccountProfile(workspaceId);
				if (cancelled) return;
				setAuthStatus(profile.profile ? "authenticated" : "unauthenticated");
			} catch {
				if (!cancelled) setAuthStatus("unknown");
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [effectiveOpen, workspaceId]);

	const handleOpenDiagnostics = useCallback(() => {
		setIsDiagnosticsOpen(true);
	}, []);

	const handleDiagnosticsOpenChange = useCallback((nextOpen: boolean) => {
		setIsDiagnosticsOpen(nextOpen);
	}, []);

	const wsState = deriveWsState(hasReceivedSnapshot, isRuntimeDisconnected, streamError);

	return {
		isDiagnosticsOpen,
		diagnostics: {
			connectionType: isLocal ? "local" : "remote",
			latencyMs,
			runtimeVersion,
			wsState,
			authStatus,
		},
		handleOpenDiagnostics,
		handleDiagnosticsOpenChange,
	};
}
