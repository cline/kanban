import type { RuntimeHookEvent } from "../../core/api-contract";
import { readStringField } from "./hook-utils";

const PERMISSION_STOP_CANCELLED_REASONS = new Set(["permission_rejected", "permission_cancelled"]);

function readHookEventName(payload: Record<string, unknown> | null, hookEventName?: string | null): string | null {
	if (typeof hookEventName === "string" && hookEventName.trim().length > 0) {
		return hookEventName.trim();
	}
	if (!payload) {
		return null;
	}
	return (
		readStringField(payload, "hook_event_name") ??
		readStringField(payload, "hookEventName") ??
		readStringField(payload, "hookName")
	);
}

export function resolveGrokHookIngestEvent(
	event: RuntimeHookEvent,
	payload: Record<string, unknown> | null,
	hookEventName?: string | null,
): RuntimeHookEvent {
	const name = readHookEventName(payload, hookEventName);
	const reason = payload ? readStringField(payload, "reason") : null;

	if (name === "Stop" && event === "to_review" && reason !== "end_turn") {
		return "activity";
	}
	if (name === "StopCancelled" && reason && PERMISSION_STOP_CANCELLED_REASONS.has(reason)) {
		return "to_review";
	}
	return event;
}
