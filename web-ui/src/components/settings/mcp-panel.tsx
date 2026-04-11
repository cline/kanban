import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, ExternalLink, Plus, X } from "lucide-react";
import type { ReactElement } from "react";

import { SettingSection } from "@/components/settings/setting-section";
import { Button } from "@/components/ui/button";
import type { UseRuntimeSettingsClineMcpControllerResult } from "@/hooks/use-runtime-settings-cline-mcp-controller";
import { openFileOnHost } from "@/runtime/runtime-config-query";
import type { RuntimeClineMcpServer } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";

export function McpPanel({
	mcpController,
	workspaceId,
	controlsDisabled,
	onError,
}: {
	mcpController: UseRuntimeSettingsClineMcpControllerResult;
	workspaceId: string | null;
	controlsDisabled: boolean;
	onError: (message: string | null) => void;
}): ReactElement {
	const mcpControlsDisabled = controlsDisabled || mcpController.isSavingMcpSettings;

	const handleAddMcpServer = () => {
		mcpController.setMcpServers((current) => [
			...current,
			{
				name: "",
				disabled: false,
				type: "streamableHttp",
				url: "",
			},
		]);
	};

	const updateMcpServer = (serverIndex: number, updater: (server: RuntimeClineMcpServer) => RuntimeClineMcpServer) => {
		mcpController.setMcpServers((current) =>
			current.map((server, index) => (index === serverIndex ? updater(server) : server)),
		);
	};

	const removeMcpServer = (serverIndex: number) => {
		mcpController.setMcpServers((current) => current.filter((_, index) => index !== serverIndex));
	};

	const handleMcpServerOauth = (serverName: string) => {
		void (async () => {
			onError(null);
			const result = await mcpController.runMcpServerOauth(serverName);
			if (!result.ok) {
				onError(result.message ?? `Failed to authorize MCP server "${serverName}".`);
			}
		})();
	};

	const handleSetupLinearMcp = () => {
		void (async () => {
			onError(null);
			const result = await mcpController.linearMcpPreset?.setup();
			if (!result?.ok) {
				onError(result?.message ?? "Failed to set up Linear MCP.");
			}
		})();
	};

	const handleOpenFilePath = (filePath: string) => {
		onError(null);
		void openFileOnHost(workspaceId, filePath).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			onError(`Could not open file on host: ${message}`);
		});
	};

	return (
		<div>
			<div className="sticky top-[-20px] -mx-5 px-5 -mt-5 pt-5 pb-3 mb-4 bg-surface-1 z-10">
				<div className="flex items-center justify-between mb-1">
					<h2 className="text-base font-semibold text-text-primary m-0">MCP Servers</h2>
					<Button
						variant="ghost"
						size="sm"
						icon={<Plus size={14} />}
						disabled={mcpControlsDisabled || mcpController.isLoadingMcpSettings}
						onClick={handleAddMcpServer}
					>
						Add
					</Button>
				</div>
				<p className="text-[12px] text-text-secondary m-0">Configure Cline MCP servers for tool integrations.</p>
			</div>

			{mcpController.mcpSettingsPath ? (
				<p
					className="text-text-secondary font-mono text-[11px] mt-0 mb-3 break-all cursor-pointer hover:text-text-primary transition-colors"
					onClick={() => handleOpenFilePath(mcpController.mcpSettingsPath)}
				>
					{formatPathForDisplay(mcpController.mcpSettingsPath)}
					<ExternalLink size={10} className="inline ml-1 align-middle" />
				</p>
			) : null}

			{mcpController.linearMcpPreset && mcpController.linearMcpPreset.status !== "connected" ? (
				<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<p className="text-text-primary text-[13px] font-medium mt-0 mb-0.5">Linear</p>
							<p className="text-text-secondary text-[12px] mt-0 mb-0">
								Connect Linear for project management tools.
							</p>
						</div>
						<Button
							variant="primary"
							size="sm"
							disabled={
								mcpControlsDisabled ||
								mcpController.isLoadingMcpSettings ||
								mcpController.linearMcpPreset?.isSettingUp
							}
							onClick={handleSetupLinearMcp}
							className="shrink-0"
						>
							{mcpController.linearMcpPreset?.isSettingUp
								? "Setting up…"
								: mcpController.linearMcpPreset?.status === "configured"
									? "Connect"
									: "Set up"}
						</Button>
					</div>
				</div>
			) : null}

			{mcpController.isLoadingMcpSettings ? (
				<p className="text-text-secondary text-[12px] mt-1 mb-0">Loading MCP settings…</p>
			) : null}

			{!mcpController.isLoadingMcpSettings && mcpController.mcpServers.length === 0 ? (
				<SettingSection title="Servers">
					<p className="text-text-secondary text-[12px] px-4 py-3 m-0">No MCP servers configured.</p>
				</SettingSection>
			) : null}

			{mcpController.mcpServers.length > 0 ? (
				<SettingSection title="Servers" noCard>
					<div className="flex flex-col gap-3">
						{mcpController.mcpServers.map((server, serverIndex) => {
							const authStatus = mcpController.mcpAuthStatusByServerName[server.name];
							const oauthSupported = server.type !== "stdio";
							const oauthConfigured = authStatus?.oauthConfigured ?? false;
							const isAuthenticating = mcpController.authenticatingMcpServerName === server.name;

							return (
								<div key={serverIndex} className="flex items-start gap-2">
									<div className="rounded-lg border border-border bg-surface-0 p-3 flex-1 min-w-0">
										<div className="grid gap-2" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
											<div className="min-w-0">
												<p className="text-text-secondary text-[11px] mt-0 mb-1">Server name</p>
												<input
													value={server.name}
													onChange={(event) => {
														updateMcpServer(serverIndex, (current) => ({
															...current,
															name: event.target.value,
														}));
													}}
													placeholder="linear"
													disabled={mcpControlsDisabled}
													className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
												/>
											</div>
											<div className="min-w-0">
												<p className="text-text-secondary text-[11px] mt-0 mb-1">Transport</p>
												<select
													value={server.type}
													onChange={(event) => {
														const nextType = event.target.value as RuntimeClineMcpServer["type"];
														updateMcpServer(serverIndex, (current) => {
															if (nextType === "stdio") {
																return {
																	name: current.name,
																	disabled: current.disabled,
																	type: "stdio",
																	command: "",
																};
															}
															return {
																name: current.name,
																disabled: current.disabled,
																type: nextType,
																url: "",
															};
														});
													}}
													disabled={mcpControlsDisabled}
													className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary focus:border-border-focus focus:outline-none"
												>
													<option value="streamableHttp">HTTP</option>
													<option value="sse">SSE</option>
													<option value="stdio">Stdio</option>
												</select>
											</div>
										</div>

										{server.type === "stdio" ? (
											<div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
												<div className="min-w-0">
													<p className="text-text-secondary text-[11px] mt-0 mb-1">Command</p>
													<input
														value={server.command}
														onChange={(event) => {
															updateMcpServer(serverIndex, (current) => {
																if (current.type !== "stdio") return current;
																return { ...current, command: event.target.value };
															});
														}}
														placeholder="Command"
														disabled={mcpControlsDisabled}
														className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
													/>
												</div>
												<div className="min-w-0">
													<p className="text-text-secondary text-[11px] mt-0 mb-1">Arguments</p>
													<input
														value={(server.args ?? []).join(" ")}
														onChange={(event) => {
															updateMcpServer(serverIndex, (current) => {
																if (current.type !== "stdio") return current;
																return {
																	...current,
																	args: event.target.value
																		.split(/\s+/)
																		.map((v) => v.trim())
																		.filter((v) => v.length > 0),
																};
															});
														}}
														placeholder="Args"
														disabled={mcpControlsDisabled}
														className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
													/>
												</div>
												<div className="min-w-0" style={{ gridColumn: "1 / -1" }}>
													<p className="text-text-secondary text-[11px] mt-0 mb-1">Working directory</p>
													<input
														value={server.cwd ?? ""}
														onChange={(event) => {
															updateMcpServer(serverIndex, (current) => {
																if (current.type !== "stdio") return current;
																return { ...current, cwd: event.target.value };
															});
														}}
														placeholder="Working directory (optional)"
														disabled={mcpControlsDisabled}
														className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
													/>
												</div>
											</div>
										) : (
											<div className="min-w-0 mt-2">
												<p className="text-text-secondary text-[11px] mt-0 mb-1">URL</p>
												<input
													value={server.url}
													onChange={(event) => {
														updateMcpServer(serverIndex, (current) => {
															if (current.type === "stdio") return current;
															return { ...current, url: event.target.value };
														});
													}}
													placeholder="https://example.com/mcp"
													disabled={mcpControlsDisabled}
													className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
												/>
											</div>
										)}

										{oauthSupported ? (
											<div className="mt-2 pt-2 border-t border-border/50">
												<p className="text-text-secondary text-[11px] mt-0 mb-1">
													OAuth:{" "}
													<span className="text-text-primary">
														{oauthConfigured ? "Connected" : "Not connected"}
													</span>
												</p>
												{authStatus?.lastError ? (
													<p className="text-status-red text-[11px] mt-0 mb-1">{authStatus.lastError}</p>
												) : null}
												<Button
													variant="default"
													size="sm"
													disabled={mcpControlsDisabled || isAuthenticating}
													onClick={() => handleMcpServerOauth(server.name)}
												>
													{isAuthenticating
														? "Connecting…"
														: oauthConfigured
															? "Reconnect"
															: "Connect OAuth"}
												</Button>
											</div>
										) : null}

										<label
											htmlFor={`mcp-disabled-v2-${serverIndex}`}
											className="flex items-center gap-2 text-[12px] text-text-primary mt-2.5 cursor-pointer select-none"
										>
											<RadixCheckbox.Root
												id={`mcp-disabled-v2-${serverIndex}`}
												checked={server.disabled}
												disabled={mcpControlsDisabled}
												onCheckedChange={(checked) => {
													updateMcpServer(serverIndex, (current) => ({
														...current,
														disabled: checked === true,
													}));
												}}
												className="flex h-4 w-4 cursor-pointer items-center justify-center rounded border border-border bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
											>
												<RadixCheckbox.Indicator>
													<Check size={12} className="text-white" />
												</RadixCheckbox.Indicator>
											</RadixCheckbox.Root>
											<span>Disabled</span>
										</label>
									</div>
									<Button
										variant="ghost"
										size="sm"
										icon={<X size={14} />}
										aria-label={`Remove MCP server ${server.name || serverIndex + 1}`}
										disabled={mcpControlsDisabled}
										onClick={() => removeMcpServer(serverIndex)}
									/>
								</div>
							);
						})}
					</div>
				</SettingSection>
			) : null}
		</div>
	);
}
