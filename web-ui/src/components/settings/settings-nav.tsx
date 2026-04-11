import { Bot, GitCommit, Play, Plug, Search, SlidersHorizontal } from "lucide-react";
import { type ReactElement, type ReactNode, useMemo, useState } from "react";

import { cn } from "@/components/ui/cn";

export type SettingsNavSection = "general" | "agent" | "mcp" | "git-prompts" | "shortcuts";

interface NavItem {
	id: SettingsNavSection;
	label: string;
	icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
	{ id: "general", label: "General", icon: <SlidersHorizontal size={16} /> },
	{ id: "agent", label: "Agent", icon: <Bot size={16} /> },
	{ id: "mcp", label: "MCP Servers", icon: <Plug size={16} /> },
	{ id: "git-prompts", label: "Git Prompts", icon: <GitCommit size={16} /> },
	{ id: "shortcuts", label: "Shortcuts", icon: <Play size={16} /> },
];

export function SettingsNav({
	activeSection,
	onSectionChange,
	showMcp,
}: {
	activeSection: SettingsNavSection;
	onSectionChange: (section: SettingsNavSection) => void;
	showMcp: boolean;
}): ReactElement {
	const [query, setQuery] = useState("");
	const visibleItems = useMemo(() => {
		const base = showMcp ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.id !== "mcp");
		const trimmed = query.trim().toLowerCase();
		if (trimmed.length === 0) {
			return base;
		}
		return base.filter((item) => item.label.toLowerCase().includes(trimmed));
	}, [showMcp, query]);

	return (
		<nav className="flex flex-col gap-0.5 p-3">
			<div className="relative mb-2">
				<Search
					size={14}
					className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
				/>
				<input
					className="h-7 w-full rounded-md border border-border bg-surface-2 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					placeholder="Search settings..."
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
			</div>
			{visibleItems.length === 0 ? (
				<p className="px-3 py-1.5 text-[12px] text-text-tertiary">No matching sections</p>
			) : null}
			{visibleItems.map((item) => (
				<button
					key={item.id}
					type="button"
					onClick={() => onSectionChange(item.id)}
					className={cn(
						"flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors cursor-pointer text-left",
						activeSection === item.id
							? "bg-surface-3 text-text-primary"
							: "text-text-secondary hover:text-text-primary hover:bg-surface-2",
					)}
				>
					<span className="shrink-0 opacity-80">{item.icon}</span>
					<span>{item.label}</span>
				</button>
			))}
		</nav>
	);
}
