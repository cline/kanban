// Login/logout HTTP endpoint handler.
//
// All responses are JSON. The frontend is responsible for all UI.
//
// Endpoints:
//   GET  /login/config          - Returns auth mode and whether a local Cline
//                                 token is available (no auth required).
//   GET  /login/me              - Returns the current session identity or 401.
//   POST /login/cline           - Validate a WorkOS token, set session cookie.
//   POST /login/cline-autodetect- (localhost only) Read the stored Cline token
//                                 automatically and return it for the frontend.
//   POST /login/password        - Validate email+password, set session cookie.
//   POST /logout                - Revoke session, clear cookie.
//   GET  /auth/start            - Begin server-side OAuth relay (Option B).
//   GET  /auth/callback         - Complete server-side OAuth relay.

import type { IncomingMessage, ServerResponse } from "node:http";

import { getSdkProviderSettings } from "../cline-sdk/sdk-provider-boundary";
import { loadRemoteConfig } from "../remote/config-store";
import type { RemoteAuth } from "./remote-auth";
import { isLocalRequest } from "./remote-auth";

const CLINE_API_BASE = "https://api.cline.bot";
const WORKOS_PREFIX = "workos:";

export interface CreateLoginHandlerDependencies {
	remoteAuth: RemoteAuth;
}

