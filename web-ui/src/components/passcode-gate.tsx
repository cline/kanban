import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { type FormEvent, type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

// ── Provider ──────────────────────────────────────────────────────────────────

interface PasscodeStatusResponse {
	required: boolean;
	authenticated: boolean;
}

type AuthState = "loading" | "authenticated" | "requires-passcode";

/**
 * Wraps children with a passcode gate. On mount it checks
 * `/api/passcode/status`; if authentication is required and the visitor
 * hasn't authenticated yet, it renders the passcode entry form instead.
 * On success the page reloads so the session cookie is applied to all
 * subsequent requests.
 *
 * Static assets (JS, CSS, images) are served freely by the server even when
 * unauthenticated, so the React bundle can load and reach this component
 * before any protected API calls are made.
 */
export function PasscodeGateProvider({ children }: { children: ReactNode }): ReactElement {
	const [authState, setAuthState] = useState<AuthState>("loading");

	useEffect(() => {
		let cancelled = false;
		fetch("/api/passcode/status", { credentials: "same-origin" })
			.then(async (res) => {
				if (cancelled) return;
				const data = (await res.json()) as PasscodeStatusResponse;
				if (cancelled) return;
				setAuthState(!data.required || data.authenticated ? "authenticated" : "requires-passcode");
			})
			.catch(() => {
				if (!cancelled) setAuthState("authenticated");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (authState === "loading") return <></>;

	if (authState === "requires-passcode") {
		return <PasscodeGate onAuthenticated={() => window.location.reload()} />;
	}

	return <>{children}</>;
}

// ── Form ──────────────────────────────────────────────────────────────────────

interface PasscodeGateProps {
	onAuthenticated: () => void;
}

type GateState = "idle" | "submitting" | "error" | "locked";

const MIN_ERROR_DISPLAY_MS = 800;

export function PasscodeGate({ onAuthenticated }: PasscodeGateProps): ReactElement {
	const [passcode, setPasscode] = useState("");
	const [state, setState] = useState<GateState>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [lockoutSeconds, setLockoutSeconds] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	useEffect(() => {
		return () => {
			if (lockoutTimerRef.current) {
				clearInterval(lockoutTimerRef.current);
			}
		};
	}, []);

	const startLockoutCountdown = useCallback((seconds: number) => {
		setLockoutSeconds(seconds);
		setState("locked");
		lockoutTimerRef.current = setInterval(() => {
			setLockoutSeconds((prev) => {
				if (prev <= 1) {
					if (lockoutTimerRef.current) {
						clearInterval(lockoutTimerRef.current);
						lockoutTimerRef.current = null;
					}
					setState("idle");
					setErrorMessage(null);
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
	}, []);

	const handleSubmit = useCallback(
		async (e: FormEvent) => {
			e.preventDefault();
			if (state === "submitting" || state === "locked") return;
			if (!passcode.trim()) return;

			setState("submitting");
			setErrorMessage(null);

			const submitStart = Date.now();

			try {
				const response = await fetch("/api/passcode/verify", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ passcode: passcode.trim() }),
					credentials: "same-origin",
				});

				if (response.ok) {
					onAuthenticated();
					return;
				}

				// Rate limited
				if (response.status === 429) {
					const retryAfter = response.headers.get("Retry-After");
					const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : 30;
					startLockoutCountdown(Number.isFinite(seconds) ? seconds : 30);
					setErrorMessage("Too many failed attempts. Please wait before trying again.");
					setPasscode("");
					return;
				}

				// Wrong passcode — enforce minimum display time to prevent timing analysis
				const elapsed = Date.now() - submitStart;
				const remaining = MIN_ERROR_DISPLAY_MS - elapsed;
				if (remaining > 0) {
					await new Promise((resolve) => setTimeout(resolve, remaining));
				}

				setErrorMessage("Incorrect passcode. Please try again.");
				setState("error");
				setPasscode("");
				inputRef.current?.focus();
			} catch {
				setErrorMessage("Could not connect to the server. Please try again.");
				setState("error");
			}
		},
		[passcode, state, onAuthenticated, startLockoutCountdown],
	);

	const isDisabled = state === "submitting" || state === "locked";

	return (
		<div className="flex min-h-screen items-center justify-center bg-surface-0 p-6">
			<div className="w-full max-w-sm">
				<div className="rounded-xl border border-border bg-surface-1 p-6 shadow-2xl">
					<div className="mb-5 flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
							<KeyRound size={18} />
						</div>
						<div>
							<h1 className="text-base font-semibold text-text-primary">Remote Access</h1>
							<p className="text-xs text-text-secondary">Enter the passcode to continue</p>
						</div>
					</div>

					<form onSubmit={(e) => void handleSubmit(e)}>
						<div className="space-y-3">
							<input
								ref={inputRef}
								type="password"
								value={passcode}
								onChange={(e) => {
									setPasscode(e.target.value);
									if (state === "error") setState("idle");
									setErrorMessage(null);
								}}
								placeholder="Passcode"
								disabled={isDisabled}
								autoComplete="one-time-code"
								className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none disabled:opacity-50"
							/>

							{errorMessage && (
								<p className="text-xs text-status-red" role="alert">
									{errorMessage}
								</p>
							)}

							{state === "locked" && lockoutSeconds > 0 && (
								<p className="text-xs text-text-secondary">Try again in {lockoutSeconds}s</p>
							)}

							<Button
								type="submit"
								variant="primary"
								fill
								disabled={isDisabled || !passcode.trim()}
								icon={
									state === "submitting" ? (
										<Loader2 size={14} className="animate-spin" />
									) : (
										<ShieldCheck size={14} />
									)
								}
							>
								{state === "submitting" ? "Verifying…" : "Access Kanban"}
							</Button>
						</div>
					</form>
				</div>
				<p className="mt-3 text-center text-xs text-text-tertiary">
					The passcode was printed to the console when Kanban started.
				</p>
			</div>
		</div>
	);
}
