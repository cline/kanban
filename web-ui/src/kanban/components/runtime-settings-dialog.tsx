import {
	AnchorButton,
	Button,
	Callout,
	Classes,
	Dialog,
	DialogBody,
	DialogFooter,
	HTMLSelect,
	Icon,
	InputGroup,
	Switch,
	Tag,
	TextArea,
	Tooltip,
} from "@blueprintjs/core";
import { useEffect, useMemo, useRef, useState } from "react";

import { TASK_GIT_PROMPT_VARIABLES } from "@/kanban/git-actions/build-task-git-action-prompt";
import { useRuntimeConfig } from "@/kanban/runtime/use-runtime-config";
import type { RuntimeAgentDefinition, RuntimeAgentId, RuntimeProjectShortcut } from "@/kanban/runtime/types";
import {
	getBrowserNotificationPermission,
	requestBrowserNotificationPermission,
	type BrowserNotificationPermission,
} from "@/kanban/utils/notification-permission";

const AGENT_INSTALL_URLS: Partial<Record<RuntimeAgentId, string>> = {
	claude: "https://docs.anthropic.com/en/docs/claude-code/quickstart",
	codex: "https://github.com/openai/codex",
	gemini: "https://github.com/google-gemini/gemini-cli",
	opencode: "https://github.com/sst/opencode",
	cline: "https://www.npmjs.com/package/cline",
};

function normalizeTemplateForComparison(value: string): string {
	return value.replaceAll("\r\n", "\n").trim();
}

function areShortcutsEqual(left: RuntimeProjectShortcut[], right: RuntimeProjectShortcut[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		const leftItem = left[index];
		const rightItem = right[index];
		if (!leftItem || !rightItem) {
			return false;
		}
		if (
			leftItem.id !== rightItem.id ||
			leftItem.label !== rightItem.label ||
			leftItem.command !== rightItem.command
		) {
			return false;
		}
	}
	return true;
}

type GitPromptVariant = "commit-local" | "commit-worktree" | "pr-local" | "pr-worktree";

const GIT_PROMPT_VARIANT_OPTIONS: Array<{ value: GitPromptVariant; label: string }> = [
	{ value: "commit-worktree", label: "Commit (Worktree)" },
	{ value: "pr-worktree", label: "Make PR (Worktree)" },
	{ value: "commit-local", label: "Commit (Local)" },
	{ value: "pr-local", label: "Make PR (Local)" },
];

function formatNotificationPermissionStatus(permission: BrowserNotificationPermission): string {
	if (permission === "default") {
		return "not requested yet";
	}
	return permission;
}

