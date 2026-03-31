// Authentication gate hook.
//
// Calls GET /login/me on mount to determine whether the current browser
// has a valid session. Localhost connections always return 200 from the
// server (the auth gate is bypassed), so local users never see the login
// screen.
//
// Also listens for the "kanban:unauthorized" DOM event dispatched by the
// tRPC interceptor when any API call returns a 401 mid-session (e.g. after
// a server restart that clears sessions). This flips the gate to
// "unauthenticated" immediately without requiring a page reload.

import { useCallback, useEffect, useRef, useState } from "react";

export interface AuthIdentity {
	email: string;
	displayName: string | null;
	role: string;
	isLocal: boolean;
}

export type AuthGateStatus = "loading" | "authenticated" | "unauthenticated";

export interface UseAuthGateResult {
	status: AuthGateStatus;
	identity: AuthIdentity | null;
	// Call after a successful login to re-check the session.
	refresh: () => void;
}

export function useAuthGate(): UseAuthGateResult {
	const [status, setStatus] = useState<AuthGateStatus>("loading");
	const [identity, setIdentity] = useState<AuthIdentity | null>(null);
	const [version, setVersion] = useState(0);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;

		const check = async () => {
			try {
				const res = await fetch("/login/me", {
					credentials: "include",
					headers: { Accept: "application/json" },
				});

				if (!mountedRef.current || cancelled) return;

				if (res.ok) {
					const body = (await res.json()) as {
						email?: string;
						userId?: string;
						persistent?: boolean;
						displayName?: string;
						role?: string;
						isLocal?: boolean;
					};
					setIdentity({
						email: body.email ?? "",
						displayName: body.displayName ?? null,
						role: body.role ?? "viewer",
						isLocal: body.isLocal === true,
					});
					setStatus("authenticated");
				} else {
					setStatus("unauthenticated");
				}
			} catch {
				// Network error — could not reach server. Treat as unauthenticated
				// so the login page is shown (which will also fail to load, but
				// gracefully — the server may just be starting up).
				if (!mountedRef.current || cancelled) return;
				setStatus("unauthenticated");
			}
		};

		void check();
		return () => {
			cancelled = true;
		};
	}, [version]);

	// Listen for unauthorized events dispatched by the tRPC interceptor.
	useEffect(() => {
		const handler = () => {
			if (status === "authenticated") {
				setStatus("unauthenticated");
				setIdentity(null);
			}
		};
		window.addEventListener("kanban:unauthorized", handler);
		return () => window.removeEventListener("kanban:unauthorized", handler);
	}, [status]);

	const refresh = useCallback(() => {
		setStatus("loading");
		setVersion((v) => v + 1);
	}, []);

	return { status, identity, refresh };
}
