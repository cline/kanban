import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CreditLimitBanner } from "@/components/credit-limit-banner";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

function createSession(
	taskId: string,
	notificationType: string | null = null,
): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "awaiting_review",
		mode: "act",
		agentId: "cline",
		workspacePath: "/tmp",
		pid: null,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: "error",
		exitCode: null,
		lastHookAt: Date.now(),
		latestHookActivity: notificationType
			? {
					activityText: "Agent error",
					toolName: null,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: "agent_error",
					notificationType,
					source: "cline-sdk",
				}
			: null,
		warningMessage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
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

	it("does not render when no sessions have credit_limit", () => {
		act(() => {
			root.render(
				<CreditLimitBanner taskSessions={{ "task-1": createSession("task-1") }} />,
			);
		});
		expect(container.querySelector("[role=status]")).toBeNull();
	});

	it("renders when a session has credit_limit notificationType", () => {
		act(() => {
			root.render(
				<CreditLimitBanner
					taskSessions={{ "task-1": createSession("task-1", "credit_limit") }}
				/>,
			);
		});
		expect(container.querySelector("[role=status]")).not.toBeNull();
		expect(container.textContent).toContain("Out of Cline credits");
	});

	it("does not render when credit_limit session is running (recovered)", () => {
		const session = createSession("task-1", "credit_limit");
		session.state = "running";
		act(() => {
			root.render(<CreditLimitBanner taskSessions={{ "task-1": session }} />);
		});
		expect(container.querySelector("[role=status]")).toBeNull();
	});

	it("hides after dismiss but reappears on a new credit-limit incident", () => {
		const sessions = { "task-1": createSession("task-1", "credit_limit") };
		act(() => {
			root.render(<CreditLimitBanner taskSessions={sessions} />);
		});
		expect(container.querySelector("[role=status]")).not.toBeNull();

		const dismissButton = container.querySelector("button[aria-label=Dismiss]");
		expect(dismissButton).not.toBeNull();
		act(() => {
			dismissButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(container.querySelector("[role=status]")).toBeNull();

		act(() => {
			root.render(<CreditLimitBanner taskSessions={{ "task-1": createSession("task-1") }} />);
		});
		expect(container.querySelector("[role=status]")).toBeNull();

		act(() => {
			root.render(
				<CreditLimitBanner
					taskSessions={{ "task-2": createSession("task-2", "credit_limit") }}
				/>,
			);
		});
		expect(container.querySelector("[role=status]")).not.toBeNull();
		expect(container.textContent).toContain("Out of Cline credits");
	});
});
