// ClinePass (`cline-pass`) identity helpers for the bundled Cline SDK.
//
// The bundled `@clinebot/core` provider registry has no `cline-pass` entry, so a
// card that inherits `cline-pass` from the shared `~/.cline` config fails at
// model resolution with `Unknown or disabled provider "cline-pass"` before any
// request is made.
//
// ClinePass is not a separate API surface though: it is the same Cline endpoint,
// the same Cline account OAuth token, and the same OpenAI-compatible protocol as
// the usage-billing `cline` provider. Only the model namespace differs — the
// Cline API bills a request against the subscription when the model id is
// `cline-pass/*`.
//
// So Kanban keeps `cline-pass` as its own selectable provider (own catalog
// entry, own model list, own saved settings) and hands the bundled SDK the
// `cline` provider id when it starts a session, leaving the `cline-pass/*` model
// id untouched. Once the bundled SDK registers `cline-pass` itself, its own
// definition takes over and these helpers stop contributing anything.

export const CLINE_PROVIDER_ID = "cline";
export const CLINE_PASS_PROVIDER_ID = "cline-pass";
export const CLINE_PASS_PROVIDER_NAME = "ClinePass";
export const CLINE_PASS_BASE_URL = "https://api.cline.bot/api/v1";
// Mirrors the `cline-pass` default model published by the newer `@cline/llms`
// provider catalog that the Cline CLI and extension run on.
export const CLINE_PASS_DEFAULT_MODEL_ID = "cline-pass/glm-5.2";

export function isClinePassProviderId(providerId: string | null | undefined): boolean {
	return providerId?.trim().toLowerCase() === CLINE_PASS_PROVIDER_ID;
}

/**
 * True for every provider backed by a Cline account: usage-billing `cline` and
 * subscription `cline-pass` share one OAuth token, one API base URL, and one set
 * of account endpoints (profile, balance, organizations, Featurebase).
 */
export function isClineAccountProviderId(providerId: string | null | undefined): boolean {
	const normalizedProviderId = providerId?.trim().toLowerCase();
	return normalizedProviderId === CLINE_PROVIDER_ID || normalizedProviderId === CLINE_PASS_PROVIDER_ID;
}

/**
 * Maps a Kanban provider id onto the provider id the bundled SDK knows.
 * `cline-pass` requests run through the registered `cline` provider; the
 * `cline-pass/*` model id is what routes them to the subscription.
 *
 * Saved provider settings stay keyed by the Kanban provider id, because that is
 * the key the Cline CLI and extension write in the shared config.
 */
export function resolveSdkRuntimeProviderId(providerId: string): string {
	return isClinePassProviderId(providerId) ? CLINE_PROVIDER_ID : providerId;
}
