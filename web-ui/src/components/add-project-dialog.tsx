import { FolderOpen, GitBranch, Search } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { RemoteFileBrowserDialog } from "@/components/remote-file-browser-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

type AddProjectTab = "path" | "clone";

export interface AddProjectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onProjectAdded: (projectId: string) => void;
	currentProjectId: string | null;
}

export function AddProjectDialog({
	open,
	onOpenChange,
	onProjectAdded,
	currentProjectId,
}: AddProjectDialogProps): ReactElement {
	const [activeTab, setActiveTab] = useState<AddProjectTab>("path");
	const [pathInput, setPathInput] = useState("");
	const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
	const [isAddingByPath, setIsAddingByPath] = useState(false);
	const [pendingGitInitPath, setPendingGitInitPath] = useState<string | null>(null);
	const [isInitializingGit, setIsInitializingGit] = useState(false);
	const [gitUrlInput, setGitUrlInput] = useState("");
	const [cloneDestInput, setCloneDestInput] = useState("");
	const [isCloning, setIsCloning] = useState(false);
	const pathInputRef = useRef<HTMLInputElement>(null);
	const gitUrlInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		setActiveTab("path");
		setPathInput("");
		setGitUrlInput("");
		setCloneDestInput("");
		setIsAddingByPath(false);
		setIsCloning(false);
		setPendingGitInitPath(null);
		setIsInitializingGit(false);
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const timer = setTimeout(() => {
			if (activeTab === "path") {
				pathInputRef.current?.focus();
			} else {
				gitUrlInputRef.current?.focus();
			}
		}, 50);
		return () => clearTimeout(timer);
	}, [open, activeTab]);

	const handleAddByPath = useCallback(
		async (path: string, initializeGit = false) => {
			const trimmed = path.trim();
			if (!trimmed) {
				return;
			}
			if (initializeGit) {
				setIsInitializingGit(true);
			} else {
				setIsAddingByPath(true);
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const added = await trpcClient.projects.add.mutate({ path: trimmed, initializeGit });
				if (!added.ok || !added.project) {
					if (added.requiresGitInitialization) {
						setPendingGitInitPath(trimmed);
						return;
					}
					throw new Error(added.error ?? "Could not add project.");
				}
				setPendingGitInitPath(null);
				onProjectAdded(added.project.id);
				onOpenChange(false);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			} finally {
				setIsAddingByPath(false);
				setIsInitializingGit(false);
			}
		},
		[currentProjectId, onOpenChange, onProjectAdded],
	);

	const handleClone = useCallback(async () => {
		const trimmedUrl = gitUrlInput.trim();
		if (!trimmedUrl) {
			return;
		}
		setIsCloning(true);
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const mutationInput: { gitUrl: string; path?: string } = { gitUrl: trimmedUrl };
			const trimmedDest = cloneDestInput.trim();
			if (trimmedDest) {
				mutationInput.path = trimmedDest;
			}
			const added = await trpcClient.projects.add.mutate(mutationInput);
			if (!added.ok || !added.project) {
				throw new Error(added.error ?? "Clone failed.");
			}
			showAppToast({ intent: "success", message: "Repository cloned and added successfully.", timeout: 4000 });
			onProjectAdded(added.project.id);
			onOpenChange(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsCloning(false);
		}
	}, [cloneDestInput, currentProjectId, gitUrlInput, onOpenChange, onProjectAdded]);

	const handleFileBrowserSelect = useCallback((selectedPath: string) => {
		setPathInput(selectedPath);
		setIsFileBrowserOpen(false);
		setPendingGitInitPath(null);
	}, []);

	const isBusy = isAddingByPath || isCloning || isInitializingGit;

	return (
		<>
			<Dialog
				open={open}
				onOpenChange={(isOpen) => {
					if (!isOpen && isBusy) {
						return;
					}
					onOpenChange(isOpen);
				}}
				contentClassName="max-w-lg"
				contentAriaDescribedBy="add-project-dialog-description"
			>
				<DialogHeader title="Add Project" icon={<FolderOpen size={16} />} />
				<DialogBody className="flex flex-col gap-4 p-4">
					{/* Tab switcher */}
					<div className="rounded-md bg-surface-2 p-1">
						<div className="grid grid-cols-2 gap-1">
							<button
								type="button"
								onClick={() => {
									setActiveTab("path");
									setPendingGitInitPath(null);
								}}
								disabled={isBusy}
								className={cn(
									"cursor-pointer rounded-sm px-2 py-1 text-xs font-medium inline-flex items-center justify-center gap-1.5",
									activeTab === "path"
										? "bg-surface-4 text-text-primary"
										: "text-text-secondary hover:text-text-primary",
									isBusy && "cursor-not-allowed opacity-50",
								)}
							>
								<Search size={12} />
								Server Path
							</button>
							<button
								type="button"
								onClick={() => {
									setActiveTab("clone");
									setPendingGitInitPath(null);
								}}
								disabled={isBusy}
								className={cn(
									"cursor-pointer rounded-sm px-2 py-1 text-xs font-medium inline-flex items-center justify-center gap-1.5",
									activeTab === "clone"
										? "bg-surface-4 text-text-primary"
										: "text-text-secondary hover:text-text-primary",
									isBusy && "cursor-not-allowed opacity-50",
								)}
							>
								<GitBranch size={12} />
								Git Clone
							</button>
						</div>
					</div>

					{activeTab === "path" ? (
						<PathTabContent
							pathInput={pathInput}
							setPathInput={(v) => {
								setPathInput(v);
								setPendingGitInitPath(null);
							}}
							pathInputRef={pathInputRef}
							isAddingByPath={isAddingByPath}
							isInitializingGit={isInitializingGit}
							pendingGitInitPath={pendingGitInitPath}
							onBrowse={() => setIsFileBrowserOpen(true)}
							onSubmitPath={() => void handleAddByPath(pathInput)}
							onSubmitGitInit={() => {
								if (pendingGitInitPath) void handleAddByPath(pendingGitInitPath, true);
							}}
						/>
					) : (
						<CloneTabContent
							gitUrlInput={gitUrlInput}
							setGitUrlInput={setGitUrlInput}
							cloneDestInput={cloneDestInput}
							setCloneDestInput={setCloneDestInput}
							gitUrlInputRef={gitUrlInputRef}
							isCloning={isCloning}
							onSubmitClone={() => void handleClone()}
						/>
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="default" onClick={() => onOpenChange(false)} disabled={isBusy}>
						Cancel
					</Button>
					{activeTab === "path" ? (
						pendingGitInitPath === null ? (
							<Button
								variant="primary"
								onClick={() => void handleAddByPath(pathInput)}
								disabled={!pathInput.trim() || isAddingByPath}
							>
								{isAddingByPath ? (
									<>
										<Spinner size={14} />
										Adding...
									</>
								) : (
									"Add Project"
								)}
							</Button>
						) : (
							<Button
								variant="primary"
								onClick={() => void handleAddByPath(pendingGitInitPath, true)}
								disabled={isInitializingGit}
							>
								{isInitializingGit ? (
									<>
										<Spinner size={14} />
										Initializing...
									</>
								) : (
									"Initialize Git Repository"
								)}
							</Button>
						)
					) : (
						<Button
							variant="primary"
							onClick={() => void handleClone()}
							disabled={!gitUrlInput.trim() || isCloning}
						>
							{isCloning ? (
								<>
									<Spinner size={14} />
									Cloning...
								</>
							) : (
								"Clone & Add"
							)}
						</Button>
					)}
				</DialogFooter>
			</Dialog>
			<RemoteFileBrowserDialog
				open={isFileBrowserOpen}
				onOpenChange={setIsFileBrowserOpen}
				onSelect={handleFileBrowserSelect}
				workspaceId={currentProjectId}
			/>
		</>
	);
}

function PathTabContent({
	pathInput,
	setPathInput,
	pathInputRef,
	isAddingByPath,
	isInitializingGit,
	pendingGitInitPath,
	onBrowse,
	onSubmitPath,
	onSubmitGitInit,
}: {
	pathInput: string;
	setPathInput: (value: string) => void;
	pathInputRef: React.RefObject<HTMLInputElement>;
	isAddingByPath: boolean;
	isInitializingGit: boolean;
	pendingGitInitPath: string | null;
	onBrowse: () => void;
	onSubmitPath: () => void;
	onSubmitGitInit: () => void;
}): ReactElement {
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (pendingGitInitPath) {
			onSubmitGitInit();
		} else {
			onSubmitPath();
		}
	};

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-3">
			<div>
				<label htmlFor="add-project-path-input" className="block text-[12px] text-text-secondary mb-1.5">
					Enter a directory path on the server
				</label>
				<div className="flex gap-2">
					<input
						ref={pathInputRef}
						type="text"
						value={pathInput}
						onChange={(e) => setPathInput(e.target.value)}
						placeholder="e.g. /home/user/my-project"
						className="flex-1 min-w-0 h-8 px-2.5 text-[13px] font-mono rounded-md border border-border bg-surface-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
						disabled={isAddingByPath || isInitializingGit}
						id="add-project-path-input"
						aria-label="Server path input"
					/>
					<Button
						variant="default"
						size="sm"
						onClick={onBrowse}
						disabled={isAddingByPath || isInitializingGit}
						type="button"
					>
						Browse
					</Button>
				</div>
			</div>
			{pendingGitInitPath !== null ? (
				<div className="rounded-md border border-status-yellow/30 bg-status-yellow/5 px-3 py-2.5 flex flex-col gap-2">
					<p className="text-[13px] text-text-primary">
						This directory is not a git repository. Kanban requires git to manage worktrees for tasks.
					</p>
					<p className="font-mono text-[11px] text-text-secondary break-all">{pendingGitInitPath}</p>
					<Button variant="primary" size="sm" type="submit" disabled={isInitializingGit} className="self-start">
						{isInitializingGit ? (
							<>
								<Spinner size={14} />
								Initializing...
							</>
						) : (
							"Initialize Git Repository"
						)}
					</Button>
				</div>
			) : null}
			<p id="add-project-dialog-description" className="sr-only">
				Add a project by entering a server path, browsing the remote filesystem, or cloning a git repository.
			</p>
		</form>
	);
}

