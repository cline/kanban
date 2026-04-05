import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FileTypeIcon } from "@/components/code-browser/file-icons";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface FileSearchResult {
	path: string;
	name: string;
}

export interface FileSearchDialogProps {
	isOpen: boolean;
	onClose: () => void;
	workspaceId: string | null;
	onSelectFile: (path: string) => void;
}

export function FileSearchDialog({
	isOpen,
	onClose,
	workspaceId,
	onSelectFile,
}: FileSearchDialogProps): React.ReactElement | null {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<FileSearchResult[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isSearching, setIsSearching] = useState(false);
	const searchTimerRef = useRef<number | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!isOpen) {
			setQuery("");
			setResults([]);
			setSelectedIndex(0);
			return;
		}

		window.setTimeout(() => {
			inputRef.current?.focus();
		}, 50);
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen || !workspaceId) {
			return;
		}

		if (searchTimerRef.current !== null) {
			window.clearTimeout(searchTimerRef.current);
		}

		searchTimerRef.current = window.setTimeout(async () => {
			setIsSearching(true);
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.workspace.searchFiles.query({
					query,
					limit: 50,
				});
				setResults(
					response.files.map((file) => ({
						path: file.path,
						name: file.name,
					})),
				);
				setSelectedIndex(0);
			} catch {
				setResults([]);
			} finally {
				setIsSearching(false);
			}
		}, 120);

		return () => {
			if (searchTimerRef.current !== null) {
				window.clearTimeout(searchTimerRef.current);
			}
		};
	}, [isOpen, query, workspaceId]);

	const handleConfirm = useCallback(() => {
		const selectedFile = results[selectedIndex];
		if (!selectedFile) {
			return;
		}
		onSelectFile(selectedFile.path);
		onClose();
	}, [onClose, onSelectFile, results, selectedIndex]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelectedIndex((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelectedIndex((current) => Math.max(current - 1, 0));
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				handleConfirm();
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		},
		[handleConfirm, onClose, results.length],
	);

	if (!isOpen) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
			<div
				className="w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-lg border border-border bg-surface-2 shadow-2xl"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex items-center gap-2 border-b border-border px-3">
					<Search size={14} className="shrink-0 text-text-tertiary" />
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Search files by name"
						className="h-11 flex-1 border-0 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
					/>
				</div>
				<div className="max-h-[360px] overflow-y-auto">
					{results.length > 0 ? (
						results.map((result, index) => (
							<button
								key={result.path}
								type="button"
								className={[
									"flex w-full cursor-pointer flex-col px-3 py-1.5 text-left",
									index === selectedIndex ? "bg-accent/15" : "hover:bg-surface-3",
								].join(" ")}
								onClick={() => {
									onSelectFile(result.path);
									onClose();
								}}
							>
								<span className="flex items-center gap-1.5 text-sm text-text-primary">
									<FileTypeIcon name={result.name} size={14} />
									{result.name}
								</span>
								<span className="ml-5 truncate font-mono text-[11px] text-text-tertiary">{result.path}</span>
							</button>
						))
					) : query && !isSearching ? (
						<div className="p-4 text-center text-sm text-text-tertiary">No files found</div>
					) : !query ? (
						<div className="p-4 text-center text-sm text-text-tertiary">Type to search</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
