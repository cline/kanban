import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getSdkProviderSettingsDirectory } from "./sdk-provider-boundary";

const CLINE_PROVIDER_MODELS_CACHE_FILE = "cline-provider-models.json";
const CLINE_PROVIDER_MODELS_CACHE_TTL_MS = 60 * 60 * 1000;

const clineModelSchema = z.object({
	id: z.string().trim().min(1),
	name: z.string().optional(),
	architecture: z
		.object({
			modality: z.union([z.string(), z.array(z.string())]).optional(),
			input_modalities: z.array(z.string()).optional(),
			output_modalities: z.array(z.string()).optional(),
		})
		.nullish(),
	supported_parameters: z.array(z.string()).nullish(),
});

const clineProviderModelsResponseSchema = z.object({
	data: z.array(clineModelSchema).default([]),
});

export interface ClineProviderModelData {
	id: string;
	name: string;
	supportsVision?: boolean;
	supportsAttachments?: boolean;
	supportsReasoningEffort?: boolean;
}

type RawClineProviderModelsData = z.infer<typeof clineProviderModelsResponseSchema>;

let inMemoryCache: { apiBaseUrl: string; models: ClineProviderModelData[]; timestamp: number } | null = null;
let pendingRefresh: Promise<ClineProviderModelData[]> | null = null;

function resolveCacheFilePath(): string {
	return join(getSdkProviderSettingsDirectory(), CLINE_PROVIDER_MODELS_CACHE_FILE);
}

function normalizeModalities(model: z.infer<typeof clineModelSchema>): string[] {
	const modality = model.architecture?.modality;
	const rawValues = [
		...(typeof modality === "string" ? [modality] : Array.isArray(modality) ? modality : []),
		...(model.architecture?.input_modalities ?? []),
		...(model.architecture?.output_modalities ?? []),
	];
	return [...new Set(rawValues.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0))];
}

function normalizeClineProviderModels(input: RawClineProviderModelsData): ClineProviderModelData[] {
	const modelsById = new Map<string, ClineProviderModelData>();
	for (const model of input.data) {
		const id = model.id.trim();
		if (!id) {
			continue;
		}
		const modalities = normalizeModalities(model);
		const supportsVision = modalities.some((value) => value.includes("image"));
		const supportsReasoningEffort = (model.supported_parameters ?? []).some(
			(value) => value === "include_reasoning" || value === "reasoning",
		);
		modelsById.set(id, {
			id,
			name: model.name?.trim() || id,
			supportsVision: supportsVision || undefined,
			supportsAttachments: supportsVision || undefined,
			supportsReasoningEffort: supportsReasoningEffort || undefined,
		});
	}
	return [...modelsById.values()];
}

async function readCachedClineProviderModels(): Promise<ClineProviderModelData[] | null> {
	try {
		const raw = await readFile(resolveCacheFilePath(), "utf8");
		const parsed = clineProviderModelsResponseSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			return null;
		}
		const models = normalizeClineProviderModels(parsed.data);
		return models.length > 0 ? models : null;
	} catch {
		return null;
	}
}

async function writeCachedClineProviderModels(data: RawClineProviderModelsData): Promise<void> {
	await mkdir(getSdkProviderSettingsDirectory(), { recursive: true });
	await writeFile(resolveCacheFilePath(), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function fetchAndCacheClineProviderModels(apiBaseUrl: string): Promise<ClineProviderModelData[]> {
	try {
		const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/v1/ai/cline/models`);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const parsed = clineProviderModelsResponseSchema.safeParse(await response.json());
		if (!parsed.success) {
			throw new Error("Invalid response body");
		}

		const models = normalizeClineProviderModels(parsed.data);
		if (models.length > 0) {
			await writeCachedClineProviderModels(parsed.data);
			return models;
		}
	} catch {
		const cachedModels = await readCachedClineProviderModels();
		if (cachedModels && cachedModels.length > 0) {
			return cachedModels;
		}
	}

	return [];
}

export async function fetchClineProviderModels(apiBaseUrl: string): Promise<ClineProviderModelData[]> {
	if (
		inMemoryCache &&
		inMemoryCache.apiBaseUrl === apiBaseUrl &&
		Date.now() - inMemoryCache.timestamp <= CLINE_PROVIDER_MODELS_CACHE_TTL_MS
	) {
		return inMemoryCache.models;
	}

	if (pendingRefresh) {
		return pendingRefresh;
	}

	pendingRefresh = (async () => {
		try {
			const models = await fetchAndCacheClineProviderModels(apiBaseUrl);
			if (models.length > 0) {
				inMemoryCache = {
					apiBaseUrl,
					models,
					timestamp: Date.now(),
				};
			}
			return models;
		} finally {
			pendingRefresh = null;
		}
	})();

	return pendingRefresh;
}

export function resetClineProviderModelsCacheForTests(): void {
	inMemoryCache = null;
	pendingRefresh = null;
}
