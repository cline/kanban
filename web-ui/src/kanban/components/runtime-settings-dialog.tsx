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
	MenuItem,
	Switch,
	Tag,
	TextArea,
} from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { Select } from "@blueprintjs/select";
import type { ItemRenderer } from "@blueprintjs/select";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { areRuntimeProjectShortcutsEqual } from "@runtime-shortcuts";

import { TASK_GIT_PROMPT_VARIABLES } from "@/kanban/git-actions/build-task-git-action-prompt";
import { useUnmount, useWindowEvent } from "@/kanban/hooks/react-use";
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

type GitPromptVariant = "commit" | "pr";

const GIT_PROMPT_VARIANT_OPTIONS: Array<{ value: GitPromptVariant; label: string }> = [
	{ value: "commit", label: "Commit" },
	{ value: "pr", label: "Make PR" },
];

const SHORTCUT_ICON_OPTIONS: Array<{ value: IconName; label: string }> = [
	{ value: "play", label: "Play" },
	{ value: "console", label: "Terminal" },
	{ value: "bug", label: "Debug" },
	{ value: "download", label: "Download" },
	{ value: "upload", label: "Upload" },
	{ value: "build", label: "Build" },
	{ value: "code", label: "Code" },
	{ value: "rocket", label: "Deploy" },
];
const SHORTCUT_ICON_VALUES = new Set<IconName>(SHORTCUT_ICON_OPTIONS.map((option) => option.value));
const ShortcutIconSelect = Select.ofType<{ value: IconName; label: string }>();
export type RuntimeSettingsSection = "shortcuts";

const renderShortcutIconOption: ItemRenderer<{ value: IconName; label: string }> = (
	option,
	{ handleClick, handleFocus, modifiers },
) => {
	if (!modifiers.matchesPredicate) {
		return null;
	}
	return (
		<MenuItem
			key={option.value}
			active={modifiers.active}
			disabled={modifiers.disabled}
			icon={option.value}
			text={option.label}
			onClick={handleClick}
			onFocus={handleFocus}
			roleStructure="listoption"
		/>
	);
};