function AgentRow({
	agent,
	isSelected,
	onSelect,
	disabled,
}: {
	agent: RuntimeAgentDefinition;
	isSelected: boolean;
	onSelect: () => void;
	disabled: boolean;
}): React.ReactElement {
	const installUrl = AGENT_INSTALL_URLS[agent.id];

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => { if (agent.installed && !disabled) { onSelect(); } }}
			onKeyDown={(event) => { if (event.key === "Enter" && agent.installed && !disabled) { onSelect(); } }}
			style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0", cursor: agent.installed ? "pointer" : "default" }}
		>
			<div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
				<Icon icon={isSelected ? "selection" : "circle"} intent={isSelected ? "primary" : undefined} className={!agent.installed ? Classes.TEXT_DISABLED : undefined} style={{ marginTop: 2 }} />
				<div style={{ minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<span>{agent.label}</span>
						{agent.installed ? <Tag minimal intent="success">Installed</Tag> : null}
					</div>
					{agent.command ? (
						<p className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`} style={{ margin: "2px 0 0" }}>
							{agent.command}
						</p>
					) : null}
				</div>
			</div>
			{!agent.installed && installUrl ? (
				<AnchorButton
					text="Install"
					variant="outlined"
					size="small"
					href={installUrl}
					target="_blank"
					rel="noreferrer"
					onClick={(event: React.MouseEvent) => event.stopPropagation()}
				/>
			) : !agent.installed ? (
				<Button text="Install" variant="outlined" size="small" disabled />
			) : null}
		</div>
	);
}

export function RuntimeSettingsDialog({
	open,
	workspaceId,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	workspaceId: string | null;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
}): React.ReactElement {
	const { config, isLoading, isSaving, save } = useRuntimeConfig(open, workspaceId);
	const [selectedAgentId, setSelectedAgentId] = useState<RuntimeAgentId>("claude");
	const [readyForReviewNotificationsEnabled, setReadyForReviewNotificationsEnabled] = useState(true);
	const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>(
		"unsupported",
	);
	const [shortcuts, setShortcuts] = useState<RuntimeProjectShortcut[]>([]);
	const [commitLocalPromptTemplate, setCommitLocalPromptTemplate] = useState("");
	const [commitWorktreePromptTemplate, setCommitWorktreePromptTemplate] = useState("");
	const [openPrLocalPromptTemplate, setOpenPrLocalPromptTemplate] = useState("");
	const [openPrWorktreePromptTemplate, setOpenPrWorktreePromptTemplate] = useState("");
	const [selectedPromptVariant, setSelectedPromptVariant] = useState<GitPromptVariant>("commit-worktree");
	const [copiedVariableToken, setCopiedVariableToken] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const copiedVariableResetTimerRef = useRef<number | null>(null);
	const commitLocalPromptTemplateDefault = config?.commitLocalPromptTemplateDefault ?? "";
	const commitWorktreePromptTemplateDefault = config?.commitWorktreePromptTemplateDefault ?? "";
	const openPrLocalPromptTemplateDefault = config?.openPrLocalPromptTemplateDefault ?? "";
	const openPrWorktreePromptTemplateDefault = config?.openPrWorktreePromptTemplateDefault ?? "";
	const isCommitLocalPromptAtDefault =
		normalizeTemplateForComparison(commitLocalPromptTemplate) ===
		normalizeTemplateForComparison(commitLocalPromptTemplateDefault);
	const isCommitWorktreePromptAtDefault =
		normalizeTemplateForComparison(commitWorktreePromptTemplate) ===
		normalizeTemplateForComparison(commitWorktreePromptTemplateDefault);
	const isOpenPrLocalPromptAtDefault =
		normalizeTemplateForComparison(openPrLocalPromptTemplate) ===
		normalizeTemplateForComparison(openPrLocalPromptTemplateDefault);
	const isOpenPrWorktreePromptAtDefault =
		normalizeTemplateForComparison(openPrWorktreePromptTemplate) ===
		normalizeTemplateForComparison(openPrWorktreePromptTemplateDefault);
	const selectedPromptValue =
		selectedPromptVariant === "commit-local"
			? commitLocalPromptTemplate
			: selectedPromptVariant === "commit-worktree"
				? commitWorktreePromptTemplate
				: selectedPromptVariant === "pr-local"
					? openPrLocalPromptTemplate
					: openPrWorktreePromptTemplate;
	const selectedPromptDefaultValue =
		selectedPromptVariant === "commit-local"
			? commitLocalPromptTemplateDefault
			: selectedPromptVariant === "commit-worktree"
				? commitWorktreePromptTemplateDefault
				: selectedPromptVariant === "pr-local"
					? openPrLocalPromptTemplateDefault
					: openPrWorktreePromptTemplateDefault;
	const isSelectedPromptAtDefault =
		selectedPromptVariant === "commit-local"
			? isCommitLocalPromptAtDefault
			: selectedPromptVariant === "commit-worktree"
				? isCommitWorktreePromptAtDefault
				: selectedPromptVariant === "pr-local"
					? isOpenPrLocalPromptAtDefault
					: isOpenPrWorktreePromptAtDefault;
	const selectedPromptPlaceholder =
		selectedPromptVariant === "commit-local"
			? "Commit prompt template for local repositories"
			: selectedPromptVariant === "commit-worktree"
				? "Commit prompt template for worktrees"
				: selectedPromptVariant === "pr-local"
					? "PR prompt template for local repositories"
					: "PR prompt template for worktrees";
	const selectedPromptMode = selectedPromptVariant.endsWith("worktree") ? "worktree" : "local";

	const supportedAgents = useMemo(() => config?.agents ?? [], [config?.agents]);
	const configuredAgentId = config?.selectedAgentId ?? null;
	const firstInstalledAgentId = supportedAgents.find((agent) => agent.installed)?.id;
	const fallbackAgentId = firstInstalledAgentId ?? supportedAgents[0]?.id ?? "claude";
	const initialSelectedAgentId = configuredAgentId ?? fallbackAgentId;
	const initialReadyForReviewNotificationsEnabled =
		config?.readyForReviewNotificationsEnabled ?? true;
	const initialShortcuts = config?.shortcuts ?? [];
	const initialCommitLocalPromptTemplate = config?.commitLocalPromptTemplate ?? "";
	const initialCommitWorktreePromptTemplate = config?.commitWorktreePromptTemplate ?? "";
	const initialOpenPrLocalPromptTemplate = config?.openPrLocalPromptTemplate ?? "";
	const initialOpenPrWorktreePromptTemplate = config?.openPrWorktreePromptTemplate ?? "";
	const hasUnsavedChanges = useMemo(() => {
		if (!config) {
			return false;
		}
		if (selectedAgentId !== initialSelectedAgentId) {
			return true;
		}
		if (readyForReviewNotificationsEnabled !== initialReadyForReviewNotificationsEnabled) {
			return true;
		}
		if (!areShortcutsEqual(shortcuts, initialShortcuts)) {
			return true;
		}
		if (
			normalizeTemplateForComparison(commitLocalPromptTemplate) !==
			normalizeTemplateForComparison(initialCommitLocalPromptTemplate)
		) {
			return true;
		}
		if (
			normalizeTemplateForComparison(commitWorktreePromptTemplate) !==
			normalizeTemplateForComparison(initialCommitWorktreePromptTemplate)
		) {
			return true;
		}
		if (
			normalizeTemplateForComparison(openPrLocalPromptTemplate) !==
			normalizeTemplateForComparison(initialOpenPrLocalPromptTemplate)
		) {
			return true;
		}
		return (
			normalizeTemplateForComparison(openPrWorktreePromptTemplate) !==
			normalizeTemplateForComparison(initialOpenPrWorktreePromptTemplate)
		);
	}, [
		commitLocalPromptTemplate,
		commitWorktreePromptTemplate,
		config,
		initialCommitLocalPromptTemplate,
		initialCommitWorktreePromptTemplate,
		initialOpenPrLocalPromptTemplate,
		initialOpenPrWorktreePromptTemplate,
		initialReadyForReviewNotificationsEnabled,
		initialSelectedAgentId,
		initialShortcuts,
		openPrLocalPromptTemplate,
		openPrWorktreePromptTemplate,
		readyForReviewNotificationsEnabled,
		selectedAgentId,
		shortcuts,
	]);

	useEffect(() => {
		if (!open) {
			return;
		}
		setSelectedAgentId(configuredAgentId ?? fallbackAgentId);
		setReadyForReviewNotificationsEnabled(
			config?.readyForReviewNotificationsEnabled ?? true,
		);
		setShortcuts(config?.shortcuts ?? []);
		setCommitLocalPromptTemplate(config?.commitLocalPromptTemplate ?? "");
		setCommitWorktreePromptTemplate(config?.commitWorktreePromptTemplate ?? "");
		setOpenPrLocalPromptTemplate(config?.openPrLocalPromptTemplate ?? "");
		setOpenPrWorktreePromptTemplate(config?.openPrWorktreePromptTemplate ?? "");
		setSaveError(null);
	}, [
		config?.commitLocalPromptTemplate,
		config?.commitWorktreePromptTemplate,
		config?.openPrLocalPromptTemplate,
		config?.openPrWorktreePromptTemplate,
		config?.readyForReviewNotificationsEnabled,
		config?.selectedAgentId,
		config?.shortcuts,
		open,
		supportedAgents,
	]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const refreshPermission = () => {
			setNotificationPermission(getBrowserNotificationPermission());
		};
		refreshPermission();
		window.addEventListener("focus", refreshPermission);
		return () => {
			window.removeEventListener("focus", refreshPermission);
		};
	}, [open]);

	useEffect(() => {
		return () => {
			if (copiedVariableResetTimerRef.current !== null) {
				window.clearTimeout(copiedVariableResetTimerRef.current);
				copiedVariableResetTimerRef.current = null;
			}
		};
	}, []);

	const handleCopyVariableToken = (token: string) => {
		void (async () => {
			try {
				await navigator.clipboard.writeText(token);
				setCopiedVariableToken(token);
				if (copiedVariableResetTimerRef.current !== null) {
					window.clearTimeout(copiedVariableResetTimerRef.current);
				}
				copiedVariableResetTimerRef.current = window.setTimeout(() => {
					setCopiedVariableToken((current) => (current === token ? null : current));
					copiedVariableResetTimerRef.current = null;
				}, 2000);
			} catch {
				// Ignore clipboard failures.
			}
		})();
	};

	const handleSelectedPromptChange = (value: string) => {
		if (selectedPromptVariant === "commit-local") {
			setCommitLocalPromptTemplate(value);
			return;
		}
		if (selectedPromptVariant === "commit-worktree") {
			setCommitWorktreePromptTemplate(value);
			return;
		}
		if (selectedPromptVariant === "pr-local") {
			setOpenPrLocalPromptTemplate(value);
			return;
		}
		setOpenPrWorktreePromptTemplate(value);
	};

	const handleResetSelectedPrompt = () => {
		handleSelectedPromptChange(selectedPromptDefaultValue);
	};

	const handleSave = async () => {
		setSaveError(null);
		const selectedAgent = supportedAgents.find((agent) => agent.id === selectedAgentId);
		if (!selectedAgent || !selectedAgent.installed) {
			setSaveError("Selected agent is not installed. Install it first or choose an installed agent.");
			return;
		}
		const shouldRequestNotificationPermission =
			!initialReadyForReviewNotificationsEnabled &&
			readyForReviewNotificationsEnabled &&
			notificationPermission === "default";
		if (shouldRequestNotificationPermission) {
			const nextPermission = await requestBrowserNotificationPermission();
			setNotificationPermission(nextPermission);
		}
		const saved = await save({
			selectedAgentId,
			readyForReviewNotificationsEnabled,
			shortcuts,
			commitLocalPromptTemplate,
			commitWorktreePromptTemplate,
			openPrLocalPromptTemplate,
			openPrWorktreePromptTemplate,
		});
		if (!saved) {
			setSaveError("Could not save runtime settings. Check runtime logs and try again.");
			return;
		}
		onSaved?.();
		onOpenChange(false);
	};

	const handleRequestPermission = () => {
		void (async () => {
			const nextPermission = await requestBrowserNotificationPermission();
			setNotificationPermission(nextPermission);
		})();
	};

	return (
		<Dialog
			isOpen={open}
			onClose={() => onOpenChange(false)}
			title="Settings"
			icon="cog"
		>
			<DialogBody>
				<h5 className={Classes.HEADING} style={{ margin: 0 }}>Global</h5>
				<p
					className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}
					style={{ margin: 0, wordBreak: "break-all", cursor: config?.globalConfigPath ? "pointer" : undefined }}
					onClick={() => { if (config?.globalConfigPath) { window.open(`file://${config.globalConfigPath}`); } }}
				>
					{config?.globalConfigPath ?? "~/.kanbanana/config.json"}
					{config?.globalConfigPath ? <Icon icon="share" style={{ marginLeft: 6, verticalAlign: "middle" }} size={12} /> : null}
				</p>

				<h6 className={Classes.HEADING} style={{ margin: "12px 0 0" }}>Agent runtime</h6>
				{supportedAgents.map((agent) => (
					<AgentRow
						key={agent.id}
						agent={agent}
						isSelected={agent.id === selectedAgentId}
						onSelect={() => setSelectedAgentId(agent.id)}
						disabled={isLoading || isSaving}
					/>
				))}
				{supportedAgents.length === 0 ? (
					<p className={Classes.TEXT_MUTED} style={{ padding: "8px 0" }}>No supported agents discovered.</p>
				) : null}

				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 4px" }}>
					<h6 className={Classes.HEADING} style={{ margin: 0 }}>Git shortcut prompts</h6>
				</div>
				<p className={Classes.TEXT_MUTED} style={{ margin: "0 0 8px" }}>
					Modify the prompts sent to the agent when using Commit or Make PR on tasks in Review.
				</p>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
					<HTMLSelect
						value={selectedPromptVariant}
						onChange={(event) => setSelectedPromptVariant(event.target.value as GitPromptVariant)}
						options={GIT_PROMPT_VARIANT_OPTIONS}
						disabled={isLoading || isSaving}
						style={{ minWidth: 220 }}
					/>
					<Button
						text="Reset"
						variant="minimal"
						size="small"
						onClick={handleResetSelectedPrompt}
						disabled={isLoading || isSaving || isSelectedPromptAtDefault}
					/>
				</div>
				<TextArea
					fill
					rows={5}
					value={selectedPromptValue}
					onChange={(event) => handleSelectedPromptChange(event.target.value)}
					placeholder={selectedPromptPlaceholder}
					disabled={isLoading || isSaving}
					className={Classes.MONOSPACE_TEXT}
					style={{ fontFamily: "var(--bp-font-family-monospace)" }}
				/>
				<div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, margin: "8px 0 10px" }}>
					<span className={Classes.TEXT_MUTED}>Template variables:</span>
					{TASK_GIT_PROMPT_VARIABLES.map((variable) => {
						const isCopied = copiedVariableToken === variable.token;
						const tooltipContent =
							selectedPromptMode === "worktree"
								? variable.descriptions.worktree
								: variable.descriptions.local;
						return (
							<Tooltip key={variable.token} placement="bottom" content={tooltipContent}>
								<Tag
									className={Classes.MONOSPACE_TEXT}
									interactive
									onClick={() => {
										handleCopyVariableToken(variable.token);
									}}
									style={{
										cursor: "pointer",
										display: "inline-flex",
										justifyContent: "center",
										alignItems: "center",
										width: `${Math.max(variable.token.length, "Copied!".length) + 2}ch`,
										fontSize: "var(--bp-typography-size-body-x-small)",
										whiteSpace: "nowrap",
									}}
								>
									{isCopied ? "Copied!" : variable.token}
								</Tag>
							</Tooltip>
						);
					})}
				</div>
				<h6 className={Classes.HEADING} style={{ margin: "12px 0 8px" }}>Notifications</h6>
				<Switch
					checked={readyForReviewNotificationsEnabled}
					disabled={isLoading || isSaving}
					label="Notify when a task is ready for review"
					onChange={(event) => {
						setReadyForReviewNotificationsEnabled(event.currentTarget.checked);
					}}
				/>
				<div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
					<p className={Classes.TEXT_MUTED} style={{ margin: 0 }}>
						Browser permission: {formatNotificationPermissionStatus(notificationPermission)}
					</p>
						{notificationPermission !== "granted" && notificationPermission !== "unsupported" ? (
							<Button
								text="Request permission"
								size="small"
								onClick={handleRequestPermission}
								disabled={isLoading || isSaving}
							/>
						) : null}
				</div>

				<h5 className={Classes.HEADING} style={{ margin: "12px 0 0" }}>Project</h5>
				<p
					className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}
					style={{ margin: 0, wordBreak: "break-all", cursor: config?.projectConfigPath ? "pointer" : undefined }}
					onClick={() => { if (config?.projectConfigPath) { window.open(`file://${config.projectConfigPath}`); } }}
				>
					{config?.projectConfigPath ?? "<project>/.kanbanana/config.json"}
					{config?.projectConfigPath ? <Icon icon="share" style={{ marginLeft: 6, verticalAlign: "middle" }} size={12} /> : null}
				</p>

				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 0 8px" }}>
					<h6 className={Classes.HEADING} style={{ margin: 0 }}>Script shortcuts</h6>
					<Button
						icon="plus"
						text="Add"
						variant="minimal"
						size="small"
						onClick={() =>
							setShortcuts((current) => [
								...current,
								{
									id: crypto.randomUUID(),
									label: "Run",
									command: "",
								},
							])
						}
					/>
				</div>

				{shortcuts.map((shortcut) => (
					<div key={shortcut.id} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, marginBottom: 4 }}>
						<InputGroup
							value={shortcut.label}
							onChange={(event) =>
								setShortcuts((current) =>
									current.map((item) =>
										item.id === shortcut.id
											? { ...item, label: event.target.value }
											: item,
									),
								)
							}
							placeholder="Label"
							size="small"
						/>
						<InputGroup
							value={shortcut.command}
							onChange={(event) =>
								setShortcuts((current) =>
									current.map((item) =>
										item.id === shortcut.id
											? { ...item, command: event.target.value }
											: item,
									),
								)
							}
							placeholder="Command"
							size="small"
						/>
						<Button
							icon="cross"
							variant="minimal"
							size="small"
							onClick={() => setShortcuts((current) => current.filter((item) => item.id !== shortcut.id))}
						/>
					</div>
				))}
				{shortcuts.length === 0 ? (
					<p className={Classes.TEXT_MUTED}>No shortcuts configured.</p>
				) : null}

				{saveError ? (
					<Callout intent="danger" compact style={{ marginTop: 12 }}>
						{saveError}
					</Callout>
				) : null}
			</DialogBody>
			<DialogFooter
			actions={
					<>
						<Button text="Cancel" variant="outlined" onClick={() => onOpenChange(false)} disabled={isSaving} />
						<Button
							text="Save"
							intent="primary"
							onClick={() => void handleSave()}
							disabled={isLoading || isSaving || !hasUnsavedChanges}
						/>
					</>
				}
			/>
		</Dialog>
	);
}
