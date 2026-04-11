import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

import type { AgentRowModel } from "@/components/settings/agent-panel";
import { AgentPanel } from "@/components/settings/agent-panel";
import { GeneralPanel } from "@/components/settings/general-panel";
import { GitPromptsPanel } from "@/components/settings/git-prompts-panel";
import { McpPanel } from "@/components/settings/mcp-panel";
import type { SettingsNavSection } from "@/components/settings/settings-nav";
import { ShortcutsPanel } from "@/components/settings/shortcuts-panel";
import { cn } from "@/components/ui/cn";
import type { UseRuntimeSettingsClineControllerResult } from "@/hooks/use-runtime-settings-cline-controller";
import type { UseRuntimeSettingsClineMcpControllerResult } from "@/hooks/use-runtime-settings-cline-mcp-controller";
import type { ThemeId } from "@/hooks/use-theme";
import type { RuntimeAgentId, RuntimeConfigResponse, RuntimeProjectShortcut } from "@/runtime/types";
import type { BrowserNotificationPermission } from "@/utils/notification-permission";

export interface ScrollableSettingsBodyHandle {
	scrollToSection: (sectionId: SettingsNavSection) => void;
}

interface ScrollableSettingsBodyProps {
	// General panel props
	config: RuntimeConfigResponse | null;
	draftThemeId: ThemeId;
	onThemeChange: (themeId: ThemeId) => void;
	onResetLayout: () => void;
	readyForReviewNotificationsEnabled: boolean;
	onReadyForReviewNotificationsChange: (enabled: boolean) => void;
	notificationPermission: BrowserNotificationPermission;
	onRequestPermission: () => void;
	onOpenFilePath: (filePath: string) => void;
	controlsDisabled: boolean;

	// Agent panel props
	displayedAgents: AgentRowModel[];
	selectedAgentId: RuntimeAgentId;
	onSelectAgent: (agentId: RuntimeAgentId) => void;
	agentAutonomousModeEnabled: boolean;
	onAutonomousModeChange: (enabled: boolean) => void;
	clineSettings: UseRuntimeSettingsClineControllerResult;
	clineMcpSettings: UseRuntimeSettingsClineMcpControllerResult;
	workspaceId: string | null;
	open: boolean;
	onAccountSwitched?: () => void;
	configLoaded: boolean;
	onError: (message: string | null) => void;

	// MCP panel props (reuses clineMcpSettings, workspaceId, controlsDisabled, onError)
	showMcp: boolean;

	// Git prompts panel props
	commitPromptTemplate: string;
	openPrPromptTemplate: string;
	commitPromptTemplateDefault: string;
	openPrPromptTemplateDefault: string;
	onCommitPromptChange: (value: string) => void;
	onOpenPrPromptChange: (value: string) => void;

	// Shortcuts panel props
	shortcuts: RuntimeProjectShortcut[];
	onShortcutsChange: React.Dispatch<React.SetStateAction<RuntimeProjectShortcut[]>>;

	// Scroll-spy callback
	onActiveSectionChange: (sectionId: SettingsNavSection) => void;

	// Optional save error to display at the bottom
	saveError?: string | null;
}

/**
 * All settings sections stacked in a single scrollable container.
 * Uses IntersectionObserver to report which section is currently most visible.
 * Exposes `scrollToSection(id)` via imperative handle for programmatic navigation.
 */
