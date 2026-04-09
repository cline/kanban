import * as RadixSwitch from "@radix-ui/react-switch";
import { getRuntimeAgentCatalogEntry } from "@runtime-agent-catalog";
import { Circle, CircleDot } from "lucide-react";
import type { ReactElement } from "react";
import { SettingRow } from "@/components/settings/setting-row";
import { SettingSection } from "@/components/settings/setting-section";
import { AccountOrganizationSection } from "@/components/shared/account-organization-section";
import { ClineSetupSection } from "@/components/shared/cline-setup-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { UseRuntimeSettingsClineControllerResult } from "@/hooks/use-runtime-settings-cline-controller";
import type { UseRuntimeSettingsClineMcpControllerResult } from "@/hooks/use-runtime-settings-cline-mcp-controller";
import type { RuntimeAgentId } from "@/runtime/types";

export interface AgentRowModel {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	command: string;
	installed: boolean | null;
}

function AgentRow({
	agent,
	isSelected,
	onSelect,
	disabled,
}: {
	agent: AgentRowModel;
	isSelected: boolean;
	onSelect: () => void;
	disabled: boolean;
}): ReactElement {
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
			className={cn(
				"flex items-center justify-between gap-3 px-4 py-3 border-b border-border/40 last:border-b-0 transition-colors",
				isInstalled && !disabled ? "cursor-pointer hover:bg-surface-2" : "cursor-default",
			)}
		>
			<div className="flex items-start gap-2.5 min-w-0">
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
						<span className="text-[13px] text-text-primary font-medium">{agent.label}</span>
						{!isNativeCline && isInstalled ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-status-green/10 text-status-green">
								Installed
							</span>
						) : isInstallStatusPending ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface-3 text-text-secondary">
								Checking…
							</span>
						) : null}
					</div>
					{agent.command ? (
						<p className="text-text-tertiary font-mono text-[11px] mt-0.5 m-0">{agent.command}</p>
					) : null}
				</div>
			</div>
			{!isNativeCline && agent.installed === false && installUrl ? (
				<a
					href={installUrl}
					target="_blank"
					rel="noreferrer"
					onClick={(event: React.MouseEvent) => event.stopPropagation()}
					className="inline-flex items-center justify-center rounded-md font-medium cursor-default select-none h-7 px-2 text-xs bg-surface-2 border border-border text-text-primary hover:bg-surface-3 hover:border-border-bright"
				>
					Install
				</a>
			) : !isNativeCline && agent.installed === false ? (
				<Button size="sm" disabled>
					Install
				</Button>
			) : null}
		</div>
	);
}

export function AgentPanel({
	displayedAgents,
	selectedAgentId,
	onSelectAgent,
	agentAutonomousModeEnabled,
	onAutonomousModeChange,
	clineSettings,
	clineMcpSettings,
	workspaceId,
	open,
	onAccountSwitched,
	controlsDisabled,
	configLoaded,
	onError,
}: {
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
	controlsDisabled: boolean;
	configLoaded: boolean;
	onError: (message: string | null) => void;
}): ReactElement {
	return (
		<div>
			<div className="sticky top-[-20px] -mx-5 px-5 -mt-5 pt-5 pb-3 mb-4 bg-surface-1 z-10">
				<h2 className="text-base font-semibold text-text-primary m-0 mb-1">Agent</h2>
				<p className="text-[12px] text-text-secondary m-0">
					Choose which coding agent to use and configure its settings.
				</p>
			</div>

			<SettingSection title="Select agent" noCard>
				<div className="rounded-lg border border-border bg-surface-0 overflow-clip">
					{displayedAgents.map((agent) => (
						<AgentRow
							key={agent.id}
							agent={agent}
							isSelected={agent.id === selectedAgentId}
							onSelect={() => onSelectAgent(agent.id)}
							disabled={controlsDisabled}
						/>
					))}
				</div>
				{!configLoaded ? (
					<p className="text-text-secondary text-[12px] py-2 m-0">
						Checking which CLIs are installed for this project…
					</p>
				) : null}
			</SettingSection>

			<SettingSection title="Permissions">
				<SettingRow
					label="Bypass permission prompts"
					description="Allows agents to use tools without stopping for permission. Use at your own risk."
					control={
						<RadixSwitch.Root
							aria-label="Enable bypass permissions flag"
							checked={agentAutonomousModeEnabled}
							disabled={controlsDisabled}
							onCheckedChange={(checked) => onAutonomousModeChange(checked === true)}
							className="relative h-5 w-9 rounded-full bg-surface-4 data-[state=checked]:bg-accent cursor-pointer disabled:opacity-40"
						>
							<RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform translate-x-0.5 data-[state=checked]:translate-x-[18px]" />
						</RadixSwitch.Root>
					}
					noBorder
				/>
			</SettingSection>

			{selectedAgentId === "cline" ? (
				<SettingSection title="Cline setup" noCard>
					<div className="pt-2">
						<ClineSetupSection
							controller={clineSettings}
							mcpController={clineMcpSettings}
							controlsDisabled={controlsDisabled}
							workspaceId={workspaceId}
							showHeading={false}
							showMcpSettings={false}
							accountSection={
								clineSettings.providerId.trim() === "cline" ? (
									<AccountOrganizationSection
										workspaceId={workspaceId}
										open={open}
										onAccountSwitched={onAccountSwitched}
									/>
								) : null
							}
							onError={onError}
						/>
					</div>
				</SettingSection>
			) : null}
		</div>
	);
}
