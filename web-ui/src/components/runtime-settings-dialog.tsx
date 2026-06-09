// Settings dialog composition for Kanban.
// Generic app settings live here, while Cline-specific provider state and
// side effects should stay in use-runtime-settings-cline-controller.ts.
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import * as RadixPopover from "@radix-ui/react-popover";
import * as RadixSelect from "@radix-ui/react-select";
import * as RadixSwitch from "@radix-ui/react-switch";
import { getRuntimeAgentCatalogEntry, getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
import { areRuntimeProjectShortcutsEqual } from "@runtime-shortcuts";
import {
	Bell,
	Bot,
	Check,
	ChevronDown,
	Circle,
	CircleDot,
	ExternalLink,
	FolderOpen,
	GitCommit,
	Palette,
	Plus,
	Settings,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountOrganizationSection } from "@/components/shared/account-organization-section";
import { ClineSetupSection } from "@/components/shared/cline-setup-section";
import {
	getRuntimeShortcutIconComponent,
	getRuntimeShortcutPickerOption,
	RUNTIME_SHORTCUT_ICON_OPTIONS,
	type RuntimeShortcutIconOption,
	type RuntimeShortcutPickerIconId,
} from "@/components/shared/runtime-shortcut-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { TASK_GIT_BASE_REF_PROMPT_VARIABLE, type TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import { useRuntimeSettingsClineController } from "@/hooks/use-runtime-settings-cline-controller";
import { useRuntimeSettingsClineMcpController } from "@/hooks/use-runtime-settings-cline-mcp-controller";
import { previewThemeId, readStoredThemeId, saveThemeId, THEME_GROUPS, THEMES, type ThemeId } from "@/hooks/use-theme";
import { useI18n } from "@/i18n/i18n-context";
import type { TranslationKey } from "@/i18n/translations";
import { useLayoutCustomizations } from "@/resize/layout-customizations";
import { openFileOnHost } from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentId,
	RuntimeClineMcpServerAuthStatus,
	RuntimeConfigResponse,
	RuntimeProjectShortcut,
} from "@/runtime/types";
import { useRuntimeConfig } from "@/runtime/use-runtime-config";
import {
	type BrowserNotificationPermission,
	getBrowserNotificationPermission,
	requestBrowserNotificationPermission,
} from "@/utils/notification-permission";
import { formatPathForDisplay } from "@/utils/path-display";
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
	if (agentId === "cline") {
		return "";
	}
	const args = autonomousModeEnabled ? (getRuntimeAgentCatalogEntry(agentId)?.autonomousArgs ?? []) : [];
	return [binary, ...args.map(quoteCommandPartForDisplay)].join(" ");
}

function normalizeTemplateForComparison(value: string): string {
	return value.replaceAll("\r\n", "\n").trim();
}

const GIT_PROMPT_VARIANT_OPTIONS: Array<{ value: TaskGitAction; labelKey: TranslationKey }> = [
	{ value: "commit", labelKey: "settings.gitPrompts.commit" },
	{ value: "pr", labelKey: "settings.gitPrompts.makePr" },
];

export type RuntimeSettingsSection = "shortcuts";

const SETTINGS_AGENT_ORDER: readonly RuntimeAgentId[] = ["cline", "claude", "codex", "droid", "kiro"];

type SettingsNavId = "general" | "cline" | "git-prompts" | "notifications" | "appearance" | "project";

const SETTINGS_NAV_ITEMS: ReadonlyArray<{
	id: SettingsNavId;
	labelKey: TranslationKey;
	icon: React.ReactNode;
	clineOnly?: boolean;
}> = [
	{ id: "general", labelKey: "settings.nav.general", icon: <SlidersHorizontal size={16} /> },
	{ id: "cline", labelKey: "settings.nav.cline", icon: <Bot size={16} />, clineOnly: true },
	{ id: "git-prompts", labelKey: "settings.nav.gitPrompts", icon: <GitCommit size={16} /> },
	{ id: "notifications", labelKey: "settings.nav.notifications", icon: <Bell size={16} /> },
	{ id: "appearance", labelKey: "settings.nav.appearance", icon: <Palette size={16} /> },
	{ id: "project", labelKey: "settings.nav.project", icon: <FolderOpen size={16} /> },
];

