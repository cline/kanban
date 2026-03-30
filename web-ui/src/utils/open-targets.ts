import cursorIcon from "@/assets/open-targets/cursor.svg";
import finderIcon from "@/assets/open-targets/finder.svg";
import ghosttyIcon from "@/assets/open-targets/ghostty.svg";
import intellijIdeaIcon from "@/assets/open-targets/intellijidea.svg";
import iterm2Icon from "@/assets/open-targets/iterm2.svg";
import terminalIcon from "@/assets/open-targets/terminal.svg";
import vscodeIcon from "@/assets/open-targets/vscode.svg";
import warpIcon from "@/assets/open-targets/warp.svg";
import windsurfIcon from "@/assets/open-targets/windsurf.svg";
import xcodeIcon from "@/assets/open-targets/xcode.svg";
import zedIcon from "@/assets/open-targets/zed.svg";
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export const PREFERRED_OPEN_TARGET_STORAGE_KEY = LocalStorageKey.PreferredOpenTarget;

export type OpenTargetPlatform = "mac" | "windows" | "linux" | "other";

export type OpenTargetId =
	| "vscode"
	| "vscode-insiders"
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
		id: "vscode-insiders",
		label: "VS Code Insiders",
		iconSrc: vscodeIcon,
	},
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

const OPEN_TARGET_IDS_BY_PLATFORM: Record<OpenTargetPlatform, readonly OpenTargetId[]> = {
	mac: [
		"vscode",
		"cursor",
		"windsurf",
		"finder",
		"terminal",
		"iterm2",
		"ghostty",
		"warp",
		"xcode",
		"intellijidea",
		"vscode-insiders",
		"zed",
	],
	windows: ["vscode", "cursor", "windsurf", "finder", "vscode-insiders", "zed"],
	linux: ["vscode", "cursor", "windsurf", "finder", "vscode-insiders", "zed"],
	other: ["vscode", "vscode-insiders", "finder"],
};

const openTargetById = new Map<OpenTargetId, OpenTargetOption>(
	OPEN_TARGET_OPTIONS.map((option) => [option.id, option]),
);

export function resolveOpenTargetPlatform(): OpenTargetPlatform {
	if (typeof navigator === "undefined") {
		return "other";
	}
	const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
	if (source.includes("mac") || source.includes("darwin")) {
		return "mac";
	}
	if (source.includes("win")) {
		return "windows";
	}
	if (source.includes("linux") || source.includes("x11")) {
		return "linux";
	}
	return "other";
}

function getDefaultOpenTargetId(platform: OpenTargetPlatform): OpenTargetId {
	const firstId = OPEN_TARGET_IDS_BY_PLATFORM[platform][0];
	return firstId ?? DEFAULT_OPEN_TARGET.id;
}

function getOpenTargetLabel(targetId: OpenTargetId, platform: OpenTargetPlatform): string {
	if (targetId === "finder") {
		if (platform === "windows") {
			return "File Explorer";
		}
		if (platform === "linux" || platform === "other") {
			return "File Manager";
		}
	}
	const option = openTargetById.get(targetId);
	return option?.label ?? DEFAULT_OPEN_TARGET.label;
}

function isOpenTargetSupported(targetId: OpenTargetId, platform: OpenTargetPlatform): boolean {
	return OPEN_TARGET_IDS_BY_PLATFORM[platform].includes(targetId);
}

function isOpenTargetId(value: string | null): value is OpenTargetId {
	if (!value) {
		return false;
	}
	return openTargetById.has(value as OpenTargetId);
}

