import { Check, Copy, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";

export interface CardSummaryData {
	content: string;
	source: "automatic" | "manual";
	sourceUpdatedAt?: number;
	updatedAt: number;
}

interface CardSummaryPanelProps {
	summary: CardSummaryData | null;
	isSaving: boolean;
	isLoading?: boolean;
	onSave: (content: string) => Promise<void>;
	onClear: () => Promise<void>;
	onPromoteToProjectMemory?: () => Promise<void>;
}

const MAX_SUMMARY_CHARS = 2000;

export function CardSummaryPanel({
	summary,
	isSaving,
	isLoading,
	onSave,
	onClear,
	onPromoteToProjectMemory,
}: CardSummaryPanelProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [draftContent, setDraftContent] = useState(summary?.content ?? "");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!isEditing) {
			setDraftContent(summary?.content ?? "");
		}
	}, [summary?.content, isEditing]);

	const remainingChars = MAX_SUMMARY_CHARS - draftContent.length;
	const isOverLimit = remainingChars < 0;

	const handleSave = async () => {
		if (!draftContent.trim()) {
			await onClear();
			setIsEditing(false);
			return;
		}
		if (isOverLimit) {
			setError("Summary exceeds character limit");
			return;
		}
		try {
			setError(null);
			await onSave(draftContent.trim());
			setIsEditing(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save summary");
		}
	};

	const handleClear = async () => {
		try {
			setError(null);
			await onClear();
			setDraftContent("");
			setIsEditing(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to clear summary");
		}
	};

	const handlePromote = async () => {
		if (!onPromoteToProjectMemory || !draftContent.trim()) {
			return;
		}
		try {
			setError(null);
			await onPromoteToProjectMemory();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to promote to project memory");
		}
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center p-4 text-text-tertiary">
				<Spinner size={16} />
				<span className="ml-2 text-xs">Loading summary...</span>
			</div>
		);
	}

	if (!summary && !isEditing) {
		return (
			<div className="p-3 text-text-tertiary">
				<div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-secondary">
					<Sparkles size={14} />
					<span>Summary</span>
				</div>
				<p className="mb-3 text-xs">No summary yet. A summary is drafted when a task returns a final response.</p>
				<Button variant="default" size="sm" onClick={() => setIsEditing(true)} className="h-7 text-xs">
					Add Summary
				</Button>
			</div>
		);
	}

	return (
		<div className="border-t border-divider p-3">
			<div className="mb-2 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Sparkles size={14} className="text-text-secondary" />
					<span className="text-xs font-medium text-text-secondary">Summary</span>
					{summary?.source === "automatic" ? (
						<Tooltip content="Auto-generated from task completion">
							<span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-tertiary">Auto</span>
						</Tooltip>
					) : (
						<Tooltip content="Manually edited">
							<span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">Manual</span>
						</Tooltip>
					)}
				</div>
				<div className="flex items-center gap-1">
					{!isEditing && summary && (
						<>
							<Tooltip content="Edit summary">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										setDraftContent(summary.content ?? "");
										setIsEditing(true);
									}}
									className="h-6 w-6 p-0"
								>
									<Copy size={12} />
								</Button>
							</Tooltip>
							<Tooltip content="Clear summary">
								<Button variant="ghost" size="sm" onClick={handleClear} className="h-6 w-6 p-0">
									<Trash2 size={12} />
								</Button>
							</Tooltip>
						</>
					)}
					{isEditing && (
						<>
							<Tooltip content="Save">
								<Button
									variant="ghost"
									size="sm"
									onClick={handleSave}
									disabled={isSaving}
									className="h-6 w-6 p-0"
								>
									{isSaving ? <Spinner size={12} /> : <Check size={12} />}
								</Button>
							</Tooltip>
							<Tooltip content="Cancel">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										setIsEditing(false);
										setDraftContent(summary?.content ?? "");
										setError(null);
									}}
									disabled={isSaving}
									className="h-6 w-6 p-0"
								>
									<Trash2 size={12} />
								</Button>
							</Tooltip>
						</>
					)}
				</div>
			</div>

			{isEditing ? (
				<div>
					<textarea
						value={draftContent}
						onChange={(e) => {
							setDraftContent(e.target.value);
							setError(null);
						}}
						placeholder="Enter a brief summary of what was accomplished..."
						className={cn(
							"w-full resize-none rounded-md border border-border bg-surface-1 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-border-focus",
							isOverLimit && "border-status-red",
						)}
						rows={4}
						maxLength={MAX_SUMMARY_CHARS + 100}
					/>
					<div className="mt-1 flex items-center justify-between">
						<span
							className={cn(
								"text-[10px]",
								remainingChars < 100 ? "text-text-secondary" : "text-text-tertiary",
								isOverLimit && "text-status-red",
							)}
						>
							{remainingChars} chars left
						</span>
						{onPromoteToProjectMemory && draftContent.trim() && (
							<Button
								variant="ghost"
								size="sm"
								onClick={handlePromote}
								disabled={isSaving}
								className="h-6 gap-1 text-[10px]"
							>
								<Upload size={12} />
								Promote to Project Memory
							</Button>
						)}
					</div>
					{error && <p className="mt-1 text-[10px] text-status-red">{error}</p>}
				</div>
			) : summary ? (
				<div>
					<p className="whitespace-pre-wrap text-xs text-text-primary">{summary.content}</p>
					<div className="mt-2 flex items-center justify-between gap-2">
						{summary.sourceUpdatedAt ? (
							<p className="m-0 text-[10px] text-text-tertiary">
								Updated {new Date(summary.sourceUpdatedAt).toLocaleString()}
							</p>
						) : (
							<span />
						)}
						{onPromoteToProjectMemory ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={handlePromote}
								disabled={isSaving}
								icon={<Upload size={12} />}
								className="h-6 text-[10px]"
							>
								Promote
							</Button>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}
