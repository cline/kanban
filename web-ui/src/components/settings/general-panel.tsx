import * as RadixSwitch from "@radix-ui/react-switch";
import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";

import { SettingRow } from "@/components/settings/setting-row";
import { SettingSection } from "@/components/settings/setting-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { previewThemeId, THEMES, type ThemeId } from "@/hooks/use-theme";
import type { RuntimeConfigResponse } from "@/runtime/types";
import type { BrowserNotificationPermission } from "@/utils/notification-permission";
import { formatPathForDisplay } from "@/utils/path-display";

function formatNotificationPermissionStatus(permission: BrowserNotificationPermission): string {
	if (permission === "default") {
		return "not requested yet";
	}
	return permission;
}

export function GeneralPanel({
	config,
	draftThemeId,
	onThemeChange,
	onResetLayout,
	readyForReviewNotificationsEnabled,
	onReadyForReviewNotificationsChange,
	notificationPermission,
	onRequestPermission,
	onOpenFilePath,
	controlsDisabled,
}: {
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
}): ReactElement {
	return (
		<div>
			<div className="sticky top-[-20px] -mx-5 px-5 -mt-5 pt-5 pb-3 mb-4 bg-surface-1 z-10">
				<h2 className="text-base font-semibold text-text-primary m-0 mb-1">General</h2>
				<p className="text-[12px] text-text-secondary m-0">Appearance, notifications, and configuration files.</p>
			</div>

			<SettingSection title="Appearance">
				<SettingRow label="Theme" description="Choose a color theme for the interface.">
					<div className="flex flex-wrap gap-2 mt-1">
						{THEMES.map((theme) => (
							<button
								key={theme.id}
								type="button"
								aria-label={theme.label}
								title={theme.label}
								onClick={() => {
									onThemeChange(theme.id);
									previewThemeId(theme.id);
								}}
								className={cn(
									"w-7 h-7 rounded-full border-2 cursor-pointer transition-all hover:scale-110",
									draftThemeId === theme.id ? "border-accent ring-2 ring-accent/40" : "border-transparent",
								)}
								style={{
									background: `radial-gradient(circle at 60% 40%, ${theme.accent}, ${theme.surface})`,
								}}
							/>
						))}
					</div>
					<p className="text-text-tertiary text-[11px] mt-1.5 mb-0">
						{THEMES.find((t) => t.id === draftThemeId)?.label ?? "Default"}
					</p>
				</SettingRow>

				<SettingRow
					label="Layout"
					description="Reset sidebar, split pane, and terminal resize customizations."
					control={
						<Button size="sm" onClick={onResetLayout} disabled={controlsDisabled}>
							Reset layout
						</Button>
					}
				/>
			</SettingSection>

			<SettingSection title="Notifications">
				<SettingRow
					label="Notify when task is ready for review"
					description="Send a browser notification when a task moves to the review column."
					control={
						<RadixSwitch.Root
							checked={readyForReviewNotificationsEnabled}
							disabled={controlsDisabled}
							onCheckedChange={onReadyForReviewNotificationsChange}
							className="relative h-5 w-9 rounded-full bg-surface-4 data-[state=checked]:bg-accent cursor-pointer disabled:opacity-40"
						>
							<RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform translate-x-0.5 data-[state=checked]:translate-x-[18px]" />
						</RadixSwitch.Root>
					}
				/>
				<SettingRow
					label="Browser permission"
					description={formatNotificationPermissionStatus(notificationPermission)}
					noBorder
					control={
						notificationPermission !== "granted" && notificationPermission !== "unsupported" ? (
							<Button size="sm" onClick={onRequestPermission} disabled={controlsDisabled}>
								Request
							</Button>
						) : null
					}
				/>
			</SettingSection>

			<SettingSection title="Configuration files">
				<SettingRow
					label="Global config"
					noBorder={!config?.projectConfigPath}
					description={
						<span
							className="font-mono text-[11px] break-all cursor-pointer hover:text-text-primary transition-colors"
							onClick={() => {
								if (config?.globalConfigPath) {
									onOpenFilePath(config.globalConfigPath);
								}
							}}
						>
							{config?.globalConfigPath
								? formatPathForDisplay(config.globalConfigPath)
								: "~/.cline/kanban/config.json"}
							{config?.globalConfigPath ? <ExternalLink size={10} className="inline ml-1 align-middle" /> : null}
						</span>
					}
				/>
				{config?.projectConfigPath ? (
					<SettingRow
						label="Project config"
						noBorder
						description={
							<span
								className="font-mono text-[11px] break-all cursor-pointer hover:text-text-primary transition-colors"
								onClick={() => {
									if (config.projectConfigPath) {
										onOpenFilePath(config.projectConfigPath);
									}
								}}
							>
								{formatPathForDisplay(config.projectConfigPath)}
								<ExternalLink size={10} className="inline ml-1 align-middle" />
							</span>
						}
					/>
				) : null}
			</SettingSection>
		</div>
	);
}
