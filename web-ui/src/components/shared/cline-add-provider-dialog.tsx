import { Check, Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import { type KeyboardEvent, type ReactElement, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type { AddClineProviderInput } from "@/hooks/use-runtime-settings-cline-controller";
import type { RuntimeClineProviderCapability } from "@/runtime/types";

const CAPABILITY_OPTIONS: readonly RuntimeClineProviderCapability[] = [
	"streaming",
	"tools",
	"reasoning",
	"vision",
	"prompt-cache",
];

interface HeaderEntry {
	id: string;
	key: string;
	value: string;
}

interface FormState {
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	modelsSourceUrl: string;
	models: string[];
	defaultModelId: string;
	timeoutMs: string;
	headers: HeaderEntry[];
	capabilities: RuntimeClineProviderCapability[];
}

interface SaveResult {
	ok: boolean;
	message?: string;
}

let nextHeaderEntryId = 0;

function createInitialFormState(): FormState {
	return {
		providerId: "",
		name: "",
		baseUrl: "",
		apiKey: "",
		modelsSourceUrl: "",
		models: [],
		defaultModelId: "",
		timeoutMs: "",
		headers: [],
		capabilities: ["streaming", "tools"],
	};
}

function createHeaderEntry(): HeaderEntry {
	return {
		id: `header-${nextHeaderEntryId++}`,
		key: "",
		value: "",
	};
}

export function ClineAddProviderDialog({
	open,
	onOpenChange,
	existingProviderIds,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	existingProviderIds: string[];
	onSubmit: (input: AddClineProviderInput) => Promise<SaveResult>;
}): ReactElement {
	const [form, setForm] = useState<FormState>(() => createInitialFormState());
	const [modelInput, setModelInput] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [showApiKey, setShowApiKey] = useState(false);

	useEffect(() => {
		if (open) {
			return;
		}
		setForm(createInitialFormState());
		setModelInput("");
		setError(null);
		setIsSaving(false);
		setShowApiKey(false);
	}, [open]);

	const normalizedProviderId = useMemo(
		() => form.providerId.trim().toLowerCase().replace(/\s+/g, "-"),
		[form.providerId],
	);
	const duplicateProviderId = useMemo(() => {
		return existingProviderIds.some((providerId) => providerId.trim().toLowerCase() === normalizedProviderId);
	}, [existingProviderIds, normalizedProviderId]);
	const normalizedPendingModel = modelInput.trim().replace(/,$/, "");
	const draftModels = useMemo(() => {
		if (!normalizedPendingModel || form.models.includes(normalizedPendingModel)) {
			return form.models;
		}
		return [...form.models, normalizedPendingModel];
	}, [form.models, normalizedPendingModel]);
	const hasManualModels = draftModels.length > 0;
	const hasModelsSource = form.modelsSourceUrl.trim().length > 0;
	const canSubmit =
		normalizedProviderId.length > 0 &&
		form.name.trim().length > 0 &&
		form.baseUrl.trim().length > 0 &&
		(hasManualModels || hasModelsSource) &&
		!duplicateProviderId &&
		(form.timeoutMs.trim().length === 0 || (Number.isInteger(Number(form.timeoutMs)) && Number(form.timeoutMs) > 0));

	const addModel = (rawValue: string) => {
		const value = rawValue.trim().replace(/,$/, "");
		if (!value || form.models.includes(value)) {
			return;
		}
		setForm((current) => ({
			...current,
			models: [...current.models, value],
			defaultModelId: current.defaultModelId || value,
		}));
	};

	const handleModelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if ((event.key === "Enter" || event.key === ",") && modelInput.trim()) {
			event.preventDefault();
			addModel(modelInput);
			setModelInput("");
			return;
		}
		if (event.key === "Backspace" && modelInput.length === 0 && form.models.length > 0) {
			event.preventDefault();
			const previousModel = form.models[form.models.length - 1] ?? "";
			setForm((current) => {
				const nextModels = current.models.slice(0, -1);
				return {
					...current,
					models: nextModels,
					defaultModelId:
						current.defaultModelId === previousModel ? (nextModels[0] ?? "") : current.defaultModelId,
				};
			});
		}
	};

	const removeModel = (model: string) => {
		setForm((current) => {
			const nextModels = current.models.filter((entry) => entry !== model);
			return {
				...current,
				models: nextModels,
				defaultModelId: current.defaultModelId === model ? (nextModels[0] ?? "") : current.defaultModelId,
			};
		});
	};

	const toggleCapability = (capability: RuntimeClineProviderCapability) => {
		setForm((current) => ({
			...current,
			capabilities: current.capabilities.includes(capability)
				? current.capabilities.filter((entry) => entry !== capability)
				: [...current.capabilities, capability],
		}));
	};

	const handleSubmit = async () => {
		if (!canSubmit || isSaving) {
			return;
		}
		setIsSaving(true);
		setError(null);
		const result = await onSubmit({
			providerId: normalizedProviderId,
			name: form.name.trim(),
			baseUrl: form.baseUrl.trim(),
			apiKey: form.apiKey.trim() || null,
			headers: Object.fromEntries(
				form.headers
					.map((entry) => [entry.key.trim(), entry.value.trim()] as const)
					.filter(([key]) => key.length > 0),
			),
			timeoutMs: form.timeoutMs.trim().length > 0 ? Number(form.timeoutMs) : undefined,
			models: draftModels,
			defaultModelId: form.defaultModelId.trim() || draftModels[0] || null,
			modelsSourceUrl: form.modelsSourceUrl.trim() || null,
			capabilities: form.capabilities.length > 0 ? form.capabilities : undefined,
		});
		setIsSaving(false);
		if (!result.ok) {
			setError(result.message ?? "Failed to add provider.");
			return;
		}
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-3xl">
			<DialogHeader title="Add OpenAI-compatible provider" />
			<DialogBody className="space-y-4">
				<section className="rounded-lg border border-border bg-surface-1 p-3">
					<div className="grid gap-3 md:grid-cols-2">
						<div className="min-w-0">
							<p className="mb-1 text-[12px] text-text-secondary">Provider ID</p>
							<input
								value={form.providerId}
								onChange={(event) => setForm((current) => ({ ...current, providerId: event.target.value }))}
								placeholder="my-provider"
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
							<p className="mt-1 text-[12px] text-text-tertiary">Used as the saved provider key.</p>
							{duplicateProviderId ? (
								<p className="mt-1 text-[12px] text-status-red">This provider ID already exists.</p>
							) : null}
						</div>
						<div className="min-w-0">
							<p className="mb-1 text-[12px] text-text-secondary">Provider name</p>
							<input
								value={form.name}
								onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
								placeholder="My Provider"
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
					</div>
				</section>

				<section className="rounded-lg border border-border bg-surface-1 p-3">
					<p className="mb-1 text-[12px] text-text-secondary">Base URL</p>
					<input
						value={form.baseUrl}
						onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
						placeholder="https://api.example.com/v1"
						className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
				</section>

				<section className="rounded-lg border border-border bg-surface-1 p-3">
					<p className="mb-1 text-[12px] text-text-secondary">API key</p>
					<div className="relative">
						<input
							type={showApiKey ? "text" : "password"}
							value={form.apiKey}
							onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
							placeholder="Optional"
							className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 pr-9 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						<Button
							variant="ghost"
							size="sm"
							icon={showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
							className="absolute right-1 top-1/2 -translate-y-1/2"
							aria-label={showApiKey ? "Hide API key" : "Show API key"}
							onClick={() => setShowApiKey((current) => !current)}
						/>
					</div>
				</section>

				<section className="rounded-lg border border-border bg-surface-1 p-3">
					<p className="mb-1 text-[12px] text-text-secondary">Model source URL</p>
					<input
						value={form.modelsSourceUrl}
						onChange={(event) => setForm((current) => ({ ...current, modelsSourceUrl: event.target.value }))}
						placeholder="https://api.example.com/v1/models"
						className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
					<p className="mt-1 text-[12px] text-text-tertiary">
						Optional. If set, the SDK can fetch models from a compatible `/models` endpoint.
					</p>
				</section>

				<section className="rounded-lg border border-border bg-surface-1 p-3">
					<p className="mb-1 text-[12px] text-text-secondary">Models</p>
					<div className="flex min-h-10 flex-wrap gap-1 rounded-md border border-border bg-surface-2 px-2 py-1.5">
						{form.models.map((model) => (
							<span
								key={model}
								className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-[12px] text-text-primary"
							>
								<span className="font-mono">{model}</span>
								<button
									type="button"
									className="text-text-secondary hover:text-text-primary"
									onClick={() => removeModel(model)}
									aria-label={`Remove ${model}`}
								>
									<X size={12} />
								</button>
							</span>
						))}
						<input
							value={modelInput}
							onChange={(event) => setModelInput(event.target.value)}
							onKeyDown={handleModelKeyDown}
							onBlur={() => {
								if (normalizedPendingModel) {
									addModel(normalizedPendingModel);
									setModelInput("");
								}
							}}
							placeholder={form.models.length === 0 ? "Type a model ID and press Enter" : ""}
							className="min-w-40 flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
						/>
					</div>
					<p className="mt-1 text-[12px] text-text-tertiary">Add at least one model or set a model source URL.</p>
				</section>

				{draftModels.length > 1 ? (
					<section className="rounded-lg border border-border bg-surface-1 p-3">
						<p className="mb-1 text-[12px] text-text-secondary">Default model</p>
						<select
							value={form.defaultModelId}
							onChange={(event) => setForm((current) => ({ ...current, defaultModelId: event.target.value }))}
							className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary focus:border-border-focus focus:outline-none"
						>
							{draftModels.map((model) => (
								<option key={model} value={model}>
									{model}
								</option>
							))}
						</select>
					</section>
				) : null}

				<section className="rounded-lg border border-border bg-surface-1 p-3">
					<p className="mb-2 text-[12px] text-text-secondary">Capabilities</p>
					<div className="flex flex-wrap gap-2">
						{CAPABILITY_OPTIONS.map((capability) => {
							const selected = form.capabilities.includes(capability);
							return (
								<Button
									key={capability}
									variant={selected ? "primary" : "default"}
									size="sm"
									icon={selected ? <Check size={12} /> : undefined}
									aria-pressed={selected}
									className={cn("px-2.5", !selected && "text-text-secondary")}
									onClick={() => toggleCapability(capability)}
								>
									{capability}
								</Button>
							);
						})}
					</div>
				</section>

				<section className="rounded-lg border border-border bg-surface-1 p-3">
					<h3 className="mb-3 text-[12px] font-medium text-text-primary">Advanced settings</h3>
					<div className="space-y-3">
						<div className="min-w-0">
							<p className="mb-1 text-[12px] text-text-secondary">Timeout (ms)</p>
							<input
								value={form.timeoutMs}
								onChange={(event) => setForm((current) => ({ ...current, timeoutMs: event.target.value }))}
								placeholder="30000"
								inputMode="numeric"
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
						</div>
						<div className="min-w-0">
							<div className="mb-1 flex items-center justify-between">
								<p className="text-[12px] text-text-secondary">Custom headers</p>
								<Button
									variant="ghost"
									size="sm"
									icon={<Plus size={14} />}
									onClick={() =>
										setForm((current) => ({
											...current,
											headers: [...current.headers, createHeaderEntry()],
										}))
									}
								>
									Add
								</Button>
							</div>
							<div className="space-y-2">
								{form.headers.map((entry, index) => (
									<div key={entry.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
										<input
											value={entry.key}
											onChange={(event) =>
												setForm((current) => ({
													...current,
													headers: current.headers.map((header, headerIndex) =>
														headerIndex === index ? { ...header, key: event.target.value } : header,
													),
												}))
											}
											placeholder="Header name"
											className="h-8 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
										/>
										<input
											value={entry.value}
											onChange={(event) =>
												setForm((current) => ({
													...current,
													headers: current.headers.map((header, headerIndex) =>
														headerIndex === index ? { ...header, value: event.target.value } : header,
													),
												}))
											}
											placeholder="Header value"
											className="h-8 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
										/>
										<Button
											variant="ghost"
											size="sm"
											icon={<Trash2 size={14} />}
											aria-label="Remove header"
											onClick={() =>
												setForm((current) => ({
													...current,
													headers: current.headers.filter((_, headerIndex) => headerIndex !== index),
												}))
											}
										/>
									</div>
								))}
							</div>
						</div>
					</div>
				</section>

				{error ? <p className="text-[12px] text-status-red">{error}</p> : null}
			</DialogBody>
			<DialogFooter>
				<Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
					Cancel
				</Button>
				<Button variant="primary" size="md" disabled={!canSubmit || isSaving} onClick={() => void handleSubmit()}>
					{isSaving ? "Adding..." : "Add provider"}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