function getShortcutIconOption(icon: string | undefined): { value: IconName; label: string } {
	if (icon && SHORTCUT_ICON_VALUES.has(icon as IconName)) {
		const match = SHORTCUT_ICON_OPTIONS.find((option) => option.value === icon);
		if (match) {
			return match;
		}
	}
	return SHORTCUT_ICON_OPTIONS[0] ?? { value: "console", label: "Terminal" };
}

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
			style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "5px 0", cursor: agent.installed ? "pointer" : "default" }}
		>
			<div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
				<Icon icon={isSelected ? "selection" : "circle"} intent={isSelected ? "primary" : undefined} className={!agent.installed ? Classes.TEXT_DISABLED : undefined} style={{ marginTop: 2 }} />
				<div style={{ minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<span>{agent.label}</span>
						{agent.installed ? <Tag minimal intent="success">Installed</Tag> : null}
					</div>
					{agent.command ? (
						<p
							className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}
							style={{ margin: "1px 0 0", fontSize: "var(--bp-typography-size-body-x-small)" }}
						>
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

function InlineUtilityButton({
	text,
	onClick,
	disabled,
	monospace,
	widthCh,
}: {
	text: string;
	onClick: () => void;
	disabled?: boolean;
	monospace?: boolean;
	widthCh?: number;
}): React.ReactElement {
	return (
		<Button
			text={text}
			size="small"
			variant="outlined"
			disabled={disabled}
			onClick={onClick}
			className={monospace ? Classes.MONOSPACE_TEXT : undefined}
			style={{
				fontSize: "var(--bp-typography-size-body-x-small)",
				verticalAlign: "middle",
				...(typeof widthCh === "number"
					? {
						width: `${widthCh}ch`,
						justifyContent: "center",
					}
					: {}),
			}}
		/>
	);
}

export function RuntimeSettingsDialog({
	open,
	workspaceId,
	onOpenChange,
	onSaved,
	initialSection,
}: {
	open: boolean;
	workspaceId: string | null;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
	initialSection?: RuntimeSettingsSection | null;
}): React.ReactElement {
	const { config, isLoading, isSaving, save } = useRuntimeConfig(open, workspaceId);
	const [selectedAgentId, setSelectedAgentId] = useState<RuntimeAgentId>("claude");
	const [readyForReviewNotificationsEnabled, setReadyForReviewNotificationsEnabled] = useState(true);
	const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>(
		"unsupported",
	);
	const [shortcuts, setShortcuts] = useState<RuntimeProjectShortcut[]>([]);
	const [commitPromptTemplate, setCommitPromptTemplate] = useState("");
	const [openPrPromptTemplate, setOpenPrPromptTemplate] = useState("");
	const [selectedPromptVariant, setSelectedPromptVariant] = useState<GitPromptVariant>("commit");
	const [copiedVariableToken, setCopiedVariableToken] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [pendingShortcutScrollId, setPendingShortcutScrollId] = useState<string | null>(null);
	const copiedVariableResetTimerRef = useRef<number | null>(null);
	const shortcutsSectionRef = useRef<HTMLHeadingElement | null>(null);
	const shortcutRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const commitPromptTemplateDefault = config?.commitPromptTemplateDefault ?? "";
	const openPrPromptTemplateDefault = config?.openPrPromptTemplateDefault ?? "";
	const isCommitPromptAtDefault =
		normalizeTemplateForComparison(commitPromptTemplate) ===
		normalizeTemplateForComparison(commitPromptTemplateDefault);
	const isOpenPrPromptAtDefault =
		normalizeTemplateForComparison(openPrPromptTemplate) ===
		normalizeTemplateForComparison(openPrPromptTemplateDefault);
	const selectedPromptValue =
		selectedPromptVariant === "commit"
				? commitPromptTemplate
				: openPrPromptTemplate;
	const selectedPromptDefaultValue =
		selectedPromptVariant === "commit"
				? commitPromptTemplateDefault
				: openPrPromptTemplateDefault;
	const isSelectedPromptAtDefault =
		selectedPromptVariant === "commit"
				? isCommitPromptAtDefault
				: isOpenPrPromptAtDefault;
	const selectedPromptPlaceholder =
		selectedPromptVariant === "commit"
				? "Commit prompt template"
				: "PR prompt template";
	const baseRefVariable = TASK_GIT_PROMPT_VARIABLES[0];
	const refreshNotificationPermission = useCallback(() => {
		setNotificationPermission(getBrowserNotificationPermission());
	}, []);

	const supportedAgents = useMemo(() => config?.agents ?? [], [config?.agents]);
	const configuredAgentId = config?.selectedAgentId ?? null;
	const firstInstalledAgentId = supportedAgents.find((agent) => agent.installed)?.id;
	const fallbackAgentId = firstInstalledAgentId ?? supportedAgents[0]?.id ?? "claude";
	const initialSelectedAgentId = configuredAgentId ?? fallbackAgentId;
	const initialReadyForReviewNotificationsEnabled =
		config?.readyForReviewNotificationsEnabled ?? true;
	const initialShortcuts = config?.shortcuts ?? [];
	const initialCommitPromptTemplate = config?.commitPromptTemplate ?? "";
	const initialOpenPrPromptTemplate = config?.openPrPromptTemplate ?? "";
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
		if (!areRuntimeProjectShortcutsEqual(shortcuts, initialShortcuts)) {
			return true;
		}
		if (
			normalizeTemplateForComparison(commitPromptTemplate) !==
			normalizeTemplateForComparison(initialCommitPromptTemplate)
		) {
			return true;
		}
		return (
			normalizeTemplateForComparison(openPrPromptTemplate) !==
			normalizeTemplateForComparison(initialOpenPrPromptTemplate)
		);
	}, [
		commitPromptTemplate,
		config,
		initialCommitPromptTemplate,
		initialOpenPrPromptTemplate,
		initialReadyForReviewNotificationsEnabled,
		initialSelectedAgentId,
		initialShortcuts,
		openPrPromptTemplate,
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
		setCommitPromptTemplate(config?.commitPromptTemplate ?? "");
		setOpenPrPromptTemplate(config?.openPrPromptTemplate ?? "");
		setSaveError(null);
	}, [
		config?.commitPromptTemplate,
		config?.openPrPromptTemplate,
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
		refreshNotificationPermission();
	}, [open, refreshNotificationPermission]);
	useWindowEvent("focus", open ? refreshNotificationPermission : null);

	useEffect(() => {
		if (!open || initialSection !== "shortcuts") {
			return;
		}
		const timeout = window.setTimeout(() => {
			shortcutsSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
		}, 500);
		return () => {
			window.clearTimeout(timeout);
		};
	}, [initialSection, open]);

	useEffect(() => {
		if (!pendingShortcutScrollId) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			const target = shortcutRowRefs.current[pendingShortcutScrollId];
			if (target) {
				target.scrollIntoView({ block: "nearest", behavior: "smooth" });
				const firstInput = target.querySelector("input");
				firstInput?.focus();
				setPendingShortcutScrollId(null);
			}
		});
		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [pendingShortcutScrollId, shortcuts]);

	useUnmount(() => {
		if (copiedVariableResetTimerRef.current !== null) {
			window.clearTimeout(copiedVariableResetTimerRef.current);
			copiedVariableResetTimerRef.current = null;
		}
	});

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
		if (selectedPromptVariant === "commit") {
			setCommitPromptTemplate(value);
			return;
		}
		setOpenPrPromptTemplate(value);
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
			commitPromptTemplate,
			openPrPromptTemplate,
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
					<h6 className={Classes.HEADING} style={{ margin: 0 }}>Git button prompts</h6>
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
				<p className={Classes.TEXT_MUTED} style={{ margin: "8px 0 10px" }}>
					Use{" "}
					<InlineUtilityButton
						text={copiedVariableToken === baseRefVariable.token ? "Copied!" : baseRefVariable.token}
						monospace
						widthCh={Math.max(baseRefVariable.token.length, "Copied!".length) + 2}
						onClick={() => {
							handleCopyVariableToken(baseRefVariable.token);
						}}
						disabled={isLoading || isSaving}
					/>{" "}
					to reference {baseRefVariable.description}
				</p>
				<h6 className={Classes.HEADING} style={{ margin: "18px 0 8px" }}>Notifications</h6>
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
						<InlineUtilityButton
							text="Request permission"
							onClick={handleRequestPermission}
							disabled={isLoading || isSaving}
						/>
					) : null}
				</div>

				<h5 className={Classes.HEADING} style={{ margin: "18px 0 0" }}>Project</h5>
				<p
					className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}
					style={{ margin: 0, wordBreak: "break-all", cursor: config?.projectConfigPath ? "pointer" : undefined }}
					onClick={() => { if (config?.projectConfigPath) { window.open(`file://${config.projectConfigPath}`); } }}
				>
					{config?.projectConfigPath ?? "<project>/.kanbanana/config.json"}
					{config?.projectConfigPath ? <Icon icon="share" style={{ marginLeft: 6, verticalAlign: "middle" }} size={12} /> : null}
				</p>

				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 0 8px" }}>
					<h6 ref={shortcutsSectionRef} className={Classes.HEADING} style={{ margin: 0 }}>Script shortcuts</h6>
					<Button
						icon="plus"
						text="Add"
						variant="minimal"
						size="small"
						onClick={() => {
							const nextId = crypto.randomUUID();
							setShortcuts((current) => [
								...current,
								{
									id: nextId,
									label: "Run",
									command: "",
									icon: "play",
								},
							]);
							setPendingShortcutScrollId(nextId);
						}}
					/>
				</div>

				{shortcuts.map((shortcut) => (
					<div
						key={shortcut.id}
						ref={(node) => {
							shortcutRowRefs.current[shortcut.id] = node;
						}}
						style={{ display: "grid", gridTemplateColumns: "max-content 1fr 2fr auto", gap: 8, marginBottom: 4 }}
					>
						<ShortcutIconSelect
							items={SHORTCUT_ICON_OPTIONS}
							itemRenderer={renderShortcutIconOption}
							filterable={false}
							popoverProps={{ matchTargetWidth: false }}
							onItemSelect={(option) =>
								setShortcuts((current) =>
									current.map((item) =>
										item.id === shortcut.id
											? { ...item, icon: option.value }
											: item,
									),
								)
							}
						>
							<Button
								variant="outlined"
								size="small"
								alignText="left"
								icon={getShortcutIconOption(shortcut.icon).value}
								endIcon="caret-down"
								text={getShortcutIconOption(shortcut.icon).label}
							/>
						</ShortcutIconSelect>
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
