export type ClineComposerCompletionKind = "mention" | "slash";

export interface ActiveClineComposerToken {
	kind: ClineComposerCompletionKind;
	start: number;
	end: number;
	query: string;
}

export interface ClineComposerCompletionSuggestion {
	id: string;
	kind: ClineComposerCompletionKind;
	label: string;
	detail?: string;
	insertText: string;
}

function isTokenBoundaryCharacter(value: string | undefined): boolean {
	return !value || /\s/.test(value);
}

export function detectActiveClineComposerToken(value: string, cursorIndex: number): ActiveClineComposerToken | null {
	if (cursorIndex < 0 || cursorIndex > value.length) {
		return null;
	}
	const head = value.slice(0, cursorIndex);
	let tokenStart = head.length;
	while (tokenStart > 0) {
		const previousCharacter = head[tokenStart - 1];
		if (previousCharacter && /\s/.test(previousCharacter)) {
			break;
		}
		tokenStart -= 1;
	}

	const token = head.slice(tokenStart);
	if (token.startsWith("@")) {
		const markerIndex = tokenStart;
		if (!isTokenBoundaryCharacter(value[markerIndex - 1])) {
			return null;
		}
		if (!/^[^\s@]*$/.test(token.slice(1))) {
			return null;
		}
		return {
			kind: "mention",
			start: tokenStart,
			end: cursorIndex,
			query: token.slice(1),
		};
	}

	if (token.startsWith("/")) {
		const markerIndex = tokenStart;
		if (!isTokenBoundaryCharacter(value[markerIndex - 1])) {
			return null;
		}
		if (!/^[^\s/]*$/.test(token.slice(1))) {
			return null;
		}
		return {
			kind: "slash",
			start: tokenStart,
			end: cursorIndex,
			query: token.slice(1),
		};
	}

	return null;
}

export function buildMentionInsertText(filePath: string): string {
	const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
	return normalizedPath.includes(" ") ? `@"${normalizedPath}"` : `@${normalizedPath}`;
}

export function buildSlashCommandInsertText(commandName: string): string {
	return `/${commandName}`;
}

export function applyClineComposerCompletion(
	value: string,
	token: ActiveClineComposerToken,
	replacement: string,
): { value: string; cursor: number } {
	const before = value.slice(0, token.start);
	const after = value.slice(token.end);
	const spacer = after.length === 0 || !/^\s/.test(after) ? " " : "";
	const nextValue = `${before}${replacement}${spacer}${after}`;
	return {
		value: nextValue,
		cursor: before.length + replacement.length + spacer.length,
	};
}
