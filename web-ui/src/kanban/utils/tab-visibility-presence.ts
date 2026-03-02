const TAB_VISIBILITY_PRESENCE_STORAGE_KEY = "kanbanana.tab-visibility-presence.v1";
const TAB_VISIBILITY_STALE_MS = 15000;

interface TabVisibilityPresenceEntry {
	workspaceId: string;
	timestamp: number;
}

function readPresence(): Record<string, TabVisibilityPresenceEntry> {
	if (typeof window === "undefined") {
		return {};
	}
	try {
		const raw = window.localStorage.getItem(TAB_VISIBILITY_PRESENCE_STORAGE_KEY);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return {};
		}
		const result: Record<string, TabVisibilityPresenceEntry> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof key !== "string" || key.trim().length === 0) {
				continue;
			}
			if (!value || typeof value !== "object") {
				continue;
			}
			const workspaceId =
				"workspaceId" in value && typeof value.workspaceId === "string"
					? value.workspaceId.trim()
					: "";
			const timestamp =
				"timestamp" in value && typeof value.timestamp === "number"
					? value.timestamp
					: 0;
			if (workspaceId.length > 0 && Number.isFinite(timestamp)) {
				result[key] = {
					workspaceId,
					timestamp,
				};
			}
		}
		return result;
	} catch {
		return {};
	}
}

function writePresence(presence: Record<string, TabVisibilityPresenceEntry>): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(TAB_VISIBILITY_PRESENCE_STORAGE_KEY, JSON.stringify(presence));
	} catch {
		// Ignore storage failures.
	}
}

function pruneStaleEntries(
	presence: Record<string, TabVisibilityPresenceEntry>,
	now: number,
	staleMs = TAB_VISIBILITY_STALE_MS,
): Record<string, TabVisibilityPresenceEntry> {
	const next: Record<string, TabVisibilityPresenceEntry> = {};
	for (const [tabId, entry] of Object.entries(presence)) {
		if (now - entry.timestamp <= staleMs) {
			next[tabId] = entry;
		}
	}
	return next;
}

export function createTabPresenceId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function markTabVisible(tabId: string, workspaceId: string | null | undefined): void {
	const normalizedWorkspaceId = workspaceId?.trim();
	if (!tabId || !normalizedWorkspaceId || typeof window === "undefined") {
		return;
	}
	const now = Date.now();
	const next = pruneStaleEntries(readPresence(), now);
	next[tabId] = {
		workspaceId: normalizedWorkspaceId,
		timestamp: now,
	};
	writePresence(next);
}

export function markTabHidden(tabId: string): void {
	if (!tabId || typeof window === "undefined") {
		return;
	}
	const now = Date.now();
	const next = pruneStaleEntries(readPresence(), now);
	delete next[tabId];
	writePresence(next);
}

export function hasVisibleKanbananaTabForWorkspace(workspaceId: string | null | undefined): boolean {
	const normalizedWorkspaceId = workspaceId?.trim();
	if (!normalizedWorkspaceId || typeof window === "undefined") {
		return false;
	}
	const now = Date.now();
	const next = pruneStaleEntries(readPresence(), now);
	if (Object.keys(next).length === 0) {
		return false;
	}
	return Object.values(next).some((entry) => entry.workspaceId === normalizedWorkspaceId);
}
