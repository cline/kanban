import type { RuntimeAgentId } from "../core/api-contract";

const CODEX_WORKSPACE_TRUST_TOKENS = ["do", "you", "trust", "the", "contents", "of", "this", "directory"];

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

export function hasCodexWorkspaceTrustPrompt(text: string): boolean {
	const rawNormalized = normalizeTerminalText(text);
	if (hasOrderedTokens(rawNormalized, CODEX_WORKSPACE_TRUST_TOKENS)) {
		return true;
	}
	const strippedNormalized = normalizeTerminalText(stripAnsiAndControl(text));
	return hasOrderedTokens(strippedNormalized, CODEX_WORKSPACE_TRUST_TOKENS);
}

function hasOrderedTokens(input: string, tokens: readonly string[]): boolean {
	let index = 0;
	for (const token of tokens) {
		const found = input.indexOf(token, index);
		if (found === -1) {
			return false;
		}
		index = found + token.length;
	}
	return true;
}

export function shouldAutoConfirmCodexWorkspaceTrust(agentId: RuntimeAgentId, cwd: string): boolean {
	void cwd;
	return agentId === "codex";
}
