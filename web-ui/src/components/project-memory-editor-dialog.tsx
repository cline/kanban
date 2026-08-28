import { AlertTriangle, BookOpen, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface ProjectMemoryEditorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
}

const PLACEHOLDER_GUIDANCE = `# Project Memory Guidelines

This is durable, project-scoped context that will be injected into every new Cline task session.

## Appropriate Content

- **Architecture facts**: Key services, data flows, deployment topology
- **Commands & test methods**: e.g., "Use browser CDP for E2E tests", "Run cargo test --all"
- **Conventions**: Code style, naming patterns, folder structure decisions
- **Known failure prevention**: "Don't use X library due to Y bug", "Always Z before W"

## What NOT to Include

- Task-specific transcripts or assistant output
- Tool call logs or temporary debugging output
- Personal notes unrelated to project execution
- Sensitive credentials or secrets

Keep this concise and high-signal. Maximum 10,000 characters.`;

export function ProjectMemoryEditorDialog({ open, onOpenChange, workspaceId }: ProjectMemoryEditorDialogProps) {
	const [content, setContent] = useState("");
	const [originalContent, setOriginalContent] = useState("");
	const [maxChars, setMaxChars] = useState(10_000);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadProjectMemory = useCallback(async () => {
		if (!workspaceId) return;

		setIsLoading(true);
		setError(null);
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const memory = await trpcClient.projects.getMemory.query();
			setContent(memory.content);
			setOriginalContent(memory.content);
			setMaxChars(memory.maxChars);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(`Failed to load project memory: ${message}`);
		} finally {
			setIsLoading(false);
		}
	}, [workspaceId]);

	const saveProjectMemory = useCallback(async () => {
		if (!workspaceId) return;

		setIsSaving(true);
		setError(null);
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const result = await trpcClient.projects.saveMemory.mutate({ content });
			setContent(result.content);
			setOriginalContent(result.content);
			setMaxChars(result.maxChars);
			toast.success("Project memory saved");
			onOpenChange(false);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(`Failed to save project memory: ${message}`);
			toast.error("Failed to save project memory");
		} finally {
			setIsSaving(false);
		}
	}, [workspaceId, content, onOpenChange]);

	useEffect(() => {
		if (open && workspaceId) {
			loadProjectMemory();
		} else if (!open) {
			setContent("");
			setError(null);
		}
	}, [open, workspaceId, loadProjectMemory]);

	const handleContentChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
		const newContent = event.target.value;
		setContent(newContent);
	}, []);

	const remainingChars = maxChars - content.length;
	const isOverLimit = remainingChars < 0;
	const hasChanges = content !== originalContent;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogHeader title="Project Memory" />
			<DialogBody>
				<div className="flex flex-col gap-4">
					{error && (
						<div className="flex items-start gap-2 p-3 rounded-md bg-status-red/10 border border-status-red text-status-red">
							<AlertTriangle size={16} className="shrink-0 mt-0.5" />
							<span className="text-sm">{error}</span>
						</div>
					)}

					<div className="flex items-center gap-2 text-sm text-text-secondary">
						<BookOpen size={16} />
						<span>Durable context injected into every new Cline task in this project.</span>
					</div>

					{isLoading ? (
						<div className="text-sm text-text-secondary">Loading project memory...</div>
					) : (
						<>
							<textarea
								className="w-full h-96 p-3 bg-surface-1 border border-border rounded-md text-text-primary font-mono text-xs resize-none focus:outline-none focus:border-border-focus"
								placeholder={PLACEHOLDER_GUIDANCE}
								value={content}
								onChange={handleContentChange}
								disabled={isSaving}
							/>

							<div className="flex items-center justify-between text-xs">
								<span className={cn("text-text-secondary", isOverLimit && "text-status-red font-medium")}>
									{remainingChars.toLocaleString()} characters remaining
								</span>
								{content.length > 0 && (
									<span className="text-text-tertiary">
										{content.length.toLocaleString()} / {maxChars.toLocaleString()} characters
									</span>
								)}
							</div>
						</>
					)}
				</div>
			</DialogBody>
			<DialogFooter>
				<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
					Cancel
				</Button>
				<Button
					variant="primary"
					onClick={saveProjectMemory}
					disabled={isSaving || isLoading || !hasChanges || isOverLimit}
				>
					<Save size={16} />
					{isSaving ? "Saving..." : "Save Memory"}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
