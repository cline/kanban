import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CreditLimitBanner } from "@/components/credit-limit-banner";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

function createSummary(taskId: string, overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "awaiting_review",
		agentId: "cline",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: "error",
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

describe("CreditLimitBanner", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("renders nothing when no tasks have credit_limit", () => {
		const sessions: Record<string, RuntimeTaskSessionSummary> = {
			"task-1": createSummary("task-1"),
			"task-2": createSummary("task-2"),
		};
		act(() => {
			root.render(<CreditLimitBanner taskSessions={sessions} />);
		});
		expect(container.querySelector("[role='status']")).toBeNull();
	});

	it("renders banner when a task has credit_limit notification", () => {
		const sessions: Record<string, RuntimeTaskSessionSummary> = {
			"task-1": createSummary("task-1", {
				latestHookActivity: {
					activityText: "Agent error: 402 Insufficient balance",
					toolName: null,
					toolInputSummary: null,
					finalMessage: "402 Insufficient balance. Your Cline Credits balance is $0.00",
					hookEventName: "agent_error",
					notificationType: "credit_limit",
					source: "cline-sdk",
				},
			}),
			"task-2": createSummary("task-2"),
		};
		act(() => {
			root.render(<CreditLimitBanner taskSessions={sessions} />);
		});
		const banner = container.querySelector("[role='status']");
		expect(banner).not.toBeNull();
		expect(banner!.textContent).toContain("Out of Cline credits");
		expect(banner!.textContent).toContain("Buy more credits");
	});

	it("contains a link to buy credits", () => {
		const sessions: Record<string, RuntimeTaskSessionSummary> = {
			"task-1": createSummary("task-1", {
				latestHookActivity: {
					activityText: "Agent error",
					toolName: null,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: "agent_error",
					notificationType: "credit_limit",
					source: "cline-sdk",
				},
			}),
		};
		act(() => {
			root.render(<CreditLimitBanner taskSessions={sessions} />);
		});
		const link = container.querySelector("a[href='https://app.cline.bot/']");
		expect(link).not.toBeNull();
		expect(link!.textContent).toBe("Buy more credits");
	});

	it("can be dismissed by clicking the dismiss button", () => {
		const sessions: Record<string, RuntimeTaskSessionSummary> = {
			"task-1": createSummary("task-1", {
				latestHookActivity: {
					activityText: "Agent error",
					toolName: null,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: "agent_error",
					notificationType: "credit_limit",
					source: "cline-sdk",
				},
			}),
		};
		act(() => {
			root.render(<CreditLimitBanner taskSessions={sessions} />);
		});
		expect(container.querySelector("[role='status']")).not.toBeNull();

		const dismissButton = container.querySelector("button[aria-label='Dismiss']") as HTMLButtonElement;
		expect(dismissButton).not.toBeNull();
		act(() => {
			dismissButton.click();
		});
		expect(container.querySelector("[role='status']")).toBeNull();
	});

	it("renders nothing when sessions are empty", () => {
		act(() => {
			root.render(<CreditLimitBanner taskSessions={{}} />);
		});
		expect(container.querySelector("[role='status']")).toBeNull();
	});
});
