import { describe, expect, it } from "vitest";

import { isSelectedAgentAuthenticated, shouldShowStartupOnboardingDialog } from "@/runtime/onboarding";

describe("runtime onboarding helpers", () => {
	it("treats non-cline selections as authenticated", () => {
		expect(isSelectedAgentAuthenticated("claude", null)).toBe(true);
		expect(isSelectedAgentAuthenticated("codex", null)).toBe(true);
	});

	it("checks cline authentication from provider settings", () => {
		expect(
			isSelectedAgentAuthenticated("cline", {
				providerId: null,
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(false);
		expect(
			isSelectedAgentAuthenticated("cline", {
				providerId: "anthropic",
				modelId: "claude-3-7-sonnet",
				baseUrl: null,
				apiKeyConfigured: true,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(true);
	});

	it("shows startup onboarding at least once for configured users", () => {
		expect(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog: false,
				isTaskAgentReady: true,
				isSelectedAgentAuthenticated: true,
			}),
		).toBe(true);
	});

	it("does not reopen when onboarding was already shown and readiness is still unknown", () => {
		expect(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog: true,
				isTaskAgentReady: null,
				isSelectedAgentAuthenticated: true,
			}),
		).toBe(false);
	});

	it("shows startup onboarding when selected agent is not authenticated", () => {
		expect(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog: true,
				isTaskAgentReady: true,
				isSelectedAgentAuthenticated: false,
			}),
		).toBe(true);
	});

	it("does not show startup onboarding once shown and setup is ready", () => {
		expect(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog: true,
				isTaskAgentReady: true,
				isSelectedAgentAuthenticated: true,
			}),
		).toBe(false);
	});
});
