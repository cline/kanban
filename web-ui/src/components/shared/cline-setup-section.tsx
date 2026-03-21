import { useMemo, type ReactElement } from "react";
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, ExternalLink, Plus, X } from "lucide-react";

import { SearchSelectDropdown, type SearchSelectOption } from "@/components/search-select-dropdown";
import { Button } from "@/components/ui/button";
import type { RuntimeClineMcpServer } from "@/runtime/types";
import type { UseRuntimeSettingsClineControllerResult } from "@/hooks/use-runtime-settings-cline-controller";
import type { UseRuntimeSettingsClineMcpControllerResult } from "@/hooks/use-runtime-settings-cline-mcp-controller";
import { toFileUrl } from "@/utils/file-url";

function formatExpiry(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return trimmed;
	}

	if (!Number.isNaN(Number(value))) {
		const ms = Number(trimmed) * 1000;
		const date = new Date(ms);
		if (!Number.isNaN(date.getTime())) {
			return date.toLocaleString();
		}
		return trimmed;
	}

	const parsed = new Date(trimmed);
	if (!Number.isNaN(parsed.getTime())) {
		return parsed.toLocaleString();
	}

	return trimmed;
}

export function ClineSetupSection({
	controller,
	mcpController,
	controlsDisabled,
	showHeading = true,
	showMcpSettings = true,
	onError,
	onSaved,
}: {
	controller: UseRuntimeSettingsClineControllerResult;
	mcpController?: UseRuntimeSettingsClineMcpControllerResult;
	controlsDisabled: boolean;
	showHeading?: boolean;
	showMcpSettings?: boolean;
	onError?: (message: string | null) => void;
	onSaved?: () => void;
}): ReactElement {
	const mcpControlsDisabled = controlsDisabled || (mcpController?.isSavingMcpSettings ?? false);

	const clineProviderOptions = useMemo((): SearchSelectOption[] => {
		const items: SearchSelectOption[] = controller.providerCatalog.map((provider) => ({
			value: provider.id,
			label: provider.name,
		}));
		const trimmedId = controller.providerId.trim();
		if (
			trimmedId.length > 0 &&
			!controller.providerCatalog.some(
				(provider) => provider.id.trim().toLowerCase() === controller.normalizedProviderId,
			)
		) {
			items.push({ value: trimmedId, label: `${trimmedId} (custom)` });
		}
		return items;
	}, [controller.providerCatalog, controller.providerId, controller.normalizedProviderId]);

	const clineModelOptions = useMemo(
		(): SearchSelectOption[] =>
			controller.providerModels.map((model) => ({
				value: model.id,
				label: model.name,
			})),
		[controller.providerModels],
	);

	const handleAddMcpServer = () => {
		if (!mcpController) {
			return;
		}
		mcpController.setMcpServers((current) => [
			...current,
			{
				name: "",
				disabled: false,
				transport: {
					type: "streamableHttp",
					url: "",
				},
			},
		]);
	};

	const updateMcpServer = (
		serverIndex: number,
		updater: (server: RuntimeClineMcpServer) => RuntimeClineMcpServer,
	) => {
		if (!mcpController) {
			return;
		}
		mcpController.setMcpServers((current) =>
			current.map((server, index) => (index === serverIndex ? updater(server) : server)),
		);
	};

	const removeMcpServer = (serverIndex: number) => {
		if (!mcpController) {
			return;
		}
		mcpController.setMcpServers((current) => current.filter((_, index) => index !== serverIndex));
	};

	const handleOauthLogin = () => {
		void (async () => {
			onError?.(null);
			const result = await controller.runOauthLogin();
			if (!result.ok) {
				onError?.(result.message ?? "OAuth login failed.");
				return;
			}
			onSaved?.();
		})();
	};

	const handleMcpServerOauth = (serverName: string) => {
		void (async () => {
			if (!mcpController) {
				return;
			}
			onError?.(null);
			const result = await mcpController.runMcpServerOauth(serverName);
			if (!result.ok) {
				onError?.(result.message ?? `Failed to authorize MCP server "${serverName}".`);
				return;
			}
			onSaved?.();
		})();
	};

	return (
		<>
			{showHeading ? <h6 className="font-semibold text-text-primary mt-4 mb-2">Cline setup</h6> : null}
			<div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
				<div className="min-w-0">
					<p className="text-text-secondary text-[12px] mt-0 mb-1">Provider</p>
					<SearchSelectDropdown
						options={clineProviderOptions}
						selectedValue={controller.providerId}
						onSelect={(value) => controller.setProviderId(value)}
						disabled={controlsDisabled || controller.isLoadingProviderCatalog}
						fill
						size="sm"
						buttonText={
							controller.isLoadingProviderCatalog
								? "Loading providers..."
								: clineProviderOptions.find((option) => option.value === controller.providerId)?.label
						}
						emptyText="Select provider"
						noResultsText="No matching providers"
						placeholder="Search providers..."
						showSelectedIndicator
					/>
				</div>
				<div className="min-w-0">
					<p className="text-text-secondary text-[12px] mt-0 mb-1">Model</p>
					<SearchSelectDropdown
						options={clineModelOptions}
						selectedValue={controller.modelId}
						onSelect={(value) => controller.setModelId(value)}
						disabled={controlsDisabled || controller.isLoadingProviderModels}
						fill
						size="sm"
						buttonText={
							controller.isLoadingProviderModels
								? "Loading models..."
								: clineModelOptions.find((option) => option.value === controller.modelId)?.label
						}
						emptyText="Select model"
						noResultsText="No matching models"
						placeholder="Search models..."
						showSelectedIndicator
					/>
				</div>
			</div>
			{controller.isLoadingProviderCatalog || controller.isLoadingProviderModels ? (
				<p className="text-text-secondary text-[12px] mt-1 mb-0">
					{controller.isLoadingProviderCatalog ? "Fetching Cline providers..." : "Fetching Cline models..."}
				</p>
			) : null}
			<p className="text-text-secondary text-[12px] mt-1 mb-0">
				Authentication: {controller.isOauthProviderSelected ? "OAuth" : "API key"}
			</p>
			<div className="grid gap-2 mt-1" style={{ gridTemplateColumns: controller.isOauthProviderSelected ? "1fr" : "1fr 1fr" }}>
				{controller.isOauthProviderSelected ? null : (
					<div className="min-w-0">
						<p className="text-text-secondary text-[12px] mt-0 mb-1">API key</p>
						<input
							type="password"
							value={controller.apiKey}
							onChange={(event) => controller.setApiKey(event.target.value)}
							placeholder={controller.apiKeyConfigured ? "Saved" : "Enter API key"}
							disabled={controlsDisabled}
							className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
					</div>
				)}
				{controller.isOauthProviderSelected ? null : (
					<div className="min-w-0">
						<p className="text-text-secondary text-[12px] mt-0 mb-1">Base URL</p>
						<input
							value={controller.baseUrl}
							onChange={(event) => controller.setBaseUrl(event.target.value)}
							placeholder="https://api.cline.bot"
							disabled={controlsDisabled}
							className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
					</div>
				)}
			</div>
			{controller.isOauthProviderSelected ? (
				<>
					<p className="text-text-secondary text-[12px] mt-1 mb-0">
						Status: {controller.oauthConfigured ? "Signed in" : "Not signed in"}
					</p>
					{controller.oauthAccountId ? (
						<p className="text-text-secondary text-[12px] mt-1 mb-0">
							Account ID: <span className="text-text-primary">{controller.oauthAccountId}</span>
						</p>
					) : null}
					{controller.oauthExpiresAt ? (
						<p className="text-text-secondary text-[12px] mt-1 mb-0">
							Expiry: <span className="text-text-primary">{formatExpiry(controller.oauthExpiresAt)}</span>
						</p>
					) : null}
					<div className="mt-2">
						<Button
							variant="default"
							size="sm"
							disabled={controlsDisabled || controller.isRunningOauthLogin}
							onClick={handleOauthLogin}
						>
							{controller.isRunningOauthLogin
								? "Signing in..."
								: controller.oauthConfigured
									? `Sign in again with ${controller.managedOauthProvider ?? "OAuth"}`
									: `Sign in with ${controller.managedOauthProvider ?? "OAuth"}`}
						</Button>
					</div>
				</>
			) : null}

			{showHeading && mcpController && showMcpSettings ? (
				<>
					<div className="flex items-center justify-between mt-4 mb-2">
						<h6 className="font-semibold text-text-primary m-0">MCP servers</h6>
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
					<p className="text-text-secondary text-[12px] mt-0 mb-2">
						Configure Cline MCP servers for tool integrations.
					</p>
					{mcpController.mcpSettingsPath ? (
						<p
							className="text-text-secondary font-mono text-xs mt-0 mb-2 break-all"
							style={{ cursor: "pointer" }}
							onClick={() => {
								window.open(toFileUrl(mcpController.mcpSettingsPath));
							}}
						>
							{mcpController.mcpSettingsPath}
							<ExternalLink size={12} className="inline ml-1.5 align-middle" />
						</p>
					) : null}

					{mcpController.isLoadingMcpSettings ? (
						<p className="text-text-secondary text-[12px] mt-1 mb-0">Loading MCP settings...</p>
					) : null}

					{!mcpController.isLoadingMcpSettings && mcpController.mcpServers.length === 0 ? (
						<p className="text-text-secondary text-[12px] mt-1 mb-0">No MCP servers configured.</p>
					) : null}

					{mcpController.mcpServers.map((server, serverIndex) => {
						const authStatus = mcpController.mcpAuthStatusByServerName[server.name];
						const oauthSupported = server.transport.type !== "stdio";
						const oauthConfigured = authStatus?.oauthConfigured ?? false;
						const isAuthenticating = mcpController.authenticatingMcpServerName === server.name;

						return (
						<div key={serverIndex} className="flex items-start gap-2 mt-2">
							<div className="rounded-md border border-border p-2 flex-1 min-w-0">
							<div className="grid gap-2" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
								<div className="min-w-0">
									<p className="text-text-secondary text-[12px] mt-0 mb-1">Server name</p>
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
									<p className="text-text-secondary text-[12px] mt-0 mb-1">Transport</p>
									<select
										value={server.transport.type}
										onChange={(event) => {
											const nextType = event.target.value as RuntimeClineMcpServer["transport"]["type"];
											updateMcpServer(serverIndex, (current) => {
												if (nextType === "stdio") {
													return {
														...current,
														transport: {
															type: "stdio",
															command: "",
														},
													};
												}
												return {
													...current,
													transport: {
														type: nextType,
														url: "",
													},
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

							{server.transport.type === "stdio" ? (
								<div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
									<div className="min-w-0">
										<p className="text-text-secondary text-[12px] mt-0 mb-1">Command</p>
										<input
											value={server.transport.command}
											onChange={(event) => {
												updateMcpServer(serverIndex, (current) => {
													if (current.transport.type !== "stdio") {
														return current;
													}
													return {
														...current,
														transport: {
															...current.transport,
															command: event.target.value,
														},
													};
												});
											}}
											placeholder="Command"
											disabled={mcpControlsDisabled}
											className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
										/>
									</div>
									<div className="min-w-0">
										<p className="text-text-secondary text-[12px] mt-0 mb-1">Arguments</p>
										<input
											value={(server.transport.args ?? []).join(" ")}
											onChange={(event) => {
												updateMcpServer(serverIndex, (current) => {
													if (current.transport.type !== "stdio") {
														return current;
													}
													return {
														...current,
														transport: {
															...current.transport,
															args: event.target.value
																.split(/\s+/)
																.map((value) => value.trim())
																.filter((value) => value.length > 0),
														},
													};
												});
											}}
											placeholder="Args"
											disabled={mcpControlsDisabled}
											className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
										/>
									</div>
									<div className="min-w-0" style={{ gridColumn: "1 / -1" }}>
										<p className="text-text-secondary text-[12px] mt-0 mb-1">Working directory</p>
										<input
											value={server.transport.cwd ?? ""}
											onChange={(event) => {
												updateMcpServer(serverIndex, (current) => {
													if (current.transport.type !== "stdio") {
														return current;
													}
													return {
														...current,
														transport: {
															...current.transport,
															cwd: event.target.value,
														},
													};
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
									<p className="text-text-secondary text-[12px] mt-0 mb-1">URL</p>
									<input
										value={server.transport.url}
										onChange={(event) => {
											updateMcpServer(serverIndex, (current) => {
												if (current.transport.type === "stdio") {
													return current;
												}
												return {
													...current,
													transport: {
														...current.transport,
														url: event.target.value,
													},
												};
											});
										}}
										placeholder="https://example.com/mcp"
										disabled={mcpControlsDisabled}
										className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
									/>
								</div>
							)}

							{oauthSupported ? (
								<div className="mt-2">
									<p className="text-text-secondary text-[12px] mt-0 mb-1">
										OAuth: <span className="text-text-primary">{oauthConfigured ? "Connected" : "Not connected"}</span>
									</p>
									{authStatus?.lastError ? (
										<p className="text-status-red text-[12px] mt-0 mb-1">{authStatus.lastError}</p>
									) : null}
									<Button
										variant="default"
										size="sm"
										disabled={mcpControlsDisabled || isAuthenticating}
										onClick={() => {
											handleMcpServerOauth(server.name);
										}}
									>
										{isAuthenticating ? "Connecting OAuth..." : oauthConfigured ? "Reconnect OAuth" : "Connect OAuth"}
									</Button>
								</div>
							) : null}

							<div className="flex items-center gap-2 text-[12px] text-text-primary mt-2">
								<RadixCheckbox.Root
									checked={server.disabled}
									disabled={mcpControlsDisabled}
									onCheckedChange={(checked) => {
										updateMcpServer(serverIndex, (current) => ({
											...current,
											disabled: checked === true,
										}));
									}}
									className="flex h-4 w-4 items-center justify-center rounded border border-border bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:opacity-40"
								>
									<RadixCheckbox.Indicator>
										<Check size={12} className="text-white" />
									</RadixCheckbox.Indicator>
								</RadixCheckbox.Root>
								<span>Disabled</span>
							</div>
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
				</>
			) : null}
		</>
	);
}
