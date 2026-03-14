import type { LucideIcon } from "lucide-react";
import { Bug, Code, Download, Play, Plus, Rocket, Settings, Terminal, Upload, Wrench } from "lucide-react";

const SHORTCUT_ICON_DEFINITIONS = {
	play: { label: "Play", component: Play },
	console: { label: "Terminal", component: Terminal },
	bug: { label: "Debug", component: Bug },
	download: { label: "Download", component: Download },
	upload: { label: "Upload", component: Upload },
	build: { label: "Build", component: Wrench },
	code: { label: "Code", component: Code },
	rocket: { label: "Deploy", component: Rocket },
	settings: { label: "Settings", component: Settings },
	plus: { label: "Plus", component: Plus },
} as const;

const SHORTCUT_ICON_ALIASES: Record<string, RuntimeShortcutIconId> = {
	terminal: "console",
	cog: "settings",
};

const DEFAULT_SHORTCUT_ICON_ID: RuntimeShortcutIconId = "console";

const SHORTCUT_PICKER_ICON_IDS = [
	"play",
	"console",
	"bug",
	"download",
	"upload",
	"build",
	"code",
	"rocket",
] as const;

export type RuntimeShortcutIconId = keyof typeof SHORTCUT_ICON_DEFINITIONS;
export type RuntimeShortcutPickerIconId = (typeof SHORTCUT_PICKER_ICON_IDS)[number];
export interface RuntimeShortcutIconOption {
	value: RuntimeShortcutPickerIconId;
	label: string;
}

export const RUNTIME_SHORTCUT_ICON_OPTIONS: readonly RuntimeShortcutIconOption[] =
	SHORTCUT_PICKER_ICON_IDS.map((iconId) => ({
		value: iconId,
		label: SHORTCUT_ICON_DEFINITIONS[iconId].label,
	}));

const DEFAULT_SHORTCUT_PICKER_ICON_OPTION: RuntimeShortcutIconOption =
	RUNTIME_SHORTCUT_ICON_OPTIONS.find((entry) => entry.value === DEFAULT_SHORTCUT_ICON_ID) ?? {
		value: "console",
		label: "Terminal",
	};

function resolveShortcutIconId(icon: string | undefined): RuntimeShortcutIconId {
	const normalized = icon?.trim().toLowerCase();
	if (!normalized) {
		return DEFAULT_SHORTCUT_ICON_ID;
	}
	if (normalized in SHORTCUT_ICON_DEFINITIONS) {
		return normalized as RuntimeShortcutIconId;
	}
	return SHORTCUT_ICON_ALIASES[normalized] ?? DEFAULT_SHORTCUT_ICON_ID;
}

export function getRuntimeShortcutIconComponent(icon: string | undefined): LucideIcon {
	return SHORTCUT_ICON_DEFINITIONS[resolveShortcutIconId(icon)].component;
}

export function getRuntimeShortcutPickerOption(icon: string | undefined): RuntimeShortcutIconOption {
	const resolved = resolveShortcutIconId(icon);
	if (resolved === "settings" || resolved === "plus") {
		return DEFAULT_SHORTCUT_PICKER_ICON_OPTION;
	}
	const option = RUNTIME_SHORTCUT_ICON_OPTIONS.find((entry) => entry.value === resolved);
	return option ?? DEFAULT_SHORTCUT_PICKER_ICON_OPTION;
}