function getShortcutIconOption(icon: string | undefined): RuntimeShortcutIconOption {
	return getRuntimeShortcutPickerOption(icon);
}

function ShortcutIconComponent({ icon, size = 14 }: { icon: string | undefined; size?: number }): React.ReactElement {
	const Component = getRuntimeShortcutIconComponent(icon);
	return <Component size={size} />;
}

function formatNotificationPermissionStatus(
	permission: BrowserNotificationPermission,
	t: (key: TranslationKey) => string,
): string {
	if (permission === "default") {
		return t("settings.notifications.permission.notRequested");
	}
	if (permission === "granted") {
		return t("settings.notifications.permission.granted");
	}
	if (permission === "denied") {
		return t("settings.notifications.permission.denied");
	}
	return t("settings.notifications.permission.unsupported");
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
	const { t } = useI18n();
	const installUrl = getRuntimeAgentCatalogEntry(agent.id)?.installUrl;
	const isNativeCline = agent.id === "cline";
	const isInstalled = agent.installed === true;
	const isInstallStatusPending = !isNativeCline && agent.installed === null;

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
			className="flex items-center justify-between gap-3 py-1.5"
			style={{ cursor: isInstalled ? "pointer" : "default" }}
		>
			<div className="flex items-start gap-2 min-w-0">
				{isSelected ? (
					<CircleDot size={16} className="text-accent mt-0.5 shrink-0" />
				) : (
					<Circle
						size={16}
						className={cn("mt-0.5 shrink-0", !isInstalled ? "text-text-tertiary" : "text-text-secondary")}
					/>
				)}
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-[13px] text-text-primary">{agent.label}</span>
						{!isNativeCline && isInstalled ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-status-green/10 text-status-green">
								{t("common.installed")}
							</span>
						) : isInstallStatusPending ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-surface-3 text-text-secondary">
								{t("common.checking")}
							</span>
						) : null}
					</div>
					{agent.command ? (
						<p className="text-text-secondary font-mono text-xs mt-0.5 m-0">{agent.command}</p>
					) : null}
				</div>
			</div>
			{!isNativeCline && agent.installed === false && installUrl ? (
				<a
					href={installUrl}
					target="_blank"
					rel="noreferrer"
					onClick={(event: React.MouseEvent) => event.stopPropagation()}
					className="inline-flex items-center justify-center rounded-md font-medium duration-150 cursor-default select-none h-7 px-2 text-xs bg-surface-2 border border-border text-text-primary hover:bg-surface-3 hover:border-border-bright"
				>
					{t("common.install")}
				</a>
			) : !isNativeCline && agent.installed === false ? (
				<Button size="sm" disabled>
					{t("common.install")}
				</Button>
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
			size="sm"
			disabled={disabled}
			onClick={onClick}
			className={cn(monospace && "font-mono")}
			style={{
				fontSize: 10,
				verticalAlign: "middle",
				...(typeof widthCh === "number"
					? {
							width: `${widthCh}ch`,
							justifyContent: "center",
						}
					: {}),
			}}
		>
			{text}
		</Button>
	);
}

