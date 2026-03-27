// Full-page community prompts library view with fuzzy search, type filtering,
// and apply/remove actions. Shown as a toggleable view (like git history).

import {
	BookOpen,
	Check,
	ChevronDown,
	ChevronRight,
	Download,
	ExternalLink,
	RefreshCw,
	Search,
	Tag,
	Trash2,
	User,
} from "lucide-react";
import { useCallback, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import type { PromptTypeFilter, UsePromptsLibraryResult } from "@/hooks/use-prompts-library";
import type { RuntimePromptItem } from "@/runtime/types";

// ---------------------------------------------------------------------------
// Prompt Card
// ---------------------------------------------------------------------------

function PromptCard({
	prompt,
	isApplied,
	isExpanded,
	isApplyingOrRemoving,
	onToggleExpand,
	onApply,
	onRemove,
}: {
	prompt: RuntimePromptItem;
	isApplied: boolean;
	isExpanded: boolean;
	isApplyingOrRemoving: boolean;
	onToggleExpand: () => void;
	onApply: () => void;
	onRemove: () => void;
}): React.ReactElement {
	return (
		<div
			className={cn(
				"rounded-lg border bg-surface-2 transition-colors",
				isApplied ? "border-accent/40" : "border-border",
			)}
		>
			<button
				type="button"
				className="flex w-full items-start gap-3 p-3 text-left hover:bg-surface-3/50 transition-colors rounded-t-lg"
				onClick={onToggleExpand}
			>
				<div className="mt-0.5 shrink-0 text-text-tertiary">
					{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 mb-1">
						<span className="text-sm font-medium text-text-primary truncate">{prompt.name}</span>
						<span
							className={cn(
								"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
								prompt.type === "rule"
									? "bg-status-blue/15 text-status-blue"
									: "bg-status-purple/15 text-status-purple",
							)}
						>
							{prompt.type}
						</span>
						{isApplied ? (
							<span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-status-green/15 text-status-green">
								Applied
							</span>
						) : null}
					</div>
					<p className="text-xs text-text-secondary line-clamp-2">{prompt.description}</p>
					<div className="flex items-center gap-3 mt-1.5 text-[11px] text-text-tertiary">
						<span className="inline-flex items-center gap-1">
							<User size={10} />
							{prompt.author}
						</span>
						{prompt.category !== "General" ? (
							<span className="inline-flex items-center gap-1">
								<BookOpen size={10} />
								{prompt.category}
							</span>
						) : null}
						{prompt.tags.length > 0 ? (
							<span className="inline-flex items-center gap-1">
								<Tag size={10} />
								{prompt.tags.slice(0, 3).join(", ")}
							</span>
						) : null}
					</div>
				</div>
				<div className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
					<Tooltip content="View on GitHub" side="bottom">
						<a
							href={prompt.githubUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center justify-center rounded p-1 text-text-tertiary hover:text-text-primary hover:bg-surface-3 transition-colors"
							onClick={(e) => e.stopPropagation()}
						>
							<ExternalLink size={14} />
						</a>
					</Tooltip>
					{isApplied ? (
						<Button
							variant="danger"
							size="sm"
							icon={<Trash2 size={12} />}
							disabled={isApplyingOrRemoving}
							onClick={(e) => {
								e.stopPropagation();
								onRemove();
							}}
						>
							Remove
						</Button>
					) : (
						<Button
							variant="default"
							size="sm"
							icon={<Download size={12} />}
							disabled={isApplyingOrRemoving}
							onClick={(e) => {
								e.stopPropagation();
								onApply();
							}}
						>
							Apply
						</Button>
					)}
				</div>
			</button>
			{isExpanded ? (
				<div className="border-t border-border px-4 py-3">
					<pre className="max-h-[300px] overflow-auto rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">
						{prompt.content}
					</pre>
				</div>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Type Filter Tabs
// ---------------------------------------------------------------------------

const TYPE_FILTER_OPTIONS: { value: PromptTypeFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "rule", label: "Rules" },
	{ value: "workflow", label: "Workflows" },
];

function TypeFilterTabs({
	value,
	onChange,
}: {
	value: PromptTypeFilter;
	onChange: (filter: PromptTypeFilter) => void;
}): React.ReactElement {
	return (
		<div className="flex gap-0.5 rounded-md border border-border bg-surface-1 p-0.5">
			{TYPE_FILTER_OPTIONS.map((option) => (
				<button
					key={option.value}
					type="button"
					className={cn(
						"rounded px-2.5 py-1 text-xs font-medium transition-colors",
						value === option.value
							? "bg-surface-3 text-text-primary"
							: "text-text-secondary hover:text-text-primary hover:bg-surface-2",
					)}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export interface PromptsLibraryViewProps {
	library: UsePromptsLibraryResult;
}

export function PromptsLibraryView({ library }: PromptsLibraryViewProps): React.ReactElement {
	const searchInputRef = useRef<HTMLInputElement>(null);

	const handleSearchChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			library.setSearchQuery(e.target.value);
		},
		[library],
	);

	const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			(e.target as HTMLInputElement).blur();
		}
	}, []);

	return (
		<div className="flex flex-col flex-1 min-h-0 bg-surface-0">
			{/* Header */}
			<div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface-1">
				<BookOpen size={16} className="text-text-secondary shrink-0" />
				<h2 className="text-sm font-semibold text-text-primary">Community Prompts</h2>
				<span className="text-xs text-text-tertiary">
					{library.catalog.length} prompt{library.catalog.length === 1 ? "" : "s"}
				</span>
				<div className="flex-1" />
				<TypeFilterTabs value={library.typeFilter} onChange={library.setTypeFilter} />
				<Tooltip content="Refresh catalog" side="bottom">
					<Button
						variant="ghost"
						size="sm"
						icon={library.isLoading ? <Spinner size={14} /> : <RefreshCw size={14} />}
						disabled={library.isLoading}
						onClick={library.refresh}
						aria-label="Refresh catalog"
					/>
				</Tooltip>
			</div>

			{/* Search */}
			<div className="px-4 py-2 border-b border-border">
				<div className="relative">
					<Search
						size={14}
						className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
					/>
					<input
						ref={searchInputRef}
						type="text"
						placeholder="Search prompts…"
						value={library.searchQuery}
						onChange={handleSearchChange}
						onKeyDown={handleSearchKeyDown}
						className="w-full rounded-md border border-border bg-surface-2 py-1.5 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
				{library.isLoading && library.catalog.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-3 py-16 text-text-tertiary">
						<Spinner size={28} />
						<p className="text-xs">Loading community prompts…</p>
					</div>
				) : library.errorMessage ? (
					<div className="flex flex-col items-center justify-center gap-3 py-16 text-text-tertiary">
						<p className="text-xs text-status-red">{library.errorMessage}</p>
						<Button variant="default" size="sm" onClick={library.refresh}>
							Retry
						</Button>
					</div>
				) : library.filteredPrompts.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-3 py-16 text-text-tertiary">
						<Search size={32} strokeWidth={1} />
						<p className="text-xs">
							{library.searchQuery.trim()
								? "No prompts match your search"
								: "No prompts available"}
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{library.filteredPrompts.map((prompt) => {
							const compositeId = `${prompt.type}:${prompt.promptId}`;
							return (
								<PromptCard
									key={compositeId}
									prompt={prompt}
									isApplied={library.appliedPromptIds.has(compositeId)}
									isExpanded={library.expandedPromptId === prompt.promptId}
									isApplyingOrRemoving={library.isApplyingOrRemoving}
									onToggleExpand={() => library.toggleExpandedPrompt(prompt.promptId)}
									onApply={() => {
										void library.applyPrompt(prompt);
									}}
									onRemove={() => {
										void library.removePrompt(prompt);
									}}
								/>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
