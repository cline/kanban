import { useMemo, type ReactElement } from "react";

import { SearchSelectDropdown, type SearchSelectOption } from "@/components/search-select-dropdown";
import { Button } from "@/components/ui/button";
import type { UseRuntimeSettingsClineControllerResult } from "@/hooks/use-runtime-settings-cline-controller";

export function ClineSetupSection({
	controller,
	controlsDisabled,
	showHeading = true,
	onError,
	onSaved,
}: {
	controller: UseRuntimeSettingsClineControllerResult;
	controlsDisabled: boolean;
	showHeading?: boolean;
	onError?: (message: string | null) => void;
	onSaved?: () => void;
}): ReactElement {
	const clineProviderOptions = useMemo((): SearchSelectOption[] => {
		const items: SearchSelectOption[] = controller.providerCatalog.map((provider) => ({
			value: provider.id,
			label: `${provider.name} ${provider.oauthSupported ? "(OAuth)" : "(API key)"}`,
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
			<p className="text-text-secondary text-[12px] mt-2 mb-0">
				Authentication: {controller.isOauthProviderSelected ? "OAuth" : "API key"}
			</p>
			<div className="grid gap-2 mt-2" style={{ gridTemplateColumns: controller.isOauthProviderSelected ? "1fr" : "1fr 1fr" }}>
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
			</div>
			{controller.isOauthProviderSelected ? (
				<>
					<p className="text-text-secondary text-[12px] mt-2 mb-0">
						Status: {controller.oauthConfigured ? "Signed in" : "Not signed in"}
					</p>
					{controller.oauthAccountId ? (
						<p className="text-text-secondary text-[12px] mt-1 mb-0">
							Account ID: <span className="text-text-primary">{controller.oauthAccountId}</span>
						</p>
					) : null}
					{controller.oauthExpiresAt ? (
						<p className="text-text-secondary text-[12px] mt-1 mb-0">
							Expiry: <span className="text-text-primary">{controller.oauthExpiresAt}</span>
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
		</>
	);
}