export interface LoginHandler {
	handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export function createLoginHandler(deps: CreateLoginHandlerDependencies): LoginHandler {
	const { remoteAuth } = deps;

	function json(res: ServerResponse, status: number, body: unknown): void {
		const payload = JSON.stringify(body);
		res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
		res.end(payload);
	}

	async function readBody(req: IncomingMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			let size = 0;
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > 1024 * 64) {
					reject(new Error("Request body too large."));
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => {
				try {
					const raw = Buffer.concat(chunks).toString("utf-8");
					resolve(raw ? (JSON.parse(raw) as unknown) : {});
				} catch {
					reject(new Error("Invalid JSON body."));
				}
			});
			req.on("error", reject);
		});
	}

	// Validates a WorkOS access token against api.cline.bot and returns the
	// user's email and userId, or null on failure.
	async function validateWorkosToken(
		rawToken: string,
	): Promise<{ email: string; userId: string; displayName: string | null } | null> {
		const prefixed = rawToken.toLowerCase().startsWith(WORKOS_PREFIX) ? rawToken : `${WORKOS_PREFIX}${rawToken}`;
		try {
			const res = await fetch(`${CLINE_API_BASE}/v1/users/me`, {
				headers: { Authorization: `Bearer ${prefixed}` },
				signal: AbortSignal.timeout(8_000),
			});
			if (!res.ok) return null;
			const body = (await res.json()) as { id?: string; sub?: string; email?: string; displayName?: string };
			const userId = (body.id ?? body.sub ?? "").trim();
			const email = (body.email ?? "").trim();
			if (!userId || !email) return null;
			const displayName = body.displayName?.trim() || null;
			return { userId, email, displayName };
		} catch {
			return null;
		}
	}

	// Checks whether the user's email satisfies the configured allowlist.
	function isEmailAllowed(email: string, config: Awaited<ReturnType<typeof loadRemoteConfig>>): boolean {
		if (config.allowedEmails.length === 0 && config.allowedEmailDomains.length === 0) {
			// Open — any authenticated Cline user is allowed.
			return true;
		}
		if (config.allowedEmails.includes(email)) return true;
		const domain = email.split("@")[1]?.toLowerCase() ?? "";
		return config.allowedEmailDomains.some((d) => d.toLowerCase() === domain);
	}

	return {
		async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
			const url = new URL(req.url ?? "/", "http://localhost");
			const pathname = url.pathname;
			const method = req.method?.toUpperCase() ?? "GET";

			try {
				// ── GET /login/config ───────────────────────────────────────
				if (method === "GET" && pathname === "/login/config") {
					const config = await loadRemoteConfig();
					// Check if there is a stored Cline token on this machine.
					const clineSettings = getSdkProviderSettings("cline");
					const hasClineToken = Boolean(clineSettings?.auth?.accessToken?.trim());
					json(res, 200, {
						authMode: config.authMode,
						hasClineToken,
						vapidPublicKey: remoteAuth.pushManager.getPublicKey(),
					});
					return;
				}

				// ── GET /login/me ───────────────────────────────────────────
				if (method === "GET" && pathname === "/login/me") {
					const session = await remoteAuth.validateSession(req.headers.cookie ?? "");
					if (!session) {
						json(res, 401, { error: "Not authenticated." });
						return;
					}
					await remoteAuth.touchSession(session.sessionId);
					json(res, 200, { email: session.email, userId: session.userId, persistent: session.persistent });
					return;
				}

				// ── POST /login/cline ───────────────────────────────────────
				if (method === "POST" && pathname === "/login/cline") {
					const config = await loadRemoteConfig();
					if (config.authMode === "password") {
						json(res, 400, { error: "WorkOS login is not enabled." });
						return;
					}

					const body = await readBody(req);
					const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
					const accessToken = typeof b.accessToken === "string" ? b.accessToken.trim() : "";
					const persistent = b.persistent === true;

					if (!accessToken) {
						json(res, 400, { error: "accessToken is required." });
						return;
					}

					const identity = await validateWorkosToken(accessToken);
					if (!identity) {
						json(res, 401, { error: "Invalid or expired Cline token." });
						return;
					}

					if (!isEmailAllowed(identity.email, config)) {
						json(res, 403, { error: "Your account is not authorised to access this Kanban instance." });
						return;
					}

					const { cookie } = await remoteAuth.createSession({
						email: identity.email,
						userId: identity.userId,
						displayName: identity.displayName,
						persistent,
					});
					res.writeHead(200, {
						"Content-Type": "application/json; charset=utf-8",
						"Set-Cookie": cookie,
					});
					res.end(JSON.stringify({ ok: true, email: identity.email, displayName: identity.displayName }));
					return;
				}

				// ── POST /login/cline-autodetect ────────────────────────────
				// Localhost-only: reads the locally stored Cline access token and
				// returns it so the frontend can pre-fill the login form or pass
				// it directly to /login/cline on behalf of the local user.
				if (method === "POST" && pathname === "/login/cline-autodetect") {
					if (!isLocalRequest(req)) {
						json(res, 403, { error: "This endpoint is only available on localhost." });
						return;
					}
					const clineSettings = getSdkProviderSettings("cline");
					const rawToken = clineSettings?.auth?.accessToken?.trim() ?? "";
					if (!rawToken) {
						json(res, 404, { error: "No Cline account token found. Please sign in to Cline first." });
						return;
					}
					// Strip workos: prefix before returning — the client will pass it
					// back to /login/cline which re-adds the prefix for validation.
					const token = rawToken.startsWith(WORKOS_PREFIX) ? rawToken.slice(WORKOS_PREFIX.length) : rawToken;
					json(res, 200, { token });
					return;
				}

				// ── POST /login/password ────────────────────────────────────
				if (method === "POST" && pathname === "/login/password") {
					const config = await loadRemoteConfig();
					if (config.authMode === "workos") {
						json(res, 400, { error: "Password login is not enabled." });
						return;
					}

					const body = await readBody(req);
					const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
					const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : null;
					const password = typeof b.password === "string" ? b.password : "";
					const persistent = b.persistent === true;

					if (!password) {
						json(res, 400, { error: "password is required." });
						return;
					}

					let authedEmail: string | null = null;

					// Check shared password (no email required).
					if (config.password && (await remoteAuth.verifyPassword(password, config.password))) {
						authedEmail = email ?? "local";
					}

					// Check local user accounts (email required).
					if (!authedEmail && email) {
						const localUser = config.localUsers.find((u) => u.email.toLowerCase() === email);
						if (localUser && (await remoteAuth.verifyPassword(password, localUser.passwordHash))) {
							authedEmail = localUser.email;
						}
					}

					if (!authedEmail) {
						json(res, 401, { error: "Invalid email or password." });
						return;
					}

					const { cookie } = await remoteAuth.createSession({
						email: authedEmail,
						userId: null,
						displayName: null, // derived from email by getOrCreateUserRecord
						persistent,
					});
					res.writeHead(200, {
						"Content-Type": "application/json; charset=utf-8",
						"Set-Cookie": cookie,
					});
					res.end(JSON.stringify({ ok: true, email: authedEmail }));
					return;
				}

				// ── POST /logout ────────────────────────────────────────────
				if (method === "POST" && pathname === "/logout") {
					const session = await remoteAuth.validateSession(req.headers.cookie ?? "");
					if (session) {
						remoteAuth.revokeSession(session.sessionId);
					}
					res.writeHead(200, {
						"Content-Type": "application/json; charset=utf-8",
						"Set-Cookie": remoteAuth.clearCookie(),
					});
					res.end(JSON.stringify({ ok: true }));
					return;
				}

				// ── GET /auth/start (server-side OAuth relay, Option B) ─────
				if (method === "GET" && pathname === "/auth/start") {
					const config = await loadRemoteConfig();
					if (!config.publicBaseUrl) {
						json(res, 400, {
							error: "publicBaseUrl is not configured. Set it in remote settings to enable browser OAuth.",
						});
						return;
					}
					const redirectUri = `${config.publicBaseUrl.replace(/\/$/, "")}/auth/callback`;
					const authorizeUrl = new URL(`${CLINE_API_BASE}/api/v1/auth/authorize`);
					authorizeUrl.searchParams.set("client_type", "extension");
					authorizeUrl.searchParams.set("callback_url", redirectUri);
					authorizeUrl.searchParams.set("redirect_uri", redirectUri);
					res.writeHead(302, { Location: authorizeUrl.toString() });
					res.end();
					return;
				}

				// ── GET /auth/callback (server-side OAuth relay, Option B) ──
				if (method === "GET" && pathname === "/auth/callback") {
					const code = url.searchParams.get("code");
					const error = url.searchParams.get("error");

					if (error) {
						json(res, 400, { error: `OAuth error: ${error}` });
						return;
					}
					if (!code) {
						json(res, 400, { error: "Missing authorization code." });
						return;
					}

					const config = await loadRemoteConfig();
					if (!config.publicBaseUrl) {
						json(res, 400, { error: "publicBaseUrl is not configured." });
						return;
					}
					const redirectUri = `${config.publicBaseUrl.replace(/\/$/, "")}/auth/callback`;

					// Exchange code for access token.
					let accessToken: string;
					try {
						const tokenRes = await fetch(`${CLINE_API_BASE}/api/v1/auth/token`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								grant_type: "authorization_code",
								client_type: "extension",
								code,
								redirect_uri: redirectUri,
							}),
							signal: AbortSignal.timeout(10_000),
						});
						if (!tokenRes.ok) {
							json(res, 401, { error: "Token exchange failed." });
							return;
						}
						const tokenBody = (await tokenRes.json()) as { access?: string; access_token?: string };
						accessToken = (tokenBody.access ?? tokenBody.access_token ?? "").trim();
						if (!accessToken) {
							json(res, 401, { error: "No access token in response." });
							return;
						}
					} catch {
						json(res, 502, { error: "Failed to contact Cline auth server." });
						return;
					}

					const identity = await validateWorkosToken(accessToken);
					if (!identity) {
						json(res, 401, { error: "Token validation failed." });
						return;
					}
					if (!isEmailAllowed(identity.email, config)) {
						json(res, 403, { error: "Your account is not authorised to access this Kanban instance." });
						return;
					}

					const { cookie } = await remoteAuth.createSession({
						email: identity.email,
						userId: identity.userId,
						displayName: identity.displayName,
						persistent: false,
					});
					res.writeHead(302, {
						Location: "/",
						"Set-Cookie": cookie,
					});
					res.end();
					return;
				}

				json(res, 404, { error: "Not found." });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				json(res, 500, { error: message });
			}
		},
	};
}
