import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeaturebaseFeedbackButton } from "@/components/featurebase-feedback-button";
import type { FeaturebaseFeedbackState } from "@/hooks/use-featurebase-feedback-widget";
import type { RuntimeClineProviderSettings } from "@/runtime/types";

const defaultClineProviderSettings: RuntimeClineProviderSettings = {
	providerId: null,
	modelId: null,
	baseUrl: null,
	apiKeyConfigured: false,
	oauthProvider: null,
	oauthAccessTokenConfigured: false,
	oauthRefreshTokenConfigured: false,
	oauthAccountId: null,
	oauthExpiresAt: null,
};

const authenticatedClineSettings: RuntimeClineProviderSettings = {
	...defaultClineProviderSettings,
	oauthProvider: "cline",
	oauthAccessTokenConfigured: true,
	oauthRefreshTokenConfigured: true,
	oauthAccountId: "acc-1",
};

const tokensOnlySettings: RuntimeClineProviderSettings = {
	...defaultClineProviderSettings,
	oauthProvider: null,
	oauthAccessTokenConfigured: true,
	oauthRefreshTokenConfigured: true,
};

function createFeaturebaseFeedbackState(authState: FeaturebaseFeedbackState["authState"]): {
	state: FeaturebaseFeedbackState;
	openFeedback: ReturnType<typeof vi.fn<() => void>>;
} {
	const openFeedback = vi.fn<() => void>();
	return {
		state: {
			authState,
			openFeedback,
		},
		openFeedback,
	};
}

describe("FeaturebaseFeedbackButton", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
	});

	function getFeedbackButton(): HTMLButtonElement | null {
		const buttons = container.querySelectorAll("button");
		for (const button of buttons) {
			if (button.textContent?.includes("Share Feedback")) {
				return button;
			}
		}
		return null;
	}

	it("renders nothing when selected agent is not Cline", () => {
		const { state: fbState } = createFeaturebaseFeedbackState("ready");
		act(() => {
			root.render(
				<FeaturebaseFeedbackButton
					selectedAgentId={"claude"}
					clineProviderSettings={authenticatedClineSettings}
					featurebaseFeedbackState={fbState}
				/>,
			);
		});
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing when not authenticated", () => {
		const { state: fbState } = createFeaturebaseFeedbackState("ready");
		act(() => {
			root.render(
				<FeaturebaseFeedbackButton
					selectedAgentId={"cline"}
					clineProviderSettings={defaultClineProviderSettings}
					featurebaseFeedbackState={fbState}
				/>,
			);
		});
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing when tokens exist but oauthProvider is not cline", () => {
		const { state: fbState } = createFeaturebaseFeedbackState("ready");
		act(() => {
			root.render(
				<FeaturebaseFeedbackButton
					selectedAgentId={"cline"}
					clineProviderSettings={tokensOnlySettings}
					featurebaseFeedbackState={fbState}
				/>,
			);
		});
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing when Featurebase state is idle", () => {
		const { state: fbState } = createFeaturebaseFeedbackState("idle");
		act(() => {
			root.render(
				<FeaturebaseFeedbackButton
					selectedAgentId={"cline"}
					clineProviderSettings={authenticatedClineSettings}
					featurebaseFeedbackState={fbState}
				/>,
			);
		});
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing when Featurebase state is loading", () => {
		const { state: fbState } = createFeaturebaseFeedbackState("loading");
		act(() => {
			root.render(
				<FeaturebaseFeedbackButton
					selectedAgentId={"cline"}
					clineProviderSettings={authenticatedClineSettings}
					featurebaseFeedbackState={fbState}
				/>,
			);
		});
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing when Featurebase state is error", () => {
		const { state: fbState } = createFeaturebaseFeedbackState("error");
		act(() => {
			root.render(
				<FeaturebaseFeedbackButton
					selectedAgentId={"cline"}
					clineProviderSettings={authenticatedClineSettings}
					featurebaseFeedbackState={fbState}
				/>,
			);
		});
		expect(container.innerHTML).toBe("");
	});

	it("renders enabled Share Feedback when fully authenticated and Featurebase is ready", () => {
		const { state: fbState } = createFeaturebaseFeedbackState("ready");
		act(() => {
			root.render(
				<FeaturebaseFeedbackButton
					selectedAgentId={"cline"}
					clineProviderSettings={authenticatedClineSettings}
					featurebaseFeedbackState={fbState}
				/>,
			);
		});
		const button = getFeedbackButton();
		expect(button).toBeTruthy();
		expect(button?.disabled).toBe(false);
		expect(button?.textContent).toContain("Share Feedback");
	});

	it("renders data-featurebase-feedback attribute on the Share Feedback button", () => {
		const { state: fbState } = createFeaturebaseFeedbackState("ready");
		act(() => {
			root.render(
				<FeaturebaseFeedbackButton
					selectedAgentId={"cline"}
					clineProviderSettings={authenticatedClineSettings}
					featurebaseFeedbackState={fbState}
				/>,
			);
		});
		const button = getFeedbackButton();
		expect(button).toBeTruthy();
		expect(button?.hasAttribute("data-featurebase-feedback")).toBe(true);
	});

	it("forwards click events and opens feedback when visible", () => {
		const { state: fbState, openFeedback } = createFeaturebaseFeedbackState("ready");
		const handleClick = vi.fn();
		act(() => {
			root.render(
				<FeaturebaseFeedbackButton
					selectedAgentId={"cline"}
					clineProviderSettings={authenticatedClineSettings}
					featurebaseFeedbackState={fbState}
					onClick={handleClick}
				/>,
			);
		});
		const button = getFeedbackButton();
		expect(button).toBeTruthy();
		act(() => {
			button?.click();
		});
		expect(handleClick).toHaveBeenCalledTimes(1);
		expect(openFeedback).toHaveBeenCalledTimes(1);
	});

	it("opens feedback before forwarding the click handler", () => {
		const { state: fbState, openFeedback } = createFeaturebaseFeedbackState("ready");
		const callOrder: string[] = [];
		openFeedback.mockImplementation(() => {
			callOrder.push("open");
		});
		const handleClick = vi.fn(() => {
			callOrder.push("close");
		});

		act(() => {
			root.render(
				<FeaturebaseFeedbackButton
					selectedAgentId={"cline"}
					clineProviderSettings={authenticatedClineSettings}
					featurebaseFeedbackState={fbState}
					onClick={handleClick}
				/>,
			);
		});

		const button = getFeedbackButton();
		expect(button).toBeTruthy();

		act(() => {
			button?.click();
		});

		expect(handleClick).toHaveBeenCalledTimes(1);
		expect(openFeedback).toHaveBeenCalledTimes(1);
		expect(callOrder).toEqual(["open", "close"]);
	});

	it("renders nothing when featurebaseFeedbackState is undefined", () => {
		act(() => {
			root.render(
				<FeaturebaseFeedbackButton selectedAgentId={"cline"} clineProviderSettings={authenticatedClineSettings} />,
			);
		});
		expect(container.innerHTML).toBe("");
	});
});
