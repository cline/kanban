import type { CSSProperties, ReactElement } from "react";

interface FileIconConfig {
	label: string;
	color: string;
}

const EXTENSION_ICONS: Record<string, FileIconConfig> = {
	bash: { label: "SH", color: "#4EAA25" },
	c: { label: "C", color: "#555555" },
	cjs: { label: "JS", color: "#F0DB4F" },
	cpp: { label: "C+", color: "#F34B7D" },
	css: { label: "CSS", color: "#563D7C" },
	dart: { label: "DT", color: "#00B4AB" },
	env: { label: "ENV", color: "#ECD53F" },
	go: { label: "GO", color: "#00ADD8" },
	html: { label: "HT", color: "#E34C26" },
	java: { label: "JV", color: "#B07219" },
	js: { label: "JS", color: "#F0DB4F" },
	json: { label: "{}", color: "#A8B1FF" },
	jsonc: { label: "{}", color: "#A8B1FF" },
	jsx: { label: "JX", color: "#F0DB4F" },
	md: { label: "MD", color: "#519ABA" },
	mdx: { label: "MX", color: "#519ABA" },
	mjs: { label: "JS", color: "#F0DB4F" },
	php: { label: "PH", color: "#4F5D95" },
	proto: { label: "PB", color: "#6A9955" },
	py: { label: "PY", color: "#3776AB" },
	rb: { label: "RB", color: "#CC342D" },
	rs: { label: "RS", color: "#DEA584" },
	scss: { label: "SC", color: "#CD6799" },
	sh: { label: "SH", color: "#4EAA25" },
	sql: { label: "SQL", color: "#E38C00" },
	svelte: { label: "SV", color: "#FF3E00" },
	svg: { label: "SVG", color: "#FFB13B" },
	swift: { label: "SW", color: "#F05138" },
	toml: { label: "TM", color: "#9C4121" },
	ts: { label: "TS", color: "#3178C6" },
	tsx: { label: "TX", color: "#3178C6" },
	txt: { label: "TX", color: "#666666" },
	vue: { label: "VU", color: "#41B883" },
	yaml: { label: "YM", color: "#CB171E" },
	yml: { label: "YM", color: "#CB171E" },
};

const SPECIAL_FILE_ICONS: Record<string, FileIconConfig> = {
	".gitignore": { label: "GI", color: "#888888" },
	license: { label: "LC", color: "#D4A843" },
	"package-lock.json": { label: "NP", color: "#CB3837" },
	"package.json": { label: "NP", color: "#CB3837" },
	"readme.md": { label: "RD", color: "#519ABA" },
	"tsconfig.json": { label: "TS", color: "#3178C6" },
	"vite.config.ts": { label: "VT", color: "#BD34FE" },
};

function getFileIconConfig(name: string): FileIconConfig {
	const normalizedName = name.toLowerCase();
	const specialConfig = SPECIAL_FILE_ICONS[normalizedName];
	if (specialConfig) {
		return specialConfig;
	}

	const lastDotIndex = normalizedName.lastIndexOf(".");
	if (lastDotIndex === -1) {
		return { label: "FI", color: "#6E7681" };
	}

	const extension = normalizedName.slice(lastDotIndex + 1);
	return EXTENSION_ICONS[extension] ?? { label: extension.slice(0, 2).toUpperCase(), color: "#6E7681" };
}

export function FileTypeIcon({
	name,
	size = 16,
	style,
}: {
	name: string;
	size?: number;
	style?: CSSProperties;
}): ReactElement {
	const config = getFileIconConfig(name);
	const fontSize = config.label.length > 2 ? size * 0.48 : size * 0.62;

	return (
		<span
			aria-hidden
			style={{
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: size,
				height: size,
				flexShrink: 0,
				fontSize,
				fontWeight: 700,
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
				letterSpacing: "-0.02em",
				lineHeight: 1,
				color: config.color,
				...style,
			}}
		>
			{config.label}
		</span>
	);
}

export function isHiddenName(name: string): boolean {
	return name.startsWith(".");
}
