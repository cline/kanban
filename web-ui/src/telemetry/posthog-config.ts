import type { PostHogConfig } from "posthog-js";

const DEFAULT_POSTHOG_HOST = "https://data.cline.bot";

function getTrimmedEnvValue(value: string | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export const posthogApiKey = getTrimmedEnvValue(import.meta.env.POSTHOG_KEY);
export const posthogHost = getTrimmedEnvValue(import.meta.env.POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST;

export const posthogOptions: Partial<PostHogConfig> = {
	api_host: posthogHost,
	defaults: "2026-01-30",
	autocapture: false,
	capture_pageview: true,
	capture_pageleave: true,
	disable_session_recording: true,
	capture_exceptions: false,
	person_profiles: "identified_only",
	disable_surveys: true,
	disable_surveys_automatic_display: true,
	disable_web_experiments: true,
};

export function isTelemetryEnabled(): boolean {
	return Boolean(posthogApiKey);
}
