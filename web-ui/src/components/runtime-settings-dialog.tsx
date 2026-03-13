import {
	AnchorButton,
	Button,
	Callout,
	Checkbox,
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
import type { ItemRenderer } from "@blueprintjs/select";
import { Select } from "@blueprintjs/select";
import { getRuntimeAgentCatalogEntry, RUNTIME_AGENT_CATALOG } from "@runtime-agent-catalog";
import { areRuntimeProjectShortcutsEqual } from "@runtime-shortcuts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TASK_GIT_PROMPT_VARIABLES, type TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import type { RuntimeAgentId, RuntimeConfigResponse, RuntimeProjectShortcut } from "@/runtime/types";
import { useRuntimeConfig } from "@/runtime/use-runtime-config";
import {
	type BrowserNotificationPermission,
	getBrowserNotificationPermission,
	requestBrowserNotificationPermission,
} from "@/utils/notification-permission";
import { useUnmount, useWindowEvent } from "@/utils/react-use";

interface RuntimeSettingsAgentRowModel {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	command: string;
	installed: boolean | null;
}

function quoteCommandPartForDisplay(part: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(part)) {
		return part;
	}
	return JSON.stringify(part);
}

function buildDisplayedAgentCommand(agentId: RuntimeAgentId, binary: string, autonomousModeEnabled: boolean): string {
	const args = autonomousModeEnabled ? (getRuntimeAgentCatalogEntry(agentId)?.autonomousArgs ?? []) : [];
	return [binary, ...args.map(quoteCommandPartForDisplay)].join(" ");
}

function normalizeTemplateForComparison(value: string): string {
	return value.replaceAll("\r\n", "\n").trim();
}

