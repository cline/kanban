// Unified webhook service: in-memory subscription registry with
// fire-and-forget HTTP/unix-socket delivery and HMAC signing.
// Subscriptions live for the server's lifetime — consumers re-register on startup.
import { createHmac, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";

import type {
	WebhookEvent,
	WebhookEventType,
	WebhookListResponse,
	WebhookRegistration,
	WebhookRegistrationRequest,
	WebhookRegistrationResponse,
	WebhookUnregisterRequest,
	WebhookUnregisterResponse,
} from "../core/api-contract.js";

const RETRY_DELAY_MS = 1_000;
const DELIVERY_TIMEOUT_MS = 10_000;
const UNIX_PREFIX = "unix:";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WebhookService {
	register: (input: WebhookRegistrationRequest) => WebhookRegistrationResponse;
	unregister: (input: WebhookUnregisterRequest) => WebhookUnregisterResponse;
	list: () => WebhookListResponse;
	dispatch: (events: WebhookEvent[]) => void;
}

export interface CreateWebhookServiceDependencies {
	warn?: (message: string) => void;
	/** Overridable fetch for testing HTTP delivery. Defaults to global fetch. */
	deliverPayload?: (url: string, init: RequestInit) => Promise<Response>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface StoredRegistration extends WebhookRegistration {
	secret: string | null;
}

// ---------------------------------------------------------------------------
// Unix socket helpers
// ---------------------------------------------------------------------------

function isUnixSocketUrl(url: string): boolean {
	return url.startsWith(UNIX_PREFIX);
}

/**
 * Parse a unix socket URL into its socket path and optional HTTP path.
 * Format: "unix:/path/to/socket" or "unix:/path/to/socket:/http/path"
 */
function parseUnixSocketUrl(url: string): { socketPath: string; httpPath: string } {
	const rest = url.slice(UNIX_PREFIX.length);
	const colonIndex = rest.indexOf(":", 1);
	if (colonIndex === -1) {
		return { socketPath: rest, httpPath: "/" };
	}
	return {
		socketPath: rest.slice(0, colonIndex),
		httpPath: rest.slice(colonIndex + 1) || "/",
	};
}

function deliverToUnixSocket(
	socketPath: string,
	httpPath: string,
	body: string,
	headers: Record<string, string>,
): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const timeout = setTimeout(() => {
			req.destroy();
			resolve(false);
		}, DELIVERY_TIMEOUT_MS);
		timeout.unref();

		const req = httpRequest(
			{
				socketPath,
				path: httpPath,
				method: "POST",
				headers: {
					...headers,
					"Content-Length": Buffer.byteLength(body).toString(),
				},
			},
			(res) => {
				clearTimeout(timeout);
				res.resume();
				const statusCode = res.statusCode ?? 0;
				resolve(statusCode >= 200 && statusCode < 300);
			},
		);
		req.on("error", () => {
			clearTimeout(timeout);
			resolve(false);
		});
		req.end(body);
	});
}

// ---------------------------------------------------------------------------
// Delivery helpers
// ---------------------------------------------------------------------------

function signPayload(payload: string, secret: string): string {
	return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

async function attemptDelivery(
	url: string,
	body: string,
	headers: Record<string, string>,
	deliverPayload: (url: string, init: RequestInit) => Promise<Response>,
): Promise<boolean> {
	if (isUnixSocketUrl(url)) {
		const { socketPath, httpPath } = parseUnixSocketUrl(url);
		return await deliverToUnixSocket(socketPath, httpPath, body, headers);
	}
	try {
		const response = await deliverPayload(url, {
			method: "POST",
			headers,
			body,
			signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
		});
		return response.ok;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createWebhookService(deps: CreateWebhookServiceDependencies = {}): WebhookService {
	const deliverPayload = deps.deliverPayload ?? globalThis.fetch;
	const warn = deps.warn ?? (() => {});
	const registrations = new Map<string, StoredRegistration>();

	function toPublic(stored: StoredRegistration): WebhookRegistration {
		return { id: stored.id, url: stored.url, events: stored.events, createdAt: stored.createdAt };
	}

	function getMatchingRegistrations(eventType: WebhookEventType): StoredRegistration[] {
		const matches: StoredRegistration[] = [];
		for (const stored of registrations.values()) {
			if (stored.events === null || stored.events.includes(eventType)) {
				matches.push(stored);
			}
		}
		return matches;
	}

	return {
		register: (input) => {
			const id = randomUUID();
			const stored: StoredRegistration = {
				id,
				url: input.url,
				events: input.events ?? null,
				createdAt: Date.now(),
				secret: input.secret ?? null,
			};
			registrations.set(id, stored);
			return { ok: true, registration: toPublic(stored) };
		},

		unregister: (input) => {
			if (!registrations.delete(input.id)) {
				return { ok: false, error: `Webhook registration not found: ${input.id}` };
			}
			return { ok: true };
		},

		list: () => ({
			registrations: Array.from(registrations.values(), toPublic),
		}),

		dispatch: (events) => {
			if (events.length === 0) {
				return;
			}

			// Fire-and-forget — errors are logged, not propagated.
			void (async () => {
				for (const event of events) {
					const targets = getMatchingRegistrations(event.type);
					if (targets.length === 0) {
						continue;
					}

					const body = JSON.stringify(event);

					for (const registration of targets) {
						const headers: Record<string, string> = {
							"Content-Type": "application/json",
							"X-Kanban-Event": event.type,
							"X-Kanban-Delivery": event.id,
						};

						if (registration.secret) {
							headers["X-Kanban-Signature"] = signPayload(body, registration.secret);
						}

						const ok = await attemptDelivery(registration.url, body, headers, deliverPayload);
						if (!ok) {
							await new Promise<void>((resolve) => {
								setTimeout(resolve, RETRY_DELAY_MS);
							});
							const retryOk = await attemptDelivery(registration.url, body, headers, deliverPayload);
							if (!retryOk) {
								warn(
									`Webhook delivery failed after retry: ${event.type} → ${registration.url} (registration ${registration.id})`,
								);
							}
						}
					}
				}
			})();
		},
	};
}
