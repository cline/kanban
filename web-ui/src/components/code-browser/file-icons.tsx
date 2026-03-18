interface FileIconConfig {
	label: string;
	color: string;
}

const EXT_ICONS: Record<string, FileIconConfig> = {
	ts: { label: "TS", color: "#3178c6" },
	tsx: { label: "TX", color: "#3178c6" },
	mts: { label: "TS", color: "#3178c6" },
	js: { label: "JS", color: "#f0db4f" },
	jsx: { label: "JX", color: "#f0db4f" },
	mjs: { label: "JS", color: "#f0db4f" },
	cjs: { label: "JS", color: "#f0db4f" },
	json: { label: "{ }", color: "#a8b1ff" },
	jsonc: { label: "{ }", color: "#a8b1ff" },
	md: { label: "M↓", color: "#519aba" },
	mdx: { label: "MX", color: "#519aba" },
	css: { label: "#", color: "#563d7c" },
	scss: { label: "S", color: "#cd6799" },
	html: { label: "<>", color: "#e34c26" },
	svg: { label: "◇", color: "#ffb13b" },
	yaml: { label: "Y", color: "#cb171e" },
	yml: { label: "Y", color: "#cb171e" },
	toml: { label: "T", color: "#9c4121" },
	py: { label: "Py", color: "#3776ab" },
	rb: { label: "Rb", color: "#cc342d" },
	go: { label: "Go", color: "#00add8" },
	rs: { label: "Rs", color: "#dea584" },
	java: { label: "Jv", color: "#b07219" },
	c: { label: "C", color: "#555555" },
	cpp: { label: "C+", color: "#f34b7d" },
	cs: { label: "C#", color: "#178600" },
	swift: { label: "Sw", color: "#f05138" },
	sh: { label: "$_", color: "#4eaa25" },
	bash: { label: "$_", color: "#4eaa25" },
	sql: { label: "SQ", color: "#e38c00" },
	proto: { label: "PB", color: "#6a9955" },
	php: { label: "PH", color: "#4f5d95" },
	vue: { label: "V", color: "#41b883" },
	svelte: { label: "S", color: "#ff3e00" },
	dart: { label: "D", color: "#00b4ab" },
	txt: { label: "Tx", color: "#666" },
	lock: { label: "🔒", color: "#555" },
	env: { label: "🔑", color: "#ecd53f" },
};

const SPECIAL_FILE_ICONS: Record<string, FileIconConfig> = {
	"package.json": { label: "N", color: "#cb3837" },
	"tsconfig.json": { label: "TS", color: "#3178c6" },
	"vite.config.ts": { label: "⚡", color: "#bd34fe" },
	".gitignore": { label: "G", color: "#888" },
	"readme.md": { label: "i", color: "#519aba" },
	license: { label: "©", color: "#d4a843" },
};

function getFileIconConfig(name: string): FileIconConfig {
	const lower = name.toLowerCase();
	const special = SPECIAL_FILE_ICONS[lower];
	if (special) return special;
	const dotIndex = lower.lastIndexOf(".");
	if (dotIndex === -1) return { label: "·", color: "#555" };
	const ext = lower.slice(dotIndex + 1);
	return EXT_ICONS[ext] ?? { label: ext.slice(0, 2).toUpperCase(), color: "#555" };
}

export function FileTypeIcon({
	name,
	size = 16,
	style,
}: {
	name: string;
	size?: number;
	style?: React.CSSProperties;
}): React.ReactElement {
	const config = getFileIconConfig(name);
	const fontSize = config.label.length > 2 ? size * 0.52 : size * 0.62;
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: size,
				height: size,
				fontSize,
				fontWeight: 700,
				fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
				color: config.color,
				lineHeight: 1,
				flexShrink: 0,
				letterSpacing: "-0.02em",
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