function CloneTabContent({
	gitUrlInput,
	setGitUrlInput,
	cloneDestInput,
	setCloneDestInput,
	gitUrlInputRef,
	isCloning,
	onSubmitClone,
}: {
	gitUrlInput: string;
	setGitUrlInput: (value: string) => void;
	cloneDestInput: string;
	setCloneDestInput: (value: string) => void;
	gitUrlInputRef: React.RefObject<HTMLInputElement>;
	isCloning: boolean;
	onSubmitClone: () => void;
}): ReactElement {
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onSubmitClone();
	};

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-3">
			<div>
				<label htmlFor="add-project-git-url-input" className="block text-[12px] text-text-secondary mb-1.5">
					Git repository URL
				</label>
				<input
					ref={gitUrlInputRef}
					type="text"
					id="add-project-git-url-input"
					value={gitUrlInput}
					onChange={(e) => setGitUrlInput(e.target.value)}
					placeholder="e.g. https://github.com/user/repo.git"
					className="w-full h-8 px-2.5 text-[13px] font-mono rounded-md border border-border bg-surface-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
					disabled={isCloning}
					aria-label="Git URL input"
				/>
			</div>
			<div>
				<label htmlFor="add-project-clone-dest-input" className="block text-[12px] text-text-secondary mb-1.5">
					Clone destination <span className="text-text-tertiary">(optional, defaults to server CWD)</span>
				</label>
				<input
					type="text"
					value={cloneDestInput}
					onChange={(e) => setCloneDestInput(e.target.value)}
					placeholder="e.g. my-project"
					className="w-full h-8 px-2.5 text-[13px] font-mono rounded-md border border-border bg-surface-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
					disabled={isCloning}
					id="add-project-clone-dest-input"
					aria-label="Clone destination path"
				/>
			</div>
			{isCloning ? (
				<div className="flex items-center gap-2 text-[13px] text-text-secondary">
					<Spinner size={14} />
					Cloning repository... This may take a moment.
				</div>
			) : null}
		</form>
	);
}