const GIT_PROMPT_VARIANT_OPTIONS: Array<{ value: TaskGitAction; label: string }> = [
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
			text=""
			icon={option.value}
			aria-label={option.label}
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

function getNextShortcutLabel(shortcuts: RuntimeProjectShortcut[], baseLabel: string): string {
	const normalizedTakenLabels = new Set(
		shortcuts.map((shortcut) => shortcut.label.trim().toLowerCase()).filter((label) => label.length > 0),
	);
	const normalizedBaseLabel = baseLabel.trim().toLowerCase();
	if (!normalizedTakenLabels.has(normalizedBaseLabel)) {
		return baseLabel;
	}

	let suffix = 2;
	while (normalizedTakenLabels.has(`${normalizedBaseLabel} ${suffix}`)) {
		suffix += 1;
	}
	return `${baseLabel} ${suffix}`;
}

function AgentRow({
	agent,
	isSelected,
	onSelect,
	disabled,
}: {
	agent: RuntimeSettingsAgentRowModel;
	isSelected: boolean;
	onSelect: () => void;
	disabled: boolean;
}): React.ReactElement {
	const installUrl = getRuntimeAgentCatalogEntry(agent.id)?.installUrl;
	const isInstalled = agent.installed === true;
	const isInstallStatusPending = agent.installed === null;

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => {
				if (isInstalled && !disabled) {
					onSelect();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" && isInstalled && !disabled) {
					onSelect();
				}
			}}
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 12,
				padding: "5px 0",
				cursor: isInstalled ? "pointer" : "default",
			}}
		>
			<div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
				<Icon
					icon={isSelected ? "selection" : "circle"}
					intent={isSelected ? "primary" : undefined}
					className={!isInstalled ? Classes.TEXT_DISABLED : undefined}
					style={{ marginTop: 2 }}
				/>
				<div style={{ minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<span>{agent.label}</span>
						{isInstalled ? (
							<Tag minimal intent="success">
								Installed
							</Tag>
						) : isInstallStatusPending ? (
							<Tag minimal>Checking...</Tag>
						) : null}
					</div>
					{agent.command ? (
						<p
							className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}
							style={{ margin: "1px 0 0", fontSize: "var(--bp-typography-size-body-small)" }}
						>
							{agent.command}
						</p>
					) : null}
				</div>
			</div>
			{agent.installed === false && installUrl ? (
				<AnchorButton
					text="Install"
					variant="outlined"
					size="small"
					href={installUrl}
					target="_blank"
					rel="noreferrer"
					onClick={(event: React.MouseEvent) => event.stopPropagation()}
				/>
			) : agent.installed === false ? (
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
	initialConfig = null,
	onOpenChange,
	onSaved,
	initialSection,
}: {
	open: boolean;
	workspaceId: string | null;
	initialConfig?: RuntimeConfigResponse | null;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
	initialSection?: RuntimeSettingsSection | null;
}): React.ReactElement {
	const { config, isLoading, isSaving, save } = useRuntimeConfig(open, workspaceId, initialConfig);
	const [selectedAgentId, setSelectedAgentId] = useState<RuntimeAgentId>("claude");
	const [agentAutonomousModeEnabled, setAgentAutonomousModeEnabled] = useState(true);
	const [readyForReviewNotificationsEnabled, setReadyForReviewNotificationsEnabled] = useState(true);
	const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>("unsupported");
	const [shortcuts, setShortcuts] = useState<RuntimeProjectShortcut[]>([]);
	const [commitPromptTemplate, setCommitPromptTemplate] = useState("");
	const [openPrPromptTemplate, setOpenPrPromptTemplate] = useState("");
	const [selectedPromptVariant, setSelectedPromptVariant] = useState<TaskGitAction>("commit");
	const [copiedVariableToken, setCopiedVariableToken] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [pendingShortcutScrollIndex, setPendingShortcutScrollIndex] = useState<number | null>(null);
	const copiedVariableResetTimerRef = useRef<number | null>(null);
	const shortcutsSectionRef = useRef<HTMLHeadingElement | null>(null);
	const shortcutRowRefs = useRef<Array<HTMLDivElement | null>>([]);
	const controlsDisabled = isLoading || isSaving || config === null;
	const commitPromptTemplateDefault = config?.commitPromptTemplateDefault ?? "";
	const openPrPromptTemplateDefault = config?.openPrPromptTemplateDefault ?? "";
	const isCommitPromptAtDefault =
		normalizeTemplateForComparison(commitPromptTemplate) ===
		normalizeTemplateForComparison(commitPromptTemplateDefault);
	const isOpenPrPromptAtDefault =
		normalizeTemplateForComparison(openPrPromptTemplate) ===
		normalizeTemplateForComparison(openPrPromptTemplateDefault);
	const selectedPromptValue = selectedPromptVariant === "commit" ? commitPromptTemplate : openPrPromptTemplate;
	const selectedPromptDefaultValue =
		selectedPromptVariant === "commit" ? commitPromptTemplateDefault : openPrPromptTemplateDefault;
	const isSelectedPromptAtDefault =
		selectedPromptVariant === "commit" ? isCommitPromptAtDefault : isOpenPrPromptAtDefault;
	const selectedPromptPlaceholder =
		selectedPromptVariant === "commit" ? "Commit prompt template" : "PR prompt template";
	const baseRefVariable = TASK_GIT_PROMPT_VARIABLES[0];
	const refreshNotificationPermission = useCallback(() => {
		setNotificationPermission(getBrowserNotificationPermission());
	}, []);

	const supportedAgents = useMemo<RuntimeSettingsAgentRowModel[]>(() => {
		const agents =
			config?.agents.map((agent) => ({
				id: agent.id,
				label: agent.label,
				binary: agent.binary,
				installed: agent.installed,
			})) ??
			RUNTIME_AGENT_CATALOG.map((agent) => ({
				id: agent.id,
				label: agent.label,
				binary: agent.binary,
				installed: null,
			}));
		return agents.map((agent) => ({
			...agent,
			command: buildDisplayedAgentCommand(agent.id, agent.binary, agentAutonomousModeEnabled),
		}));
	}, [agentAutonomousModeEnabled, config?.agents]);
	const displayedAgents = useMemo(() => supportedAgents, [supportedAgents]);
	const configuredAgentId = config?.selectedAgentId ?? null;
	const firstInstalledAgentId = displayedAgents.find((agent) => agent.installed)?.id;
	const fallbackAgentId = firstInstalledAgentId ?? displayedAgents[0]?.id ?? "claude";
	const initialSelectedAgentId = configuredAgentId ?? fallbackAgentId;
	const initialAgentAutonomousModeEnabled = config?.agentAutonomousModeEnabled ?? true;
	const initialReadyForReviewNotificationsEnabled = config?.readyForReviewNotificationsEnabled ?? true;
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
		if (agentAutonomousModeEnabled !== initialAgentAutonomousModeEnabled) {
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
		agentAutonomousModeEnabled,
		commitPromptTemplate,
		config,
		initialAgentAutonomousModeEnabled,
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
		setAgentAutonomousModeEnabled(config?.agentAutonomousModeEnabled ?? true);
		setReadyForReviewNotificationsEnabled(config?.readyForReviewNotificationsEnabled ?? true);
		setShortcuts(config?.shortcuts ?? []);
		setCommitPromptTemplate(config?.commitPromptTemplate ?? "");
		setOpenPrPromptTemplate(config?.openPrPromptTemplate ?? "");
		setSaveError(null);
	}, [
		config?.agentAutonomousModeEnabled,
		config?.commitPromptTemplate,
		config?.openPrPromptTemplate,
		config?.readyForReviewNotificationsEnabled,
		config?.selectedAgentId,
		config?.shortcuts,
		fallbackAgentId,
		open,
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
		if (pendingShortcutScrollIndex === null) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			const target = shortcutRowRefs.current[pendingShortcutScrollIndex] ?? null;
			if (target) {
				target.scrollIntoView({ block: "nearest", behavior: "smooth" });
				const firstInput = target.querySelector("input");
				firstInput?.focus();
				setPendingShortcutScrollIndex(null);
			}
		});
		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [pendingShortcutScrollIndex, shortcuts]);

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
		if (!config) {
			setSaveError("Runtime settings are still loading. Try again in a moment.");
			return;
		}
		const selectedAgent = displayedAgents.find((agent) => agent.id === selectedAgentId);
		if (!selectedAgent || selectedAgent.installed !== true) {
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
			agentAutonomousModeEnabled,
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
		<Dialog isOpen={open} onClose={() => onOpenChange(false)} title="Settings" icon="cog">
			<DialogBody>
				<h5 className={Classes.HEADING} style={{ margin: 0 }}>
					Global
				</h5>
				<p
					className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}
					style={{ margin: 0, wordBreak: "break-all", cursor: config?.globalConfigPath ? "pointer" : undefined }}
					onClick={() => {
						if (config?.globalConfigPath) {
							window.open(`file://${config.globalConfigPath}`);
						}
					}}
				>
					{config?.globalConfigPath ?? "~/.kanban/config.json"}
					{config?.globalConfigPath ? (
						<Icon icon="share" style={{ marginLeft: 6, verticalAlign: "middle" }} size={12} />
					) : null}
				</p>

				<h6 className={Classes.HEADING} style={{ margin: "12px 0 0" }}>
					Agent runtime
				</h6>
				{displayedAgents.map((agent) => (
					<AgentRow
						key={agent.id}
						agent={agent}
						isSelected={agent.id === selectedAgentId}
						onSelect={() => setSelectedAgentId(agent.id)}
						disabled={controlsDisabled}
					/>
				))}
				{config === null ? (
					<p className={Classes.TEXT_MUTED} style={{ padding: "8px 0" }}>
						Checking which CLIs are installed for this project...
					</p>
				) : null}
				<Checkbox
					checked={agentAutonomousModeEnabled}
					disabled={controlsDisabled}
					label="Enable bypass permissions flag"
					onChange={(event) => {
						setAgentAutonomousModeEnabled(event.currentTarget.checked);
					}}
					style={{ marginTop: 8 }}
				/>
				<p className={Classes.TEXT_MUTED} style={{ margin: "0 0 0 24px" }}>
					Allows agents to use tools without stopping for permission. Use at your own risk.
				</p>

				<div
					style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 4px" }}
				>
					<h6 className={Classes.HEADING} style={{ margin: 0 }}>
						Git button prompts
					</h6>
				</div>
				<p className={Classes.TEXT_MUTED} style={{ margin: "0 0 8px" }}>
					Modify the prompts sent to the agent when using Commit or Make PR on tasks in Review.
				</p>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 8,
						marginBottom: 8,
					}}
				>
					<HTMLSelect
						value={selectedPromptVariant}
						onChange={(event) => setSelectedPromptVariant(event.target.value as TaskGitAction)}
						options={GIT_PROMPT_VARIANT_OPTIONS}
						disabled={controlsDisabled}
						style={{ minWidth: 220 }}
					/>
					<Button
						text="Reset"
						variant="minimal"
						size="small"
						onClick={handleResetSelectedPrompt}
						disabled={controlsDisabled || isSelectedPromptAtDefault}
					/>
				</div>
				<TextArea
					fill
					rows={5}
					value={selectedPromptValue}
					onChange={(event) => handleSelectedPromptChange(event.target.value)}
					placeholder={selectedPromptPlaceholder}
					disabled={controlsDisabled}
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
						disabled={controlsDisabled}
					/>{" "}
					to reference {baseRefVariable.description}
				</p>
				<h6 className={Classes.HEADING} style={{ margin: "18px 0 8px" }}>
					Notifications
				</h6>
				<Switch
					checked={readyForReviewNotificationsEnabled}
					disabled={controlsDisabled}
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
							disabled={controlsDisabled}
						/>
					) : null}
				</div>

				<h5 className={Classes.HEADING} style={{ margin: "18px 0 0" }}>
					Project
				</h5>
				<p
					className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}
					style={{ margin: 0, wordBreak: "break-all", cursor: config?.projectConfigPath ? "pointer" : undefined }}
					onClick={() => {
						if (config?.projectConfigPath) {
							window.open(`file://${config.projectConfigPath}`);
						}
					}}
				>
					{config?.projectConfigPath ?? "<project>/.kanban/config.json"}
					{config?.projectConfigPath ? (
						<Icon icon="share" style={{ marginLeft: 6, verticalAlign: "middle" }} size={12} />
					) : null}
				</p>

				<div
					style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 0 8px" }}
				>
					<h6 ref={shortcutsSectionRef} className={Classes.HEADING} style={{ margin: 0 }}>
						Script shortcuts
					</h6>
					<Button
						icon="plus"
						text="Add"
						variant="minimal"
						size="small"
						onClick={() => {
							setShortcuts((current) => {
								const nextLabel = getNextShortcutLabel(current, "Run");
								setPendingShortcutScrollIndex(current.length);
								return [
									...current,
									{
										label: nextLabel,
										command: "",
										icon: "play",
									},
								];
							});
						}}
						disabled={controlsDisabled}
					/>
				</div>

				{shortcuts.map((shortcut, shortcutIndex) => (
					<div
						key={shortcutIndex}
						ref={(node) => {
							shortcutRowRefs.current[shortcutIndex] = node;
						}}
						style={{ display: "grid", gridTemplateColumns: "max-content 1fr 2fr auto", gap: 8, marginBottom: 4 }}
					>
						<ShortcutIconSelect
							items={SHORTCUT_ICON_OPTIONS}
							itemRenderer={renderShortcutIconOption}
							filterable={false}
							menuProps={{
								style: {
									minWidth: "unset",
									width: "fit-content",
								},
							}}
							popoverProps={{ matchTargetWidth: false }}
							onItemSelect={(option) =>
								setShortcuts((current) =>
									current.map((item, itemIndex) =>
										itemIndex === shortcutIndex ? { ...item, icon: option.value } : item,
									),
								)
							}
						>
							<Button
								variant="outlined"
								size="small"
								aria-label={`Shortcut icon: ${getShortcutIconOption(shortcut.icon).label}`}
								style={{
									minWidth: 0,
									paddingLeft: 4,
									paddingRight: 8,
								}}
							>
								<span
									style={{
										display: "flex",
										alignItems: "center",
										gap: 4,
									}}
								>
									<Icon icon={getShortcutIconOption(shortcut.icon).value} />
									<Icon icon="caret-down" size={12} />
								</span>
							</Button>
						</ShortcutIconSelect>
						<InputGroup
							value={shortcut.label}
							onChange={(event) =>
								setShortcuts((current) =>
									current.map((item, itemIndex) =>
										itemIndex === shortcutIndex ? { ...item, label: event.target.value } : item,
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
									current.map((item, itemIndex) =>
										itemIndex === shortcutIndex ? { ...item, command: event.target.value } : item,
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
							onClick={() =>
								setShortcuts((current) => current.filter((_, itemIndex) => itemIndex !== shortcutIndex))
							}
						/>
					</div>
				))}
				{shortcuts.length === 0 ? <p className={Classes.TEXT_MUTED}>No shortcuts configured.</p> : null}

				{saveError ? (
					<Callout intent="danger" compact style={{ marginTop: 12 }}>
						{saveError}
					</Callout>
				) : null}
			</DialogBody>
			<DialogFooter
				actions={
					<>
						<Button
							text="Cancel"
							variant="outlined"
							onClick={() => onOpenChange(false)}
							disabled={controlsDisabled}
						/>
						<Button
							text="Save"
							intent="primary"
							onClick={() => void handleSave()}
							disabled={controlsDisabled || !hasUnsavedChanges}
						/>
					</>
				}
			/>
		</Dialog>
	);
}