export const ScrollableSettingsBody = forwardRef<ScrollableSettingsBodyHandle, ScrollableSettingsBodyProps>(
	function ScrollableSettingsBody(props, ref) {
		const scrollContainerRef = useRef<HTMLDivElement | null>(null);
		const sectionRefs = useRef<Map<SettingsNavSection, HTMLDivElement>>(new Map());
		const isScrollingProgrammatically = useRef(false);

		const setSectionRef = useCallback((sectionId: SettingsNavSection, node: HTMLDivElement | null) => {
			if (node) {
				sectionRefs.current.set(sectionId, node);
			} else {
				sectionRefs.current.delete(sectionId);
			}
		}, []);

		// Expose scrollToSection via imperative handle
		useImperativeHandle(
			ref,
			() => ({
				scrollToSection(sectionId: SettingsNavSection) {
					const node = sectionRefs.current.get(sectionId);
					const container = scrollContainerRef.current;
					if (!node || !container) {
						return;
					}

					// Suppress observer updates during programmatic scroll
					isScrollingProgrammatically.current = true;

					node.scrollIntoView({ behavior: "smooth", block: "start" });

					// Re-enable observer after scroll settles
					const timeout = window.setTimeout(() => {
						isScrollingProgrammatically.current = false;
					}, 600);

					return () => {
						window.clearTimeout(timeout);
					};
				},
			}),
			[],
		);

		// IntersectionObserver scroll-spy
		useEffect(() => {
			const container = scrollContainerRef.current;
			if (!container) {
				return;
			}

			const visibilityMap = new Map<SettingsNavSection, number>();

			const observer = new IntersectionObserver(
				(entries) => {
					if (isScrollingProgrammatically.current) {
						return;
					}

					for (const entry of entries) {
						const sectionId = (entry.target as HTMLElement).dataset.sectionId as SettingsNavSection | undefined;
						if (sectionId) {
							visibilityMap.set(sectionId, entry.intersectionRatio);
						}
					}

					// Find the section with the highest visibility ratio
					let bestSection: SettingsNavSection | null = null;
					let bestRatio = 0;
					for (const [sectionId, ratio] of visibilityMap) {
						if (ratio > bestRatio) {
							bestRatio = ratio;
							bestSection = sectionId;
						}
					}

					if (bestSection) {
						props.onActiveSectionChange(bestSection);
					}
				},
				{
					root: container,
					threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
				},
			);

			for (const node of sectionRefs.current.values()) {
				observer.observe(node);
			}

			return () => {
				observer.disconnect();
			};
			// eslint-disable-next-line react-hooks/exhaustive-deps -- re-run when showMcp changes (sections change)
		}, [props.showMcp, props.onActiveSectionChange]);

		const sections: Array<{ id: SettingsNavSection; visible: boolean }> = [
			{ id: "general", visible: true },
			{ id: "agent", visible: true },
			{ id: "mcp", visible: props.showMcp },
			{ id: "git-prompts", visible: true },
			{ id: "shortcuts", visible: true },
		];

		const visibleSections = sections.filter((s) => s.visible);

		return (
			<div
				ref={scrollContainerRef}
				data-scroll-settings
				className="flex-1 min-w-0 overflow-y-auto overscroll-contain p-5 bg-surface-1"
			>
				{visibleSections.map((section, visibleIndex) => (
					<div
						key={section.id}
						data-section-id={section.id}
						ref={(node) => setSectionRef(section.id, node)}
						className={cn(
							// Separator between sections (not on first)
							visibleIndex > 0 ? "border-t border-border pt-6 mt-8" : "",
						)}
					>
						{renderSection(section.id, props)}
					</div>
				))}
				{props.saveError ? (
					<div className="flex gap-2 rounded-md border border-status-red/30 bg-status-red/5 p-3 text-[13px] mt-4">
						<span className="text-text-primary">{props.saveError}</span>
					</div>
				) : null}
			</div>
		);
	},
);

function renderSection(sectionId: SettingsNavSection, props: ScrollableSettingsBodyProps): React.ReactElement {
	switch (sectionId) {
		case "general":
			return (
				<GeneralPanel
					config={props.config}
					draftThemeId={props.draftThemeId}
					onThemeChange={props.onThemeChange}
					onResetLayout={props.onResetLayout}
					readyForReviewNotificationsEnabled={props.readyForReviewNotificationsEnabled}
					onReadyForReviewNotificationsChange={props.onReadyForReviewNotificationsChange}
					notificationPermission={props.notificationPermission}
					onRequestPermission={props.onRequestPermission}
					onOpenFilePath={props.onOpenFilePath}
					controlsDisabled={props.controlsDisabled}
				/>
			);
		case "agent":
			return (
				<AgentPanel
					displayedAgents={props.displayedAgents}
					selectedAgentId={props.selectedAgentId}
					onSelectAgent={props.onSelectAgent}
					agentAutonomousModeEnabled={props.agentAutonomousModeEnabled}
					onAutonomousModeChange={props.onAutonomousModeChange}
					clineSettings={props.clineSettings}
					clineMcpSettings={props.clineMcpSettings}
					workspaceId={props.workspaceId}
					open={props.open}
					onAccountSwitched={props.onAccountSwitched}
					controlsDisabled={props.controlsDisabled}
					configLoaded={props.configLoaded}
					onError={props.onError}
				/>
			);
		case "mcp":
			return (
				<McpPanel
					mcpController={props.clineMcpSettings}
					workspaceId={props.workspaceId}
					controlsDisabled={props.controlsDisabled}
					onError={props.onError}
				/>
			);
		case "git-prompts":
			return (
				<GitPromptsPanel
					commitPromptTemplate={props.commitPromptTemplate}
					openPrPromptTemplate={props.openPrPromptTemplate}
					commitPromptTemplateDefault={props.commitPromptTemplateDefault}
					openPrPromptTemplateDefault={props.openPrPromptTemplateDefault}
					onCommitPromptChange={props.onCommitPromptChange}
					onOpenPrPromptChange={props.onOpenPrPromptChange}
					controlsDisabled={props.controlsDisabled}
				/>
			);
		case "shortcuts":
			return (
				<ShortcutsPanel
					shortcuts={props.shortcuts}
					onShortcutsChange={props.onShortcutsChange}
					controlsDisabled={props.controlsDisabled}
				/>
			);
	}
}
