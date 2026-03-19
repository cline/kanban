import { join } from "node:path";

import type { RuntimeAgentId } from "../core/api-contract.js";
import { KANBAN_TASK_WORKTREES_DIR_NAME } from "../workspace/task-worktree-path.js";
import { getRuntimeHomePath } from "../state/workspace-state.js";

export const WORKSPACE_TRUST_CONFIRM_DELAY_MS = 100;

function normalizeTerminalText(input: string): string {
	return input.toLowerCase().replace(/\s+/gu, " ");
}

function stripAnsiAndControl(input: string): string {
	let output = "";
	let mode: "text" | "escape" | "csi" | "osc" | "osc_escape" = "text";
	for (const char of input) {
		if (mode === "text") {
			if (char === "\u001b") {
				mode = "escape";
				continue;
			}
			const code = char.charCodeAt(0);
			if ((code >= 32 && code !== 127) || char === "\n" || char === "\r" || char === "\t") {
				output += char;
			}
			continue;
		}
		if (mode === "escape") {
			if (char === "[") {
				mode = "csi";
				continue;
			}
			if (char === "]") {
				mode = "osc";
				continue;
			}
			mode = "text";
			continue;
		}
		if (mode === "csi") {
			const code = char.charCodeAt(0);
			if (code >= 64 && code <= 126) {
				mode = "text";
			}
			continue;
		}
		if (mode === "osc") {
			if (char === "\u0007") {
				mode = "text";
			} else if (char === "\u001b") {
				mode = "osc_escape";
			}
			continue;
		}
		if (mode === "osc_escape") {
			mode = char === "\\" ? "text" : "osc";
		}
	}
	return output;
}

export function hasClaudeWorkspaceTrustPrompt(text: string): boolean {
	const normalized = normalizeTerminalText(stripAnsiAndControl(text));
	return /yes,?\s*i\s*trust\s*this\s*folder/u.test(normalized) || /trust\s+this\s+folder/u.test(normalized);
}

function isTaskWorktreePath(path: string): boolean {
	const worktreesRoot = `${join(getRuntimeHomePath(), KANBAN_TASK_WORKTREES_DIR_NAME).replace(/\\/gu, "/").replace(/\/+$/u, "")}/`;
	const normalizedPath = `${path.replace(/\\/gu, "/").replace(/\/+$/u, "")}/`;
	if (process.platform === "win32") {
		return normalizedPath.toLowerCase().startsWith(worktreesRoot.toLowerCase());
	}
	return normalizedPath.startsWith(worktreesRoot);
}

export function shouldAutoConfirmClaudeWorkspaceTrust(agentId: RuntimeAgentId, cwd: string): boolean {
	return agentId === "claude" && isTaskWorktreePath(cwd);
}

export function stopWorkspaceTrustTimers(state: { workspaceTrustConfirmTimer: NodeJS.Timeout | null }): void {
	if (state.workspaceTrustConfirmTimer) {
		clearTimeout(state.workspaceTrustConfirmTimer);
		state.workspaceTrustConfirmTimer = null;
	}
}
