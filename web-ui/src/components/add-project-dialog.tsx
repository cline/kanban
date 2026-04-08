import { FolderOpen, GitBranch, Search } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { DirectoryAutocomplete } from "@/components/directory-autocomplete";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
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
	const [isAddingByPath, setIsAddingByPath] = useState(false);
	const [pendingGitInitPath, setPendingGitInitPath] = useState<string | null>(null);
	const [isInitializingGit, setIsInitializingGit] = useState(false);
	const [gitUrlInput, setGitUrlInput] = useState("");
	const [cloneDestInput, setCloneDestInput] = useState("");
	const [cloneFolderName, setCloneFolderName] = useState("");
	const [isCloning, setIsCloning] = useState(false);
	const pathInputRef = useRef<HTMLInputElement>(null);
	const gitUrlInputRef = useRef<HTMLInputElement>(null);
	const [serverRootPath, setServerRootPath] = useState<string | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		setActiveTab("path");
		setPathInput("/");
		setGitUrlInput("");
		setCloneDestInput("/");
		setCloneFolderName("");
		setIsAddingByPath(false);
		setIsCloning(false);
		setPendingGitInitPath(null);
		setIsInitializingGit(false);

		// Fetch the server root path to display at the top of the dialog
		const fetchRoot = async () => {
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const response = await trpcClient.projects.listDirectoryContents.query({});
				if (response.ok && response.rootPath) {
					setServerRootPath(response.rootPath);
				}
			} catch {
				// Best effort — display will be blank if fetch fails
			}
		};
		void fetchRoot();
	}, [open, currentProjectId]);

	// Focus the git URL input when switching to the clone tab (since it
	// doesn't have a dropdown that would pop open). We intentionally do NOT
	// auto-focus the path input to avoid the autocomplete dropdown opening
	// immediately when the dialog appears.
	useEffect(() => {
		if (!open || activeTab !== "clone") {
			return;
		}
		const timer = setTimeout(() => {
			gitUrlInputRef.current?.focus();
		}, 50);
		return () => clearTimeout(timer);
	}, [open, activeTab]);

	// Convert the relative path (e.g. "/kanban/") to an absolute path
	// by combining with the server root.
	const resolveToAbsolutePath = useCallback(
		(relativePath: string): string => {
			const cleaned = relativePath.replace(/^\/+/, "").replace(/\/+$/, "");
			if (!serverRootPath) {
				return cleaned;
			}
			const root = serverRootPath.endsWith("/") ? serverRootPath.slice(0, -1) : serverRootPath;
			return cleaned ? `${root}/${cleaned}` : root;
		},
		[serverRootPath],
	);

	const handleAddByPath = useCallback(
		async (path: string, initializeGit = false) => {
			const absolutePath = resolveToAbsolutePath(path);
			if (!absolutePath) {
				return;
			}
			const trimmed = absolutePath;
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
		[currentProjectId, onOpenChange, onProjectAdded, resolveToAbsolutePath],
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
			const trimmedFolder = cloneFolderName.trim();

			if (trimmedDest && trimmedDest !== "/") {
				// Append custom folder name to the destination if provided
				const resolvedDest = resolveToAbsolutePath(trimmedDest);
				mutationInput.path = trimmedFolder ? `${resolvedDest}/${trimmedFolder}` : resolvedDest;
			} else if (trimmedFolder) {
				// Custom folder name with default destination (server root)
				mutationInput.path = serverRootPath ? `${serverRootPath}/${trimmedFolder}` : trimmedFolder;
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
	}, [
		cloneDestInput,
		cloneFolderName,
		currentProjectId,
		gitUrlInput,
		onOpenChange,
		onProjectAdded,
		resolveToAbsolutePath,
		serverRootPath,
	]);

	// Prevent Escape from closing the dialog when any input is focused.
	// For combobox inputs (DirectoryAutocomplete), just prevent close and
	// let the autocomplete handle its own escape logic (close dropdown → blur).
	// For regular inputs, blur immediately.
	const handleDialogEscapeKeyDown = useCallback((event: KeyboardEvent) => {
		const active = document.activeElement;
		if (active instanceof HTMLInputElement) {
			event.preventDefault();
			// Let DirectoryAutocomplete handle its own Escape internally
			if (active.role !== "combobox") {
				active.blur();
			}
		}
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
				onEscapeKeyDown={handleDialogEscapeKeyDown}
			>
				<DialogHeader title="Add Project" icon={<FolderOpen size={16} />} />
				{/* Plain div instead of DialogBody so the autocomplete dropdown
				    isn't clipped by DialogBody's default overflow-y-auto */}
				<div className="flex flex-col gap-4 p-4 bg-surface-1">
					{/* Server root indicator */}
					{serverRootPath ? (
						<div className="text-[11px] text-text-tertiary font-mono truncate" title={serverRootPath}>
							Server root: {serverRootPath}
						</div>
					) : null}

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
							onSubmitPath={() => void handleAddByPath(pathInput)}
							onSubmitGitInit={() => {
								if (pendingGitInitPath) void handleAddByPath(pendingGitInitPath, true);
							}}
							currentProjectId={currentProjectId}
						/>
					) : (
						<CloneTabContent
							gitUrlInput={gitUrlInput}
							setGitUrlInput={setGitUrlInput}
							cloneDestInput={cloneDestInput}
							setCloneDestInput={setCloneDestInput}
							cloneFolderName={cloneFolderName}
							setCloneFolderName={setCloneFolderName}
							gitUrlInputRef={gitUrlInputRef}
							isCloning={isCloning}
							onSubmitClone={() => void handleClone()}
							currentProjectId={currentProjectId}
						/>
					)}
				</div>
				<DialogFooter>
					<Button variant="default" onClick={() => onOpenChange(false)} disabled={isBusy}>
						Cancel
					</Button>
					{activeTab === "path" ? (
						pendingGitInitPath === null ? (
							<Button
								variant="primary"
								onClick={() => void handleAddByPath(pathInput)}
								disabled={pathInput.trim() === "/" || isAddingByPath}
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
	onSubmitPath,
	onSubmitGitInit,
	currentProjectId,
}: {
	pathInput: string;
	setPathInput: (value: string) => void;
	pathInputRef: React.RefObject<HTMLInputElement>;
	isAddingByPath: boolean;
	isInitializingGit: boolean;
	pendingGitInitPath: string | null;
	onSubmitPath: () => void;
	onSubmitGitInit: () => void;
	currentProjectId: string | null;
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
				<span className="block text-[12px] text-text-secondary mb-1.5">Directory path</span>
				<DirectoryAutocomplete
					inputRef={pathInputRef}
					value={pathInput}
					onChange={setPathInput}
					placeholder="Search directories…"
					disabled={isAddingByPath || isInitializingGit}
					id="add-project-path-input"
					ariaLabel="Server path input"
					workspaceId={currentProjectId}
				/>
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

/** Derive a display-friendly repo name from a git URL for use as placeholder text. */
function deriveRepoNameFromUrl(gitUrl: string): string {
	const trimmed = gitUrl.trim().replace(/\/+$/, "");
	if (!trimmed) {
		return "";
	}
	// Handle SSH-style URLs: git@host:user/repo.git
	const sshMatch = trimmed.match(/^[^@]+@[^:]+:(.+)$/);
	const pathPart = sshMatch?.[1] ?? trimmed;
	const lastSegment = pathPart.split("/").pop() ?? "";
	return lastSegment.endsWith(".git") ? lastSegment.slice(0, -4) : lastSegment;
}

function CloneTabContent({
	gitUrlInput,
	setGitUrlInput,
	cloneDestInput,
	setCloneDestInput,
	cloneFolderName,
	setCloneFolderName,
	gitUrlInputRef,
	isCloning,
	onSubmitClone,
	currentProjectId,
}: {
	gitUrlInput: string;
	setGitUrlInput: (value: string) => void;
	cloneDestInput: string;
	setCloneDestInput: (value: string) => void;
	cloneFolderName: string;
	setCloneFolderName: (value: string) => void;
	gitUrlInputRef: React.RefObject<HTMLInputElement>;
	isCloning: boolean;
	onSubmitClone: () => void;
	currentProjectId: string | null;
}): ReactElement {
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onSubmitClone();
	};

	const derivedName = deriveRepoNameFromUrl(gitUrlInput);

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
			<div className="grid grid-cols-2 gap-2">
				<div>
					<span className="block text-[12px] text-text-secondary mb-1.5">Clone into</span>
					<DirectoryAutocomplete
						value={cloneDestInput}
						onChange={setCloneDestInput}
						placeholder="Search directories…"
						disabled={isCloning}
						id="add-project-clone-dest-input"
						ariaLabel="Clone destination path"
						workspaceId={currentProjectId}
					/>
				</div>
				<div>
					<label htmlFor="add-project-folder-name-input" className="block text-[12px] text-text-secondary mb-1.5">
						Folder name
					</label>
					<input
						type="text"
						id="add-project-folder-name-input"
						value={cloneFolderName}
						onChange={(e) => setCloneFolderName(e.target.value.replace(/\//g, ""))}
						placeholder={derivedName || "repo-name"}
						className="w-full h-8 px-2.5 text-[13px] font-mono rounded-md border border-border bg-surface-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
						disabled={isCloning}
						aria-label="Clone folder name"
					/>
				</div>
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
