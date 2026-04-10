const LOCALHOST_HOSTS = ["localhost", "127.0.0.1", "::1"];

/**
 * Returns true when the browser is accessing Kanban from the same machine
 * where it is hosted (i.e. via localhost, 127.0.0.1, or the IPv6 loopback).
 *
 * This is a best-effort heuristic — it won't catch cases where a user accesses
 * the server via a LAN hostname from the same machine, but that's acceptable.
 */
export function isLocalhostAccess(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	return LOCALHOST_HOSTS.includes(window.location.hostname);
}