export function normalizeOpenTargetId(value: string | null): OpenTargetId | null {
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

function quoteWindowsShellArgument(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function buildOpenAppCommand(path: string, ...appNames: string[]): string {
	const quotedPath = quoteShellArgument(path);
	if (appNames.length === 0) {
		return `open ${quotedPath}`;
	}
	const openAttempts = appNames.map((appName) => `open -a ${quoteShellArgument(appName)} ${quotedPath}`);
	if (openAttempts.length === 1) {
		const command = openAttempts[0];
		return command ?? `open ${quotedPath}`;
	}
	return `(${openAttempts.join(" || ")})`;
}

function buildOpenLinuxCommand(targetId: OpenTargetId, path: string): string {
	const quotedPath = quoteShellArgument(path);
	if (targetId === "finder") {
		return `xdg-open ${quotedPath}`;
	}
	if (targetId === "vscode") {
		return `code ${quotedPath}`;
	}
	if (targetId === "vscode-insiders") {
		return `code-insiders ${quotedPath}`;
	}
	if (targetId === "cursor") {
		return `cursor ${quotedPath}`;
	}
	if (targetId === "windsurf") {
		return `windsurf ${quotedPath}`;
	}
	if (targetId === "zed") {
		return `zed ${quotedPath}`;
	}
	return `xdg-open ${quotedPath}`;
}

function buildOpenWindowsCommand(targetId: OpenTargetId, path: string): string {
	const quotedPath = quoteWindowsShellArgument(path);
	if (targetId === "finder") {
		return `explorer ${quotedPath}`;
	}
	if (targetId === "vscode") {
		return `code ${quotedPath}`;
	}
	if (targetId === "vscode-insiders") {
		return `code-insiders ${quotedPath}`;
	}
	if (targetId === "cursor") {
		return `cursor ${quotedPath}`;
	}
	if (targetId === "windsurf") {
		return `windsurf ${quotedPath}`;
	}
	if (targetId === "zed") {
		return `zed ${quotedPath}`;
	}
	return `explorer ${quotedPath}`;
}

export function getOpenTargetOptions(platform: OpenTargetPlatform): readonly OpenTargetOption[] {
	return OPEN_TARGET_IDS_BY_PLATFORM[platform].map((targetId) => {
		const option = openTargetById.get(targetId) ?? DEFAULT_OPEN_TARGET;
		return {
			...option,
			label: getOpenTargetLabel(targetId, platform),
		};
	});
}

export function getOpenTargetOption(targetId: OpenTargetId, platform: OpenTargetPlatform): OpenTargetOption {
	const fallbackId = getDefaultOpenTargetId(platform);
	const resolvedTargetId = isOpenTargetSupported(targetId, platform) ? targetId : fallbackId;
	const option = openTargetById.get(resolvedTargetId) ?? DEFAULT_OPEN_TARGET;
	return {
		...option,
		label: getOpenTargetLabel(resolvedTargetId, platform),
	};
}

export function loadPersistedOpenTarget(platform: OpenTargetPlatform): OpenTargetId {
	const defaultTargetId = getDefaultOpenTargetId(platform);
	if (typeof window === "undefined") {
		return defaultTargetId;
	}
	const value = readLocalStorageItem(PREFERRED_OPEN_TARGET_STORAGE_KEY);
	const normalized = normalizeOpenTargetId(value);
	if (normalized && isOpenTargetSupported(normalized, platform)) {
		return normalized;
	}
	return defaultTargetId;
}

export function persistOpenTarget(targetId: OpenTargetId): void {
	writeLocalStorageItem(PREFERRED_OPEN_TARGET_STORAGE_KEY, targetId);
}

export function buildOpenCommand(targetId: OpenTargetId, path: string, platform: OpenTargetPlatform): string {
	if (!isOpenTargetSupported(targetId, platform)) {
		return buildOpenCommand(getDefaultOpenTargetId(platform), path, platform);
	}

	if (platform === "windows") {
		return buildOpenWindowsCommand(targetId, path);
	}

	if (platform === "linux" || platform === "other") {
		return buildOpenLinuxCommand(targetId, path);
	}

	if (targetId === "vscode") {
		return buildOpenAppCommand(path, "Visual Studio Code");
	}
	if (targetId === "vscode-insiders") {
		return buildOpenAppCommand(path, "Visual Studio Code - Insiders");
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
