// Settings dialog composition for Kanban.
// Generic app settings live here, while Cline-specific provider state and
// side effects should stay in use-runtime-settings-cline-controller.ts.
import { getRuntimeAgentCatalogEntry, getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
import { areRuntimeProjectShortcutsEqual } from "@runtime-shortcuts";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRowModel } from "@/components/settings/agent-panel";
import {
	ScrollableSettingsBody,
	type ScrollableSettingsBodyHandle,
} from "@/components/settings/scrollable-settings-body";
import { SettingsNav, type SettingsNavSection } from "@/components/settings/settings-nav";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { useRuntimeSettingsClineController } from "@/hooks/use-runtime-settings-cline-controller";
import { useRuntimeSettingsClineMcpController } from "@/hooks/use-runtime-settings-cline-mcp-controller";
import { previewThemeId, readStoredThemeId, saveThemeId, type ThemeId } from "@/hooks/use-theme";
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
import { useWindowEvent } from "@/utils/react-use";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

export type RuntimeSettingsSection = "shortcuts";

const SETTINGS_AGENT_ORDER: readonly RuntimeAgentId[] = ["cline", "claude", "codex", "droid", "kiro"];

// ---------------------------------------------------------------------------
// Main dialog export
// ---------------------------------------------------------------------------

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
	const { config, isLoading, isSaving, save } = useRuntimeConfig(open, workspaceId, initialConfig);
	const { resetLayoutCustomizations } = useLayoutCustomizations();
	const [activeNavSection, setActiveNavSection] = useState<SettingsNavSection>("general");
	const [selectedAgentId, setSelectedAgentId] = useState<RuntimeAgentId>("claude");
	const [agentAutonomousModeEnabled, setAgentAutonomousModeEnabled] = useState(true);
	const [readyForReviewNotificationsEnabled, setReadyForReviewNotificationsEnabled] = useState(true);
	const [initialThemeId, setInitialThemeId] = useState<ThemeId>(readStoredThemeId);
	const [draftThemeId, setDraftThemeId] = useState<ThemeId>(readStoredThemeId);
	const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>("unsupported");
	const [shortcuts, setShortcuts] = useState<RuntimeProjectShortcut[]>([]);
	const [commitPromptTemplate, setCommitPromptTemplate] = useState("");
	const [openPrPromptTemplate, setOpenPrPromptTemplate] = useState("");
	const [saveError, setSaveError] = useState<string | null>(null);
	const scrollableBodyRef = useRef<ScrollableSettingsBodyHandle | null>(null);
	const controlsDisabled = isLoading || isSaving || config === null;
	const commitPromptTemplateDefault = config?.commitPromptTemplateDefault ?? "";
	const openPrPromptTemplateDefault = config?.openPrPromptTemplateDefault ?? "";

	const refreshNotificationPermission = useCallback(() => {
		setNotificationPermission(getBrowserNotificationPermission());
	}, []);

	const agentModels = useMemo<AgentRowModel[]>(() => {
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

	const configuredAgentId = config?.selectedAgentId ?? null;
	const firstInstalledAgentId = agentModels.find((agent) => agent.installed)?.id;
	const fallbackAgentId = firstInstalledAgentId ?? agentModels[0]?.id ?? "claude";
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

	// Map initialSection to nav section on open
	useEffect(() => {
		if (!open) {
			return;
		}
		if (initialSection === "shortcuts") {
			setActiveNavSection("shortcuts");
		}
	}, [initialSection, open]);

	// Scroll to initialSection after mount
	useEffect(() => {
		if (!open || initialSection !== "shortcuts") {
			return;
		}
		const timeout = window.setTimeout(() => {
			scrollableBodyRef.current?.scrollToSection("shortcuts");
		}, 500);
		return () => {
			window.clearTimeout(timeout);
		};
	}, [initialSection, open]);

	// Sync local state from config when dialog opens or config changes
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

	// Reset theme draft when dialog opens
	useEffect(() => {
		if (!open) {
			return;
		}
		const persistedThemeId = readStoredThemeId();
		setInitialThemeId(persistedThemeId);
		setDraftThemeId(persistedThemeId);
	}, [open]);

	// Refresh notification permission when dialog opens or window regains focus
	useEffect(() => {
		if (!open) {
			return;
		}
		refreshNotificationPermission();
	}, [open, refreshNotificationPermission]);
	useWindowEvent("focus", open ? refreshNotificationPermission : null);

	// Redirect to agent panel if MCP was selected but agent changed from cline
	useEffect(() => {
		if (activeNavSection === "mcp" && selectedAgentId !== "cline") {
			setActiveNavSection("agent");
		}
	}, [activeNavSection, selectedAgentId]);

	const handleSave = async () => {
		setSaveError(null);
		if (!config) {
			setSaveError("Runtime settings are still loading. Try again in a moment.");
			return;
		}
		const selectedAgent = agentModels.find((agent) => agent.id === selectedAgentId);
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
		if (selectedAgentId === "cline" && clineSettings.providerId.trim().length === 0) {
			setSaveError("Choose a Cline provider before saving.");
			return;
		}
		if (selectedAgentId === "cline") {
			const clineProviderSaveResult = await clineSettings.saveProviderSettings();
			if (!clineProviderSaveResult.ok) {
				setSaveError(clineProviderSaveResult.message ?? "Could not save Cline provider settings.");
				return;
			}
			const clineMcpSaveResult = await clineMcpSettings.saveMcpSettings();
			if (!clineMcpSaveResult.ok) {
				setSaveError(clineMcpSaveResult.message ?? "Could not save Cline MCP settings.");
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
			setSaveError("Could not save runtime settings. Check runtime logs and try again.");
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
				setSaveError(`Could not open file on host: ${message}`);
			});
		},
		[workspaceId],
	);

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

	const showMcpInNav = selectedAgentId === "cline";

	const handleNavSectionChange = useCallback((section: SettingsNavSection) => {
		setActiveNavSection(section);
		scrollableBodyRef.current?.scrollToSection(section);
	}, []);

	return (
		<Dialog open={open} onOpenChange={handleDialogOpenChange} contentClassName="!max-w-[780px]">
			<DialogHeader title="Settings" />

			<div className="flex h-[600px]">
				{/* Sidebar navigation */}
				<div className="w-[180px] shrink-0 border-r border-border bg-surface-1 overflow-y-auto">
					<SettingsNav
						activeSection={activeNavSection}
						onSectionChange={handleNavSectionChange}
						showMcp={showMcpInNav}
					/>
				</div>
				{/* Scrollable body with all panels */}
				<ScrollableSettingsBody
					ref={scrollableBodyRef}
					config={config}
					draftThemeId={draftThemeId}
					onThemeChange={setDraftThemeId}
					onResetLayout={resetLayoutCustomizations}
					readyForReviewNotificationsEnabled={readyForReviewNotificationsEnabled}
					onReadyForReviewNotificationsChange={setReadyForReviewNotificationsEnabled}
					notificationPermission={notificationPermission}
					onRequestPermission={handleRequestPermission}
					onOpenFilePath={handleOpenFilePath}
					controlsDisabled={controlsDisabled}
					displayedAgents={agentModels}
					selectedAgentId={selectedAgentId}
					onSelectAgent={setSelectedAgentId}
					agentAutonomousModeEnabled={agentAutonomousModeEnabled}
					onAutonomousModeChange={setAgentAutonomousModeEnabled}
					clineSettings={clineSettings}
					clineMcpSettings={clineMcpSettings}
					workspaceId={workspaceId}
					open={open}
					onAccountSwitched={onAccountSwitched}
					configLoaded={config !== null}
					onError={setSaveError}
					showMcp={showMcpInNav}
					commitPromptTemplate={commitPromptTemplate}
					openPrPromptTemplate={openPrPromptTemplate}
					commitPromptTemplateDefault={commitPromptTemplateDefault}
					openPrPromptTemplateDefault={openPrPromptTemplateDefault}
					onCommitPromptChange={setCommitPromptTemplate}
					onOpenPrPromptChange={setOpenPrPromptTemplate}
					shortcuts={shortcuts}
					onShortcutsChange={setShortcuts}
					onActiveSectionChange={setActiveNavSection}
					saveError={saveError}
				/>
			</div>

			<DialogFooter>
				<Button
					size="sm"
					variant="ghost"
					className="mr-auto mt-[3px]"
					icon={<ExternalLink size={14} />}
					onClick={() => window.open("https://docs.cline.bot/kanban/overview", "_blank")}
				>
					Read the docs
				</Button>
				<Button onClick={() => handleDialogOpenChange(false)} disabled={controlsDisabled}>
					Cancel
				</Button>
				<Button
					variant="primary"
					onClick={() => void handleSave()}
					disabled={controlsDisabled || !hasUnsavedChanges}
				>
					Save
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
