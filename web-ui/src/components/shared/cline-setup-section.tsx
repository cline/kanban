import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, Copy, ExternalLink, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
	buildClineAgentModelPickerOptions,
	CLINE_REASONING_EFFORT_OPTIONS,
} from "@/components/detail-panels/cline-model-picker-options";
import { SearchSelectDropdown, type SearchSelectOption } from "@/components/search-select-dropdown";
import {
	ClineAddProviderDialog,
	type ClineProviderDialogInitialValues,
	type ClineProviderDialogMode,
} from "@/components/shared/cline-add-provider-dialog";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Tooltip } from "@/components/ui/tooltip";
import type {
	AddClineProviderInput,
	UpdateClineProviderInput,
	UseRuntimeSettingsClineControllerResult,
} from "@/hooks/use-runtime-settings-cline-controller";
import type { UseRuntimeSettingsClineMcpControllerResult } from "@/hooks/use-runtime-settings-cline-mcp-controller";
import { useI18n } from "@/i18n/i18n-context";
import { openFileOnHost } from "@/runtime/runtime-config-query";
import type { RuntimeClineMcpServer, RuntimeClineReasoningEffort } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";
import { useCopyToClipboard } from "@/utils/react-use";

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
	workspaceId = null,
	showMcpSettings = true,
	accountSection = null,
	onError,
	onSaved,
}: {
	controller: UseRuntimeSettingsClineControllerResult;
	mcpController?: UseRuntimeSettingsClineMcpControllerResult;
	controlsDisabled: boolean;
	workspaceId?: string | null;
	showMcpSettings?: boolean;
	accountSection?: ReactNode;
	onError?: (message: string | null) => void;
	onSaved?: () => void;
}): ReactElement {
	const { t } = useI18n();
	const mcpControlsDisabled = controlsDisabled || (mcpController?.isSavingMcpSettings ?? false);
	const [isAddProviderDialogOpen, setIsAddProviderDialogOpen] = useState(false);
	const [providerDialogMode, setProviderDialogMode] = useState<ClineProviderDialogMode>("add");
	const [isDeviceCodeCopied, setIsDeviceCodeCopied] = useState(false);
	const deviceCodeCopiedResetTimerRef = useRef<number | null>(null);
	const [copiedDeviceCodeState, copyDeviceCode] = useCopyToClipboard();

	useEffect(() => {
		return () => {
			if (deviceCodeCopiedResetTimerRef.current !== null) {
				window.clearTimeout(deviceCodeCopiedResetTimerRef.current);
				deviceCodeCopiedResetTimerRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		setIsDeviceCodeCopied(false);
	}, [controller.deviceAuthInfo?.userCode]);

	useEffect(() => {
		if (!copiedDeviceCodeState.value || copiedDeviceCodeState.value !== controller.deviceAuthInfo?.userCode) {
			return;
		}
		if (copiedDeviceCodeState.error) {
			onError?.(t("cline.error.copyCode"));
			setIsDeviceCodeCopied(false);
			return;
		}
		onError?.(null);
		setIsDeviceCodeCopied(true);
		if (deviceCodeCopiedResetTimerRef.current !== null) {
			window.clearTimeout(deviceCodeCopiedResetTimerRef.current);
		}
		deviceCodeCopiedResetTimerRef.current = window.setTimeout(() => {
			setIsDeviceCodeCopied(false);
			deviceCodeCopiedResetTimerRef.current = null;
		}, 2000);
	}, [copiedDeviceCodeState, controller.deviceAuthInfo?.userCode, onError, t]);

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

	const modelPickerOptions = useMemo(
		() => buildClineAgentModelPickerOptions(controller.providerId, controller.providerModels),
		[controller.providerId, controller.providerModels],
	);
	const clineModelOptions = modelPickerOptions.options;
	const reasoningEffortOptions = useMemo(
		() =>
			CLINE_REASONING_EFFORT_OPTIONS.map((option) => ({
				...option,
				label:
					option.value === ""
						? t("cline.reasoning.default")
						: option.value === "low"
							? t("cline.reasoning.low")
							: option.value === "medium"
								? t("cline.reasoning.medium")
								: option.value === "high"
									? t("cline.reasoning.high")
									: t("cline.reasoning.xhigh"),
			})),
		[t],
	);
	const selectedProvider = useMemo(
		() =>
			controller.providerCatalog.find(
				(provider) => provider.id.trim().toLowerCase() === controller.normalizedProviderId,
			) ?? null,
		[controller.normalizedProviderId, controller.providerCatalog],
	);
	const apiKeyPlaceholder = controller.apiKeyConfigured ? t("cline.apiKeySaved") : t("cline.apiKeyPlaceholder");
	const providerEnvHint = (selectedProvider?.env ?? [])
		.map((value) => value.trim())
		.filter((value) => value.length > 0)
		.join(", ");
	const shouldShowBaseUrlField =
		!controller.isOauthProviderSelected &&
		(selectedProvider?.supportsBaseUrl ?? controller.baseUrl.trim().length > 0);
	const isBedrockProvider = controller.normalizedProviderId === "bedrock";
	const isVertexProvider = controller.normalizedProviderId === "vertex";
	const selectedProviderOption = useMemo(
		() => clineProviderOptions.find((option) => option.value === controller.providerId) ?? null,
		[clineProviderOptions, controller.providerId],
	);
	const canEditSelectedProvider = controller.providerId.trim().length > 0 && !controller.isOauthProviderSelected;
	const selectedProviderEditInitialValues = useMemo((): ClineProviderDialogInitialValues | null => {
		if (!canEditSelectedProvider) {
			return null;
		}
		const fallbackProviderId = controller.providerId.trim();
		const fallbackProviderName = selectedProviderOption?.label.replace(/\s+\(custom\)$/i, "") || fallbackProviderId;
		const modelIds = controller.providerModels.map((model) => model.id);
		const normalizedModelIds =
			modelIds.length > 0 ? modelIds : controller.modelId.trim().length > 0 ? [controller.modelId.trim()] : [];
		return {
			providerId: selectedProvider?.id ?? fallbackProviderId,
			name: selectedProvider?.name ?? fallbackProviderName,
			baseUrl: controller.baseUrl.trim() || selectedProvider?.baseUrl?.trim() || "",
			models: normalizedModelIds,
			defaultModelId: controller.modelId.trim() || selectedProvider?.defaultModelId?.trim() || "",
		};
	}, [
		canEditSelectedProvider,
		controller.baseUrl,
		controller.modelId,
		controller.providerId,
		controller.providerModels,
		selectedProvider,
		selectedProviderOption,
	]);

	const handleAddMcpServer = () => {
		if (!mcpController) {
			return;
		}
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
				onError?.(result.message ?? t("cline.error.oauthLogin"));
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
				onError?.(result.message ?? t("cline.error.authorizeMcp", { serverName }));
				return;
			}
			onSaved?.();
		})();
	};

	const handleSetupLinearMcp = () => {
		void (async () => {
			if (!mcpController) {
				return;
			}
			onError?.(null);
			const result = await mcpController.linearMcpPreset.setup();
			if (!result.ok) {
				onError?.(result.message ?? t("cline.error.setupLinear"));
				return;
			}
			onSaved?.();
		})();
	};

	const handleOpenFilePath = (filePath: string) => {
		onError?.(null);
		void openFileOnHost(workspaceId, filePath).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			onError?.(t("settings.error.openFile", { message }));
		});
	};

	const handleCopyDeviceCode = (code: string) => {
		setIsDeviceCodeCopied(false);
		onError?.(null);
		copyDeviceCode(code);
	};

	const handleRefreshProviderModels = () => {
		void (async () => {
			onError?.(null);
			const result = await controller.refreshProviderModels();
			if (!result.ok) {
				onError?.(result.message ?? t("cline.error.refreshModels"));
				return;
			}
		})();
	};

	return (
		<>
			<div className="mt-2">
				<p className="text-text-primary font-semibold text-[12px] mt-0 mb-2">{t("cline.apiProvider")}</p>
				<div className="min-w-0 w-1/2 max-w-full">
					<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
						<div className="min-w-0">
							<SearchSelectDropdown
								options={clineProviderOptions}
								selectedValue={controller.providerId}
								onSelect={(value) => {
									const normalizedProviderId = value.trim().toLowerCase();
									if (normalizedProviderId === controller.normalizedProviderId) {
										return;
									}
									controller.setProviderId(value);
									const selectedProvider =
										controller.providerCatalog.find(
											(provider) => provider.id.trim().toLowerCase() === normalizedProviderId,
										) ?? null;
									const defaultModelId = selectedProvider?.defaultModelId?.trim() ?? "";
									const defaultBaseUrl = selectedProvider?.baseUrl?.trim() ?? "";
									controller.setModelId(defaultModelId);
									controller.setBaseUrl(defaultBaseUrl);
								}}
								disabled={controlsDisabled || controller.isLoadingProviderCatalog}
								fill
								size="sm"
								buttonText={
									controller.isLoadingProviderCatalog
										? t("cline.loadingProviders")
										: clineProviderOptions.find((option) => option.value === controller.providerId)?.label
								}
								emptyText={t("cline.selectProvider")}
								noResultsText={t("cline.noMatchingProviders")}
								placeholder={t("cline.searchProviders")}
								showSelectedIndicator
								footerAction={{
									label: t("cline.newProvider"),
									onClick: () => {
										onError?.(null);
										setProviderDialogMode("add");
										setIsAddProviderDialogOpen(true);
									},
								}}
							/>
						</div>
						{canEditSelectedProvider && (
							<Button
								variant="ghost"
								size="sm"
								icon={<Pencil size={14} />}
								disabled={controlsDisabled}
								className="shrink-0"
								onClick={() => {
									onError?.(null);
									setProviderDialogMode("edit");
									setIsAddProviderDialogOpen(true);
								}}
							>
								{t("common.edit")}
							</Button>
						)}
					</div>
				</div>
				{controller.isLoadingProviderCatalog ? (
					<p className="text-text-secondary text-[12px] mt-1 mb-0">{t("cline.fetchingProviders")}</p>
				) : null}
				<div
					className="grid gap-2 mt-3"
					style={{ gridTemplateColumns: controller.isOauthProviderSelected ? "1fr" : "1fr 1fr" }}
				>
					{controller.isOauthProviderSelected ? null : (
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.apiKey")}</p>
							<input
								type="password"
								value={controller.apiKey}
								onChange={(event) => controller.setApiKey(event.target.value)}
								placeholder={apiKeyPlaceholder}
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
							{providerEnvHint ? (
								<p className="text-text-tertiary text-[11px] mt-1 mb-0 break-all">
									{t("cline.providerEnvHint", { env: providerEnvHint })}
								</p>
							) : null}
						</div>
					)}
					{shouldShowBaseUrlField ? (
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.baseUrl")}</p>
							<input
								value={controller.baseUrl}
								onChange={(event) => controller.setBaseUrl(event.target.value)}
								placeholder="https://api.cline.bot"
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
					) : null}
				</div>
				{isBedrockProvider ? (
					<div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.awsRegion")}</p>
							<input
								value={controller.awsRegion}
								onChange={(event) => controller.setAwsRegion(event.target.value)}
								placeholder="us-east-1"
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.authMode")}</p>
							<NativeSelect
								fill
								value={controller.awsAuthentication}
								onChange={(event) =>
									controller.setAwsAuthentication(event.target.value as "" | "iam" | "api-key" | "profile")
								}
								disabled={controlsDisabled}
							>
								<option value="">{t("cline.authMode.auto")}</option>
								<option value="iam">IAM</option>
								<option value="api-key">{t("cline.authMode.accessKeys")}</option>
								<option value="profile">{t("cline.authMode.profile")}</option>
							</NativeSelect>
						</div>
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.awsProfile")}</p>
							<input
								value={controller.awsProfile}
								onChange={(event) => controller.setAwsProfile(event.target.value)}
								placeholder="default"
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.bedrockEndpoint")}</p>
							<input
								value={controller.awsEndpoint}
								onChange={(event) => controller.setAwsEndpoint(event.target.value)}
								placeholder="https://bedrock-runtime.us-east-1.amazonaws.com"
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.awsAccessKey")}</p>
							<input
								type="password"
								value={controller.awsAccessKey}
								onChange={(event) => controller.setAwsAccessKey(event.target.value)}
								placeholder="AKIA..."
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.awsSecretKey")}</p>
							<input
								type="password"
								value={controller.awsSecretKey}
								onChange={(event) => controller.setAwsSecretKey(event.target.value)}
								placeholder="••••••••"
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.awsSessionToken")}</p>
							<input
								type="password"
								value={controller.awsSessionToken}
								onChange={(event) => controller.setAwsSessionToken(event.target.value)}
								placeholder={t("common.optional")}
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
					</div>
				) : null}
				{isVertexProvider ? (
					<div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.gcpProjectId")}</p>
							<input
								value={controller.gcpProjectId}
								onChange={(event) => controller.setGcpProjectId(event.target.value)}
								placeholder="my-gcp-project"
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
						<div className="min-w-0">
							<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.gcpRegion")}</p>
							<input
								value={controller.gcpRegion}
								onChange={(event) => controller.setGcpRegion(event.target.value)}
								placeholder="us-central1"
								disabled={controlsDisabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
					</div>
				) : null}
				{controller.isOauthProviderSelected ? (
					<>
						<p className="text-text-secondary text-[12px] mt-1 mb-0">
							{t("cline.status", {
								status: controller.oauthConfigured ? t("cline.signedIn") : t("cline.notSignedIn"),
							})}
						</p>
						{controller.oauthAccountId ? (
							<p className="text-text-secondary text-[12px] mt-1 mb-0">
								{t("cline.accountId")} <span className="text-text-primary">{controller.oauthAccountId}</span>
							</p>
						) : null}
						{controller.oauthExpiresAt ? (
							<p className="text-text-secondary text-[12px] mt-1 mb-0">
								{t("cline.expiry")}{" "}
								<span className="text-text-primary">{formatExpiry(controller.oauthExpiresAt)}</span>
							</p>
						) : null}
						{controller.isRunningOauthLogin && controller.deviceAuthInfo ? (
							<div className="mt-2 rounded-md border border-border bg-surface-2 p-3">
								<p className="text-text-secondary text-[13px] font-medium mt-0 mb-2">
									{t("cline.signInTitle")}
								</p>
								<ol className="list-decimal pl-4 text-[12px] text-text-primary m-0">
									<li>
										{t("cline.goToUrl")}{" "}
										<a
											href={controller.deviceAuthInfo.verificationUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="break-all text-accent underline"
										>
											{controller.deviceAuthInfo.verificationUrl}
										</a>
									</li>
									<li className="mt-2">
										{t("cline.enterCode")}
										<div className="mt-1 flex items-center gap-2">
											<p className="text-text-primary text-[18px] font-mono font-bold tracking-wider m-0">
												{controller.deviceAuthInfo.userCode}
											</p>
											<Button
												variant="ghost"
												size="sm"
												icon={isDeviceCodeCopied ? <Check size={14} /> : <Copy size={14} />}
												onClick={() => {
													const userCode = controller.deviceAuthInfo?.userCode;
													if (!userCode) {
														return;
													}
													handleCopyDeviceCode(userCode);
												}}
												disabled={controlsDisabled || !controller.deviceAuthInfo}
											>
												{isDeviceCodeCopied ? t("common.copied") : t("common.copy")}
											</Button>
										</div>
									</li>
								</ol>
							</div>
						) : null}
						<div className="mt-2">
							<Button
								variant="default"
								size="sm"
								disabled={controlsDisabled || controller.isRunningOauthLogin}
								onClick={handleOauthLogin}
							>
								{controller.isRunningOauthLogin
									? controller.deviceAuthInfo
										? t("cline.waitingConfirmation")
										: t("cline.signingIn")
									: controller.oauthConfigured
										? t("cline.signInAgainWith", { provider: controller.managedOauthProvider ?? "OAuth" })
										: t("cline.signInWith", { provider: controller.managedOauthProvider ?? "OAuth" })}
							</Button>
						</div>
					</>
				) : null}
			</div>
			{accountSection ? <div className="mt-4">{accountSection}</div> : null}

			<div className="mt-4">
				<p className="text-text-primary font-semibold text-[12px] mt-0 mb-2">{t("cline.model")}</p>
				<div
					className="grid gap-2"
					style={{ gridTemplateColumns: controller.selectedModelSupportsReasoningEffort ? "1fr 1fr" : "1fr" }}
				>
					<div className="min-w-0">
						<div className="mb-1 flex items-center justify-between gap-2 h-7">
							<p className="text-text-secondary text-[12px] m-0">{t("cline.modelId")}</p>
							{shouldShowBaseUrlField ? (
								<Tooltip side="bottom" content={t("cline.saveAndRefreshModels")}>
									<Button
										variant="ghost"
										size="sm"
										icon={
											<RefreshCw
												size={14}
												className={controller.isLoadingProviderModels ? "animate-spin" : undefined}
											/>
										}
										aria-label={t("cline.saveAndRefreshModels")}
										disabled={
											controlsDisabled ||
											controller.isLoadingProviderModels ||
											controller.providerId.trim().length === 0
										}
										onClick={handleRefreshProviderModels}
									/>
								</Tooltip>
							) : null}
						</div>
						<SearchSelectDropdown
							options={clineModelOptions}
							selectedValue={controller.modelId}
							onSelect={(value) => controller.setModelId(value)}
							disabled={controlsDisabled || controller.isLoadingProviderModels}
							fill
							size="sm"
							buttonText={
								controller.isLoadingProviderModels
									? t("cline.loadingModels")
									: (clineModelOptions.find((option) => option.value === controller.modelId)?.label ??
											controller.modelId.trim()) ||
										undefined
							}
							emptyText={t("cline.selectModel")}
							noResultsText={t("cline.noMatchingModels")}
							placeholder={t("cline.searchModels")}
							showSelectedIndicator
							pinSelectedToTop={modelPickerOptions.shouldPinSelectedModelToTop}
							recommendedOptionValues={modelPickerOptions.recommendedModelIds}
							recommendedHeading={t("search.recommendedModels")}
							allowCustomValue
						/>
					</div>
					{controller.selectedModelSupportsReasoningEffort ? (
						<div className="min-w-0">
							<div className="mb-1 flex items-center h-7">
								<p className="text-text-secondary text-[12px] m-0">{t("cline.reasoningEffort")}</p>
							</div>
							<SearchSelectDropdown
								options={reasoningEffortOptions}
								selectedValue={controller.reasoningEffort}
								onSelect={(value) => controller.setReasoningEffort(value as RuntimeClineReasoningEffort | "")}
								disabled={controlsDisabled}
								fill
								size="sm"
								buttonText={
									reasoningEffortOptions.find((option) => option.value === controller.reasoningEffort)?.label
								}
								emptyText={t("cline.reasoning.default")}
								noResultsText={t("cline.noMatchingReasoning")}
								placeholder={t("cline.searchReasoning")}
								showSelectedIndicator
							/>
						</div>
					) : null}
				</div>
				{controller.isLoadingProviderModels ? (
					<p className="text-text-secondary text-[12px] mt-1 mb-0">{t("cline.fetchingModels")}</p>
				) : null}
			</div>

			{mcpController && showMcpSettings ? (
				<>
					<div className="flex items-center justify-between mt-4 mb-2">
						<h6 className="font-semibold text-[12px] text-text-primary m-0">{t("cline.mcpServers")}</h6>
						<Button
							variant="ghost"
							size="sm"
							icon={<Plus size={14} />}
							disabled={mcpControlsDisabled || mcpController.isLoadingMcpSettings}
							onClick={handleAddMcpServer}
						>
							{t("common.add")}
						</Button>
					</div>
					<p className="text-text-secondary text-[12px] mt-0 mb-2">{t("cline.mcpDescription")}</p>
					{mcpController.mcpSettingsPath ? (
						<p
							className="text-text-secondary font-mono text-xs mt-0 mb-2 break-all"
							style={{ cursor: "pointer" }}
							onClick={() => {
								handleOpenFilePath(mcpController.mcpSettingsPath);
							}}
						>
							{formatPathForDisplay(mcpController.mcpSettingsPath)}
							<ExternalLink size={12} className="inline ml-1.5 align-middle" />
						</p>
					) : null}
					{mcpController.linearMcpPreset.status !== "connected" ? (
						<div className="rounded-md border border-border bg-surface-1 px-3 py-2 mb-2">
							<div className="flex items-center justify-between gap-3">
								<div className="min-w-0">
									<p className="text-text-primary text-[13px] font-medium mt-0 mb-0.5">Linear</p>
									<p className="text-text-secondary text-[12px] mt-0 mb-0">{t("cline.linearDescription")}</p>
								</div>
								<Button
									variant="primary"
									size="sm"
									disabled={
										mcpControlsDisabled ||
										mcpController.isLoadingMcpSettings ||
										mcpController.linearMcpPreset.isSettingUp
									}
									onClick={handleSetupLinearMcp}
									className="shrink-0"
								>
									{mcpController.linearMcpPreset.isSettingUp
										? t("cline.settingUp")
										: mcpController.linearMcpPreset.status === "configured"
											? t("cline.connectLinear")
											: t("cline.setupLinear")}
								</Button>
							</div>
						</div>
					) : null}

					{mcpController.isLoadingMcpSettings ? (
						<p className="text-text-secondary text-[12px] mt-1 mb-0">{t("cline.loadingMcpSettings")}</p>
					) : null}

					{!mcpController.isLoadingMcpSettings && mcpController.mcpServers.length === 0 ? (
						<p className="text-text-secondary text-[12px] mt-1 mb-0">{t("cline.noMcpServers")}</p>
					) : null}

					{mcpController.mcpServers.map((server, serverIndex) => {
						const authStatus = mcpController.mcpAuthStatusByServerName[server.name];
						const oauthSupported = server.type !== "stdio";
						const oauthConfigured = authStatus?.oauthConfigured ?? false;
						const isAuthenticating = mcpController.authenticatingMcpServerName === server.name;

						return (
							<div key={serverIndex} className="flex items-start gap-2 mt-2">
								<div className="rounded-md border border-border p-2 flex-1 min-w-0">
									<div className="grid gap-2" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
										<div className="min-w-0">
											<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.serverName")}</p>
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
											<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.transport")}</p>
											<NativeSelect
												fill
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
											>
												<option value="streamableHttp">HTTP</option>
												<option value="sse">SSE</option>
												<option value="stdio">Stdio</option>
											</NativeSelect>
										</div>
									</div>

									{server.type === "stdio" ? (
										<div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
											<div className="min-w-0">
												<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.command")}</p>
												<input
													value={server.command}
													onChange={(event) => {
														updateMcpServer(serverIndex, (current) => {
															if (current.type !== "stdio") {
																return current;
															}
															return {
																...current,
																command: event.target.value,
															};
														});
													}}
													placeholder={t("cline.command")}
													disabled={mcpControlsDisabled}
													className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
												/>
											</div>
											<div className="min-w-0">
												<p className="text-text-secondary text-[12px] mt-0 mb-1">{t("cline.arguments")}</p>
												<input
													value={(server.args ?? []).join(" ")}
													onChange={(event) => {
														updateMcpServer(serverIndex, (current) => {
															if (current.type !== "stdio") {
																return current;
															}
															return {
																...current,
																args: event.target.value
																	.split(/\s+/)
																	.map((value) => value.trim())
																	.filter((value) => value.length > 0),
															};
														});
													}}
													placeholder={t("cline.argsPlaceholder")}
													disabled={mcpControlsDisabled}
													className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
												/>
											</div>
											<div className="min-w-0" style={{ gridColumn: "1 / -1" }}>
												<p className="text-text-secondary text-[12px] mt-0 mb-1">
													{t("cline.workingDirectory")}
												</p>
												<input
													value={server.cwd ?? ""}
													onChange={(event) => {
														updateMcpServer(serverIndex, (current) => {
															if (current.type !== "stdio") {
																return current;
															}
															return {
																...current,
																cwd: event.target.value,
															};
														});
													}}
													placeholder={t("cline.workingDirectoryOptional")}
													disabled={mcpControlsDisabled}
													className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
												/>
											</div>
										</div>
									) : (
										<div className="min-w-0 mt-2">
											<p className="text-text-secondary text-[12px] mt-0 mb-1">URL</p>
											<input
												value={server.url}
												onChange={(event) => {
													updateMcpServer(serverIndex, (current) => {
														if (current.type === "stdio") {
															return current;
														}
														return {
															...current,
															url: event.target.value,
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
												{t("cline.oauth")}{" "}
												<span className="text-text-primary">
													{oauthConfigured ? t("cline.connected") : t("cline.notConnected")}
												</span>
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
												{isAuthenticating
													? t("cline.connectingOauth")
													: oauthConfigured
														? t("cline.reconnectOauth")
														: t("cline.connectOauth")}
											</Button>
										</div>
									) : null}

									<label
										htmlFor={`mcp-disabled-${serverIndex}`}
										className="flex items-center gap-2 text-[12px] text-text-primary mt-2 cursor-pointer select-none"
									>
										<RadixCheckbox.Root
											id={`mcp-disabled-${serverIndex}`}
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
										<span>{t("cline.disabled")}</span>
									</label>
								</div>
								<Button
									variant="ghost"
									size="sm"
									icon={<X size={14} />}
									aria-label={t("cline.removeMcpServer", { name: server.name || String(serverIndex + 1) })}
									disabled={mcpControlsDisabled}
									onClick={() => removeMcpServer(serverIndex)}
								/>
							</div>
						);
					})}
				</>
			) : null}
			<ClineAddProviderDialog
				open={isAddProviderDialogOpen}
				onOpenChange={setIsAddProviderDialogOpen}
				existingProviderIds={controller.providerCatalog.map((provider) => provider.id)}
				mode={providerDialogMode}
				initialValues={providerDialogMode === "edit" ? selectedProviderEditInitialValues : null}
				onSubmit={async (input) => {
					onError?.(null);
					const result =
						providerDialogMode === "edit"
							? await controller.updateCustomProvider(input as UpdateClineProviderInput)
							: await controller.addCustomProvider(input as AddClineProviderInput);
					if (!result.ok) {
						onError?.(
							result.message ??
								(providerDialogMode === "edit"
									? t("cline.error.updateProvider")
									: t("cline.error.addProvider")),
						);
						return result;
					}
					onSaved?.();
					return result;
				}}
			/>
		</>
	);
}
