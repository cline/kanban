import { Folder, GitBranch } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/components/ui/cn";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeDirectoryListEntry, RuntimeDirectoryListResponse } from "@/runtime/types";
import { useDebouncedEffect } from "@/utils/react-use";
import { toUiRelative } from "@/utils/server-path";

export interface DirectoryAutocompleteProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	id?: string;
	ariaLabel?: string;
	workspaceId: string | null;
	inputRef?: React.RefObject<HTMLInputElement>;
}

export function DirectoryAutocomplete({
	value,
	onChange,
	placeholder,
	disabled = false,
	id,
	ariaLabel,
	workspaceId,
	inputRef: externalInputRef,
}: DirectoryAutocompleteProps): ReactElement {
	const [suggestions, setSuggestions] = useState<RuntimeDirectoryListEntry[]>([]);
	const [isOpen, setIsOpen] = useState(false);
	const [highlightedIndex, setHighlightedIndex] = useState(-1);
	const [debouncedValue, setDebouncedValue] = useState(value);
	const containerRef = useRef<HTMLDivElement>(null);
	const internalInputRef = useRef<HTMLInputElement>(null);
	const inputRefToUse = externalInputRef ?? internalInputRef;
	const fetchIdRef = useRef(0);
	const [serverRootPath, setServerRootPath] = useState<string | null>(null);
	// Track whether the user has explicitly interacted (clicked/typed) so we
	// don't pop open the dropdown on the initial programmatic auto-focus.
	const userInteractedRef = useRef(false);

	// The displayed value after the fixed "/" prefix.
	// Strip leading slashes (or backslashes from Windows paths) since the
	// "/" prefix is shown separately.
	const displayValue = value.replace(/^[\\/]+/, "");

	const handleInputChange = useCallback(
		(rawInput: string) => {
			userInteractedRef.current = true;
			// Ensure the stored value always has a leading "/"
			const cleaned = rawInput.replace(/^\/+/, "");
			onChange(`/${cleaned}`);
		},
		[onChange],
	);

	// Debounce the input value before fetching suggestions
	useDebouncedEffect(
		() => {
			setDebouncedValue(value);
		},
		250,
		[value],
	);

	// Fetch directory suggestions when debounced value changes.
	// The value always starts with "/" (server root). We strip it and
	// treat the rest as relative to the server root.
	useEffect(() => {
		if (disabled) {
			setSuggestions([]);
			setIsOpen(false);
			return;
		}

		// Strip leading "/" — the API resolves relative paths against serverCwd.
		const relativePath = debouncedValue.trim().replace(/^[\\/]+/, "");

		const endsWithSep = relativePath === "" || /[\\/]$/.test(debouncedValue.trim());
		const lastSepIndex = Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\"));
		const parentDir = endsWithSep ? relativePath : relativePath.slice(0, lastSepIndex + 1);
		const namePrefix = endsWithSep ? "" : relativePath.slice(lastSepIndex + 1).toLowerCase();

		const fetchId = ++fetchIdRef.current;

		const fetchSuggestions = async () => {
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const response: RuntimeDirectoryListResponse = await trpcClient.projects.listDirectoryContents.query(
					parentDir ? { path: parentDir } : {},
				);
				if (fetchId !== fetchIdRef.current) {
					return;
				}
				if (response.ok) {
					// Remember the server root for path display
					if (response.rootPath) {
						setServerRootPath(response.rootPath);
					}
					const filtered = namePrefix
						? response.entries.filter((e) => e.name.toLowerCase().startsWith(namePrefix))
						: response.entries;
					if (filtered.length > 0) {
						setSuggestions(filtered);
						// Only open if the user has explicitly interacted
						if (userInteractedRef.current) {
							setIsOpen(true);
						}
						setHighlightedIndex(-1);
					} else {
						setSuggestions([]);
						setIsOpen(false);
					}
				} else {
					setSuggestions([]);
					setIsOpen(false);
				}
			} catch {
				if (fetchId !== fetchIdRef.current) {
					return;
				}
				setSuggestions([]);
				setIsOpen(false);
			}
		};

		void fetchSuggestions();
	}, [debouncedValue, disabled, workspaceId]);

	// Close dropdown on outside click
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const selectSuggestion = useCallback(
		(entry: RuntimeDirectoryListEntry) => {
			// Convert the absolute entry path to a relative path from the server root,
			// then prefix with "/" (our visual root indicator) and append trailing "/"
			// so the next debounce immediately lists the selected directory's contents.
			const relativePath = serverRootPath ? toUiRelative(serverRootPath, entry.path) : entry.path;
			const pathWithSlash = relativePath.endsWith("/") ? relativePath : `${relativePath}/`;
			onChange(`/${pathWithSlash}`);
			setIsOpen(false);
			setHighlightedIndex(-1);
			inputRefToUse.current?.focus();
		},
		[onChange, inputRefToUse, serverRootPath],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Escape") {
				// Always intercept Escape so it doesn't propagate to the
				// Radix Dialog and close the modal.
				e.preventDefault();
				e.stopPropagation();
				if (isOpen) {
					setIsOpen(false);
					setHighlightedIndex(-1);
				} else {
					// Blur the input when Escape is pressed with dropdown closed
					inputRefToUse.current?.blur();
				}
				return;
			}

			if (!isOpen || suggestions.length === 0) {
				return;
			}

			if (e.key === "ArrowDown") {
				e.preventDefault();
				setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
			} else if (e.key === "Enter" && highlightedIndex >= 0) {
				e.preventDefault();
				const selected = suggestions[highlightedIndex];
				if (selected) {
					selectSuggestion(selected);
				}
			}
		},
		[isOpen, suggestions, highlightedIndex, selectSuggestion, inputRefToUse],
	);

	return (
		<div ref={containerRef} className="relative">
			{/* Fixed "/" prefix + input */}
			<div className="flex items-center h-8 rounded-md border border-border bg-surface-2 focus-within:border-accent">
				<span className="pl-2.5 text-[13px] font-mono text-text-tertiary select-none shrink-0">/</span>
				<input
					ref={inputRefToUse}
					type="text"
					value={displayValue}
					onChange={(e) => handleInputChange(e.target.value)}
					onKeyDown={handleKeyDown}
					onFocus={() => {
						// Show suggestions on re-focus if user has previously interacted
						if (userInteractedRef.current && suggestions.length > 0) {
							setIsOpen(true);
						}
					}}
					onMouseDown={() => {
						// Mark that the user explicitly clicked the input.
						// Using mousedown (not click) so that label-initiated
						// synthetic clicks don't trigger the dropdown.
						userInteractedRef.current = true;
					}}
					placeholder={placeholder}
					className="flex-1 min-w-0 h-full px-0.5 pr-2.5 text-[13px] font-mono bg-transparent text-text-primary placeholder:text-text-tertiary focus:outline-none border-none"
					disabled={disabled}
					id={id}
					aria-label={ariaLabel}
					autoComplete="off"
					role="combobox"
					aria-expanded={isOpen}
					aria-autocomplete="list"
					aria-controls={isOpen ? `${id}-listbox` : undefined}
					aria-activedescendant={highlightedIndex >= 0 ? `${id}-option-${highlightedIndex}` : undefined}
				/>
			</div>
			{isOpen && suggestions.length > 0 ? (
				<div
					id={`${id}-listbox`}
					role="listbox"
					className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-surface-1 shadow-lg"
				>
					{suggestions.map((entry, index) => (
						<div
							key={entry.path}
							id={`${id}-option-${index}`}
							role="option"
							aria-selected={index === highlightedIndex}
							className={cn(
								"flex items-center gap-2 px-3 py-1.5 text-[13px] text-text-primary cursor-pointer",
								index === highlightedIndex ? "bg-surface-3" : "hover:bg-surface-2",
							)}
							onMouseDown={(e) => {
								// Use mousedown instead of click to fire before blur
								e.preventDefault();
								selectSuggestion(entry);
							}}
							onMouseEnter={() => setHighlightedIndex(index)}
						>
							{entry.isGitRepository ? (
								<span className="flex items-center shrink-0 text-text-secondary" title="Git repository">
									<Folder size={14} className="text-text-secondary" />
									<GitBranch size={9} className="text-accent -ml-1.5 mb-1.5" />
								</span>
							) : (
								<Folder size={14} className="text-text-secondary shrink-0" />
							)}
							<span className="truncate font-mono">{entry.name}</span>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
