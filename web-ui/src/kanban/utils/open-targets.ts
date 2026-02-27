import cursorIcon from "@/kanban/assets/open-targets/cursor.svg";
import finderIcon from "@/kanban/assets/open-targets/finder.svg";
import ghosttyIcon from "@/kanban/assets/open-targets/ghostty.svg";
import intellijIdeaIcon from "@/kanban/assets/open-targets/intellijidea.svg";
import iterm2Icon from "@/kanban/assets/open-targets/iterm2.svg";
import terminalIcon from "@/kanban/assets/open-targets/terminal.svg";
import vscodeIcon from "@/kanban/assets/open-targets/vscode.svg";
import warpIcon from "@/kanban/assets/open-targets/warp.svg";
import windsurfIcon from "@/kanban/assets/open-targets/windsurf.svg";
import xcodeIcon from "@/kanban/assets/open-targets/xcode.svg";
import zedIcon from "@/kanban/assets/open-targets/zed.svg";

const PREFERRED_OPEN_TARGET_STORAGE_KEY = "kanbanana.preferred-open-target";

export type OpenTargetId =
	| "vscode"
	| "cursor"
	| "windsurf"
	| "finder"
	| "terminal"
	| "iterm2"
	| "ghostty"
	| "warp"
	| "xcode"
	| "intellijidea"
	| "zed";

export interface OpenTargetOption {
	id: OpenTargetId;
	label: string;
	iconSrc: string;
}

const DEFAULT_OPEN_TARGET: OpenTargetOption = {
	id: "vscode",
	label: "VS Code",
	iconSrc: vscodeIcon,
};

const OPEN_TARGET_OPTIONS: readonly OpenTargetOption[] = [
	DEFAULT_OPEN_TARGET,
	{
		id: "cursor",
		label: "Cursor",
		iconSrc: cursorIcon,
	},
	{
		id: "windsurf",
		label: "Windsurf",
		iconSrc: windsurfIcon,
	},
	{
		id: "finder",
		label: "Finder",
		iconSrc: finderIcon,
	},
	{
		id: "terminal",
		label: "Terminal",
		iconSrc: terminalIcon,
	},
	{
		id: "iterm2",
		label: "Iterm2",
		iconSrc: iterm2Icon,
	},
	{
		id: "ghostty",
		label: "Ghostty",
		iconSrc: ghosttyIcon,
	},
	{
		id: "warp",
		label: "Warp",
		iconSrc: warpIcon,
	},
	{
		id: "xcode",
		label: "Xcode",
		iconSrc: xcodeIcon,
	},
	{
		id: "intellijidea",
		label: "Intellij Idea",
		iconSrc: intellijIdeaIcon,
	},
	{
		id: "zed",
		label: "Zed",
		iconSrc: zedIcon,
	},
];

const openTargetById = new Map<OpenTargetId, OpenTargetOption>(
	OPEN_TARGET_OPTIONS.map((option) => [option.id, option]),
);

function isOpenTargetId(value: string | null): value is OpenTargetId {
	if (!value) {
		return false;
	}
	return openTargetById.has(value as OpenTargetId);
}

function normalizeOpenTargetId(value: string | null): OpenTargetId | null {
	if (!value) {
		return null;
	}
	if (value === "ghostie") {
		return "ghostty";
	}
	if (value === "intellij_idea") {
		return "intellijidea";
	}
	if (isOpenTargetId(value)) {
		return value;
	}
	return null;
}

function quoteShellArgument(value: string): string {
	return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function buildOpenAppCommand(path: string, ...appNames: string[]): string {
	const quotedPath = quoteShellArgument(path);
	if (appNames.length === 0) {
		return `open ${quotedPath}`;
	}
	const openAttempts = appNames.map((appName) =>
		`open -a ${quoteShellArgument(appName)} ${quotedPath}`
	);
	if (openAttempts.length === 1) {
		const command = openAttempts[0];
		return command ?? `open ${quotedPath}`;
	}
	return `(${openAttempts.join(" || ")})`;
}

export function getOpenTargetOptions(): readonly OpenTargetOption[] {
	return OPEN_TARGET_OPTIONS;
}

export function getOpenTargetOption(targetId: OpenTargetId): OpenTargetOption {
	return openTargetById.get(targetId) ?? DEFAULT_OPEN_TARGET;
}

export function loadPersistedOpenTarget(): OpenTargetId {
	if (typeof window === "undefined") {
		return DEFAULT_OPEN_TARGET.id;
	}
	try {
		const value = window.localStorage.getItem(PREFERRED_OPEN_TARGET_STORAGE_KEY);
		const normalized = normalizeOpenTargetId(value);
		if (normalized) {
			return normalized;
		}
	} catch {
		// Ignore storage failures and use default.
	}
	return DEFAULT_OPEN_TARGET.id;
}

export function persistOpenTarget(targetId: OpenTargetId): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(PREFERRED_OPEN_TARGET_STORAGE_KEY, targetId);
	} catch {
		// Ignore storage failures.
	}
}

export function buildOpenCommand(targetId: OpenTargetId, path: string): string {
	if (targetId === "vscode") {
		return buildOpenAppCommand(path, "Visual Studio Code");
	}
	if (targetId === "cursor") {
		return buildOpenAppCommand(path, "Cursor");
	}
	if (targetId === "windsurf") {
		return buildOpenAppCommand(path, "Windsurf");
	}
	if (targetId === "finder") {
		return buildOpenAppCommand(path);
	}
	if (targetId === "terminal") {
		return buildOpenAppCommand(path, "Terminal");
	}
	if (targetId === "iterm2") {
		return buildOpenAppCommand(path, "iTerm", "iTerm2");
	}
	if (targetId === "ghostty") {
		return buildOpenAppCommand(path, "Ghostty", "Ghostie");
	}
	if (targetId === "warp") {
		return buildOpenAppCommand(path, "Warp");
	}
	if (targetId === "xcode") {
		return buildOpenAppCommand(path, "Xcode");
	}
	if (targetId === "intellijidea") {
		return buildOpenAppCommand(path, "IntelliJ IDEA", "IntelliJ IDEA CE");
	}
	return buildOpenAppCommand(path, "Zed");
}