function ShortcutIconPicker({
	value,
	onSelect,
}: {
	value: string | undefined;
	onSelect: (icon: RuntimeShortcutPickerIconId) => void;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const selectedOption = getShortcutIconOption(value);

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<RadixPopover.Trigger asChild>
				<button
					type="button"
					aria-label={`Shortcut icon: ${selectedOption.label}`}
					className="inline-flex items-center gap-1 h-7 px-1.5 rounded-md border border-border bg-surface-2 text-text-primary hover:bg-surface-3"
				>
					<ShortcutIconComponent icon={value} size={14} />
					<ChevronDown size={12} />
				</button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-50 rounded-md border border-border bg-surface-2 p-1 shadow-lg"
					style={{ animation: "kb-tooltip-show 100ms ease" }}
				>
					<div className="flex gap-0.5">
						{RUNTIME_SHORTCUT_ICON_OPTIONS.map((option) => {
							const IconComponent = getRuntimeShortcutIconComponent(option.value);
							return (
								<button
									key={option.value}
									type="button"
									aria-label={option.label}
									className={cn(
										"p-1.5 rounded hover:bg-surface-3",
										selectedOption.value === option.value && "bg-surface-3",
									)}
									onClick={() => {
										onSelect(option.value);
										setOpen(false);
									}}
								>
									<IconComponent size={14} />
								</button>
							);
						})}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}

function SettingsNav({
	items,
	activeId,
	onSelect,
}: {
	items: ReadonlyArray<{ id: SettingsNavId; labelKey: TranslationKey; icon: React.ReactNode }>;
	activeId: SettingsNavId;
	onSelect: (id: SettingsNavId) => void;
}): React.ReactElement {
	const { t } = useI18n();
	return (
		<nav className="hidden md:flex w-[180px] shrink-0 flex-col gap-0.5 border-r border-border bg-surface-1 p-3 overflow-y-auto">
			{items.map((item) => (
				<button
					key={item.id}
					type="button"
					onClick={() => onSelect(item.id)}
					className={cn(
						"flex items-center gap-2.5 text-left px-3 py-2 rounded-md text-[13px] font-medium cursor-pointer",
						activeId === item.id
							? "bg-surface-3 text-text-primary"
							: "text-text-secondary hover:text-text-primary hover:bg-surface-2",
					)}
				>
					<span className="shrink-0 opacity-80">{item.icon}</span>
					<span>{t(item.labelKey)}</span>
				</button>
			))}
		</nav>
	);
}

export function RuntimeSettingsDialog({
	open,
	workspaceId,
	initialConfig = null,
	liveMcpAuthStatuses = null,
	onOpenChange,
	onSaved,
	onAccountSwitched,
	initialSection,
}: {
	open: boolean;
	workspaceId: string | null;
	initialConfig?: RuntimeConfigResponse | null;
	liveMcpAuthStatuses?: RuntimeClineMcpServerAuthStatus[] | null;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
	onAccountSwitched?: () => void;
	initialSection?: RuntimeSettingsSection | null;
}): React.ReactElement {
	const { t } = useI18n();
	const { config, isLoading, isSaving, save, refresh } = useRuntimeConfig(open, workspaceId, initialConfig);
	const { resetLayoutCustomizations } = useLayoutCustomizations();
	const [selectedAgentId, setSelectedAgentId] = useState<RuntimeAgentId>("claude");
	const [agentAutonomousModeEnabled, setAgentAutonomousModeEnabled] = useState(true);
	const [readyForReviewNotificationsEnabled, setReadyForReviewNotificationsEnabled] = useState(true);
	const [initialThemeId, setInitialThemeId] = useState<ThemeId>(readStoredThemeId);
	const [draftThemeId, setDraftThemeId] = useState<ThemeId>(readStoredThemeId);
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
	const bodyRef = useRef<HTMLDivElement>(null);
	const isScrollingProgrammatically = useRef(false);
	const [activeSection, setActiveSection] = useState<SettingsNavId>("general");
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
		selectedPromptVariant === "commit"
			? t("settings.gitPrompts.commitPlaceholder")
			: t("settings.gitPrompts.prPlaceholder");
	const bypassPermissionsCheckboxId = "runtime-settings-bypass-permissions";
	const refreshNotificationPermission = useCallback(() => {
		setNotificationPermission(getBrowserNotificationPermission());
	}, []);

	const supportedAgents = useMemo<RuntimeSettingsAgentRowModel[]>(() => {
		const agents =
			config?.agents.map((agent) => ({
				id: agent.id,
				label: agent.label,
				binary: agent.binary,
				installed: agent.id === "cline" ? true : agent.installed,
			})) ??
			getRuntimeLaunchSupportedAgentCatalog().map((agent) => ({
				id: agent.id,
				label: agent.label,
				binary: agent.binary,
				installed: agent.id === "cline" ? true : null,
			}));
		const orderIndexByAgentId = new Map(SETTINGS_AGENT_ORDER.map((agentId, index) => [agentId, index] as const));
		const orderedAgents = [...agents].sort((left, right) => {
			const leftOrderIndex = orderIndexByAgentId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
			const rightOrderIndex = orderIndexByAgentId.get(right.id) ?? Number.MAX_SAFE_INTEGER;
			return leftOrderIndex - rightOrderIndex;
		});
		return orderedAgents.map((agent) => ({
			...agent,
			command: buildDisplayedAgentCommand(agent.id, agent.binary, agentAutonomousModeEnabled),
		}));
	}, [agentAutonomousModeEnabled, config?.agents]);
	const displayedAgents = useMemo(() => supportedAgents, [supportedAgents]);
	const navItems = useMemo(
		() => SETTINGS_NAV_ITEMS.filter((item) => !item.clineOnly || selectedAgentId === "cline"),
		[selectedAgentId],
	);
	const configuredAgentId = config?.selectedAgentId ?? null;
	const firstInstalledAgentId = displayedAgents.find((agent) => agent.installed)?.id;
	const fallbackAgentId = firstInstalledAgentId ?? displayedAgents[0]?.id ?? "claude";
	const initialSelectedAgentId = configuredAgentId ?? fallbackAgentId;
	const initialAgentAutonomousModeEnabled = config?.agentAutonomousModeEnabled ?? true;
	const initialReadyForReviewNotificationsEnabled = config?.readyForReviewNotificationsEnabled ?? true;
	const initialShortcuts = config?.shortcuts ?? [];
	const initialCommitPromptTemplate = config?.commitPromptTemplate ?? "";
	const initialOpenPrPromptTemplate = config?.openPrPromptTemplate ?? "";
	const clineSettings = useRuntimeSettingsClineController({
		open,
		workspaceId,
		selectedAgentId,
		config,
	});
	const clineMcpSettings = useRuntimeSettingsClineMcpController({
		open,
		workspaceId,
		selectedAgentId,
		liveAuthStatuses: liveMcpAuthStatuses,
	});
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
		if (clineSettings.hasUnsavedChanges) {
			return true;
		}
		if (clineMcpSettings.hasUnsavedChanges) {
			return true;
		}
		if (draftThemeId !== initialThemeId) {
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
		clineMcpSettings.hasUnsavedChanges,
		clineSettings.hasUnsavedChanges,
		commitPromptTemplate,
		config,
		draftThemeId,
		initialAgentAutonomousModeEnabled,
		initialCommitPromptTemplate,
		initialOpenPrPromptTemplate,
		initialReadyForReviewNotificationsEnabled,
		initialSelectedAgentId,
		initialShortcuts,
		initialThemeId,
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
		const persistedThemeId = readStoredThemeId();
		setInitialThemeId(persistedThemeId);
		setDraftThemeId(persistedThemeId);
	}, [open]);

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

	useEffect(() => {
		if (activeSection === "cline" && selectedAgentId !== "cline") {
			setActiveSection("general");
		}
	}, [activeSection, selectedAgentId]);

	const handleBodyScroll = useCallback(() => {
		if (isScrollingProgrammatically.current) return;
		const body = bodyRef.current;
		if (!body) return;
		const headings = body.querySelectorAll<HTMLElement>("[data-settings-section]");
		const bodyRect = body.getBoundingClientRect();
		let current: SettingsNavId = "general";

		for (const heading of headings) {
			const rect = heading.getBoundingClientRect();
			if (rect.top - bodyRect.top <= 40) {
				const id = heading.getAttribute("data-settings-section");
				if (id) current = id as SettingsNavId;
			}
		}

		setActiveSection(current);
	}, []);

	const handleNavSelect = useCallback((id: SettingsNavId) => {
		setActiveSection(id);
		isScrollingProgrammatically.current = true;
		const body = bodyRef.current;
		if (!body) return;
		const target = body.querySelector(`[data-settings-section="${id}"]`);
		if (target) {
			const bodyRect = body.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			body.scrollTo({
				top: targetRect.top - bodyRect.top + body.scrollTop,
				behavior: "smooth",
			});
		}
		window.setTimeout(() => {
			isScrollingProgrammatically.current = false;
		}, 600);
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
			setSaveError(t("settings.error.runtimeLoading"));
			return;
		}
		const selectedAgent = displayedAgents.find((agent) => agent.id === selectedAgentId);
		if (!selectedAgent || selectedAgent.installed !== true) {
			setSaveError(t("settings.error.agentNotInstalled"));
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
		if (selectedAgentId === "cline" && clineSettings.providerId.trim().length === 0) {
			setSaveError(t("settings.error.chooseClineProvider"));
			return;
		}
		if (selectedAgentId === "cline") {
			const clineProviderSaveResult = await clineSettings.saveProviderSettings();
			if (!clineProviderSaveResult.ok) {
				setSaveError(clineProviderSaveResult.message ?? t("settings.error.saveClineProvider"));
				return;
			}
			const clineMcpSaveResult = await clineMcpSettings.saveMcpSettings();
			if (!clineMcpSaveResult.ok) {
				setSaveError(clineMcpSaveResult.message ?? t("settings.error.saveClineMcp"));
				return;
			}
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
			setSaveError(t("settings.error.saveRuntime"));
			return;
		}
		if (draftThemeId !== initialThemeId) {
			saveThemeId(draftThemeId);
			setInitialThemeId(draftThemeId);
		}
		onSaved?.();
		handleDialogOpenChange(false);
	};

	const handleRequestPermission = () => {
		void (async () => {
			const nextPermission = await requestBrowserNotificationPermission();
			setNotificationPermission(nextPermission);
		})();
	};

	const handleOpenFilePath = useCallback(
		(filePath: string) => {
			setSaveError(null);
			void openFileOnHost(workspaceId, filePath).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				setSaveError(t("settings.error.openFile", { message }));
			});
		},
		[t, workspaceId],
	);

	const handleClineSetupSaved = useCallback(() => {
		refresh();
		onSaved?.();
	}, [onSaved, refresh]);

	const handleDialogOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen) {
				const persistedThemeId = readStoredThemeId();
				if (draftThemeId !== persistedThemeId) {
					previewThemeId(persistedThemeId);
				}
				setDraftThemeId(persistedThemeId);
				setInitialThemeId(persistedThemeId);
			}
			onOpenChange(nextOpen);
		},
		[draftThemeId, onOpenChange],
	);

	const currentThemeDef = THEMES.find((t) => t.id === draftThemeId);

	return (
		<Dialog open={open} onOpenChange={handleDialogOpenChange} contentClassName="!max-w-[780px]">
			<DialogHeader title={t("settings.title")} icon={<Settings size={16} />} />
			<div className="flex h-[min(480px,60vh)]">
				<SettingsNav items={navItems} activeId={activeSection} onSelect={handleNavSelect} />
				<div
					ref={bodyRef}
					onScroll={handleBodyScroll}
					className="px-5 pb-5 overflow-y-auto overscroll-contain flex-1 min-h-0 bg-surface-1"
				>
					{/* ---- General ---- */}
					<div data-settings-section="general" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<SlidersHorizontal size={16} className="text-text-secondary" />
							{t("settings.nav.general")}
						</h2>
					</div>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1">
							{t("settings.agent")}
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
						{config === null ? <p className="text-text-secondary py-2">{t("settings.checkingClis")}</p> : null}
						<label
							htmlFor={bypassPermissionsCheckboxId}
							className="flex items-center gap-2 text-[13px] text-text-primary mt-2 cursor-pointer"
						>
							<RadixCheckbox.Root
								id={bypassPermissionsCheckboxId}
								aria-label={t("settings.enableBypassPermissions")}
								checked={agentAutonomousModeEnabled}
								disabled={controlsDisabled}
								onCheckedChange={(checked) => setAgentAutonomousModeEnabled(checked === true)}
								className="flex h-4 w-4 cursor-pointer items-center justify-center rounded border border-border bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
							>
								<RadixCheckbox.Indicator>
									<Check size={12} className="text-white" />
								</RadixCheckbox.Indicator>
							</RadixCheckbox.Root>
							<span>{t("settings.enableBypassPermissions")}</span>
						</label>
						<p className="text-text-secondary text-[13px] ml-6 mt-0 mb-0">
							{t("settings.bypassPermissionsHelp")}
						</p>
					</div>

					{/* ---- Cline ---- */}
					{selectedAgentId === "cline" ? (
						<>
							<div data-settings-section="cline" />
							<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
								<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
									<Bot size={16} className="text-text-secondary" />
									{t("settings.nav.cline")}
								</h2>
							</div>
							<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
								<ClineSetupSection
									controller={clineSettings}
									mcpController={clineMcpSettings}
									controlsDisabled={controlsDisabled}
									workspaceId={workspaceId}
									accountSection={
										clineSettings.providerId.trim() === "cline" ? (
											<AccountOrganizationSection
												workspaceId={workspaceId}
												open={open}
												onAccountSwitched={onAccountSwitched}
											/>
										) : null
									}
									onError={setSaveError}
									onSaved={handleClineSetupSaved}
								/>
							</div>
						</>
					) : null}

					{/* ---- Git Prompts ---- */}
					<div data-settings-section="git-prompts" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<GitCommit size={16} className="text-text-secondary" />
							{t("settings.nav.gitPrompts")}
						</h2>
					</div>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<p className="text-text-secondary text-[13px] mt-0 mb-2">{t("settings.gitPrompts.description")}</p>
						<div className="flex items-center justify-between gap-2 mb-2">
							<NativeSelect
								value={selectedPromptVariant}
								onChange={(event) => setSelectedPromptVariant(event.target.value as TaskGitAction)}
								disabled={controlsDisabled}
								style={{ minWidth: 220 }}
							>
								{GIT_PROMPT_VARIANT_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{t(option.labelKey)}
									</option>
								))}
							</NativeSelect>
							<Button
								variant="ghost"
								size="sm"
								onClick={handleResetSelectedPrompt}
								disabled={controlsDisabled || isSelectedPromptAtDefault}
							>
								{t("common.reset")}
							</Button>
						</div>
						<textarea
							rows={5}
							value={selectedPromptValue}
							onChange={(event) => handleSelectedPromptChange(event.target.value)}
							placeholder={selectedPromptPlaceholder}
							disabled={controlsDisabled}
							className="w-full rounded-md border border-border bg-surface-2 p-3 text-[13px] text-text-primary font-mono placeholder:text-text-tertiary focus:border-border-focus focus:outline-none resize-none disabled:opacity-40"
						/>
						<p className="text-text-secondary text-[13px] mt-2 mb-0">
							{t("settings.gitPrompts.use")}{" "}
							<InlineUtilityButton
								text={
									copiedVariableToken === TASK_GIT_BASE_REF_PROMPT_VARIABLE.token
										? t("common.copied")
										: TASK_GIT_BASE_REF_PROMPT_VARIABLE.token
								}
								monospace
								widthCh={
									Math.max(TASK_GIT_BASE_REF_PROMPT_VARIABLE.token.length, t("common.copied").length) + 2
								}
								onClick={() => {
									handleCopyVariableToken(TASK_GIT_BASE_REF_PROMPT_VARIABLE.token);
								}}
								disabled={controlsDisabled}
							/>{" "}
							{t("settings.gitPrompts.toReference", {
								description: t("settings.gitPrompts.baseRefDescription"),
							})}
						</p>
					</div>

					{/* ---- Notifications ---- */}
					<div data-settings-section="notifications" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<Bell size={16} className="text-text-secondary" />
							{t("settings.nav.notifications")}
						</h2>
					</div>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<div className="flex items-center gap-2">
							<RadixSwitch.Root
								checked={readyForReviewNotificationsEnabled}
								disabled={controlsDisabled}
								onCheckedChange={setReadyForReviewNotificationsEnabled}
								className="relative h-5 w-9 rounded-full bg-surface-4 data-[state=checked]:bg-accent cursor-pointer disabled:opacity-40"
							>
								<RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform translate-x-0.5 data-[state=checked]:translate-x-[18px]" />
							</RadixSwitch.Root>
							<span className="text-[13px] text-text-primary">{t("settings.notifications.notifyReview")}</span>
						</div>
						<div className="flex items-center gap-2 mt-2">
							<p className="text-text-secondary text-[13px] m-0">
								{t("settings.notifications.browserPermission", {
									permission: formatNotificationPermissionStatus(notificationPermission, t),
								})}
							</p>
							{notificationPermission !== "granted" && notificationPermission !== "unsupported" ? (
								<InlineUtilityButton
									text={t("settings.notifications.requestPermission")}
									onClick={handleRequestPermission}
									disabled={controlsDisabled}
								/>
							) : null}
						</div>
					</div>

					{/* ---- Appearance ---- */}
					<div data-settings-section="appearance" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<Palette size={16} className="text-text-secondary" />
							{t("settings.nav.appearance")}
						</h2>
					</div>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-2">
							{t("settings.appearance.theme")}
						</h6>
						<div className="min-w-0 w-1/2 max-w-full">
							<RadixSelect.Root
								value={draftThemeId}
								onValueChange={(value) => {
									setDraftThemeId(value as ThemeId);
									previewThemeId(value as ThemeId);
								}}
								onOpenChange={(selectOpen) => {
									if (!selectOpen) {
										previewThemeId(draftThemeId);
									}
								}}
							>
								<RadixSelect.Trigger
									className="flex h-9 w-full cursor-pointer items-center justify-between rounded-md border border-border-bright bg-surface-2 px-3 text-[13px] text-text-primary outline-none hover:bg-surface-3 hover:border-border-bright focus:border-border-focus focus:outline-none"
									aria-label={t("settings.appearance.theme")}
								>
									<span className="flex items-center gap-2.5">
										<span className="flex shrink-0 h-5 w-10 rounded overflow-hidden border border-border">
											<span
												className="flex-1"
												style={{ background: currentThemeDef?.surface ?? "#1F2428" }}
											/>
											<span
												className="flex-1"
												style={{ background: currentThemeDef?.accent ?? "#0084FF" }}
											/>
											<span
												className="flex-1"
												style={{ background: currentThemeDef?.accent2 ?? "#7C5CFF" }}
											/>
										</span>
										<RadixSelect.Value />
									</span>
									<RadixSelect.Icon>
										<ChevronDown size={14} className="text-text-tertiary" />
									</RadixSelect.Icon>
								</RadixSelect.Trigger>
								<RadixSelect.Portal>
									<RadixSelect.Content
										className="z-50 max-h-72 w-(--radix-select-trigger-width) overflow-auto rounded-lg border border-border bg-surface-1 p-1 shadow-xl"
										position="popper"
										sideOffset={4}
										align="start"
									>
										<RadixSelect.Viewport>
											{THEME_GROUPS.map((group) => {
												const groupThemes = THEMES.filter((t) => t.group === group.key);
												if (groupThemes.length === 0) return null;
												return (
													<RadixSelect.Group key={group.key}>
														<RadixSelect.Label className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
															{group.key === "dark"
																? t("settings.themeGroup.dark")
																: group.key === "light"
																	? t("settings.themeGroup.light")
																	: t("settings.themeGroup.highContrast")}
														</RadixSelect.Label>
														{groupThemes.map((theme) => (
															<RadixSelect.Item
																key={theme.id}
																value={theme.id}
																className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-text-secondary outline-none data-highlighted:bg-surface-3 data-highlighted:text-text-primary data-[state=checked]:text-text-primary"
																onMouseEnter={() => previewThemeId(theme.id)}
																onFocus={() => previewThemeId(theme.id)}
															>
																<span className="flex shrink-0 h-5 w-10 rounded overflow-hidden border border-border">
																	<span className="flex-1" style={{ background: theme.surface }} />
																	<span className="flex-1" style={{ background: theme.accent }} />
																	<span className="flex-1" style={{ background: theme.accent2 }} />
																</span>
																<RadixSelect.ItemText>{theme.label}</RadixSelect.ItemText>
																<RadixSelect.ItemIndicator className="ml-auto">
																	<Check size={14} className="text-accent-2" />
																</RadixSelect.ItemIndicator>
															</RadixSelect.Item>
														))}
													</RadixSelect.Group>
												);
											})}
										</RadixSelect.Viewport>
									</RadixSelect.Content>
								</RadixSelect.Portal>
							</RadixSelect.Root>
						</div>

						<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary mt-5 mb-2">
							{t("settings.appearance.layout")}
						</h6>
						<Button size="sm" onClick={resetLayoutCustomizations}>
							{t("settings.appearance.resetLayout")}
						</Button>
						<p className="text-text-secondary text-[13px] mt-2 mb-0">
							{t("settings.appearance.resetLayoutHelp")}
						</p>
					</div>
					<div data-settings-section="project" />
					<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
						<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
							<FolderOpen size={16} className="text-text-secondary" />
							{t("settings.nav.project")}
						</h2>
					</div>
					<p
						className="text-text-secondary font-mono text-xs m-0 mb-3 break-all"
						style={{ cursor: config?.projectConfigPath ? "pointer" : undefined }}
						onClick={() => {
							if (config?.projectConfigPath) {
								handleOpenFilePath(config.projectConfigPath);
							}
						}}
					>
						{config?.projectConfigPath
							? formatPathForDisplay(config.projectConfigPath)
							: "<project>/.cline/kanban/config.json"}
						{config?.projectConfigPath ? <ExternalLink size={12} className="inline ml-1.5 align-middle" /> : null}
					</p>
					<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
						<div className="flex items-center justify-between mb-2">
							<h6
								ref={shortcutsSectionRef}
								className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0"
							>
								{t("settings.project.scriptShortcuts")}
							</h6>
							<Button
								variant="ghost"
								size="sm"
								icon={<Plus size={14} />}
								onClick={() => {
									setShortcuts((current) => {
										const nextLabel = getNextShortcutLabel(
											current,
											t("settings.project.defaultShortcutLabel"),
										);
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
							>
								{t("common.add")}
							</Button>
						</div>

						{shortcuts.map((shortcut, shortcutIndex) => (
							<div
								key={shortcutIndex}
								ref={(node) => {
									shortcutRowRefs.current[shortcutIndex] = node;
								}}
								className="grid gap-2 mb-1"
								style={{
									gridTemplateColumns: "max-content 1fr 2fr auto",
								}}
							>
								<ShortcutIconPicker
									value={shortcut.icon}
									onSelect={(icon) =>
										setShortcuts((current) =>
											current.map((item, itemIndex) =>
												itemIndex === shortcutIndex ? { ...item, icon } : item,
											),
										)
									}
								/>
								<input
									value={shortcut.label}
									onChange={(event) =>
										setShortcuts((current) =>
											current.map((item, itemIndex) =>
												itemIndex === shortcutIndex ? { ...item, label: event.target.value } : item,
											),
										)
									}
									placeholder={t("settings.project.labelPlaceholder")}
									className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
								/>
								<input
									value={shortcut.command}
									onChange={(event) =>
										setShortcuts((current) =>
											current.map((item, itemIndex) =>
												itemIndex === shortcutIndex ? { ...item, command: event.target.value } : item,
											),
										)
									}
									placeholder={t("settings.project.commandPlaceholder")}
									className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
								/>
								<Button
									variant="ghost"
									size="sm"
									icon={<X size={14} />}
									aria-label={t("settings.project.removeShortcut", {
										label: shortcut.label || String(shortcutIndex + 1),
									})}
									onClick={() =>
										setShortcuts((current) => current.filter((_, itemIndex) => itemIndex !== shortcutIndex))
									}
								/>
							</div>
						))}
						{shortcuts.length === 0 ? (
							<p className="text-text-secondary text-[13px]">{t("settings.project.noShortcuts")}</p>
						) : null}
					</div>

					{saveError ? (
						<div className="flex gap-2 rounded-md border border-status-red/30 bg-status-red/5 p-3 text-[13px]">
							<span className="text-text-primary">{saveError}</span>
						</div>
					) : null}
				</div>
			</div>
			<DialogFooter>
				<Button
					size="sm"
					variant="ghost"
					className="mr-auto mt-[3px]"
					icon={<ExternalLink size={14} />}
					onClick={() => window.open("https://docs.cline.bot/kanban/overview", "_blank")}
				>
					{t("settings.readDocs")}
				</Button>
				<Button onClick={() => handleDialogOpenChange(false)} disabled={controlsDisabled}>
					{t("common.cancel")}
				</Button>
				<Button
					variant="primary"
					onClick={() => void handleSave()}
					disabled={controlsDisabled || !hasUnsavedChanges}
				>
					{t("common.save")}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
