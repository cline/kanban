import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getSdkProviderSettingsDirectory } from "./sdk-provider-boundary";

const CLINE_RECOMMENDED_MODELS_CACHE_FILE = "cline-recommended-models.json";
const CLINE_RECOMMENDED_MODELS_CACHE_TTL_MS = 60 * 60 * 1000;

const recommendedModelSchema = z.object({
	id: z.string().trim().min(1),
	name: z.string().optional(),
	description: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

const recommendedModelsSchema = z.object({
	recommended: z.array(recommendedModelSchema).default([]),
	free: z.array(recommendedModelSchema).default([]),
});

export type ClineFeaturedModel = z.infer<typeof recommendedModelSchema>;
export type ClineRecommendedModelsData = z.infer<typeof recommendedModelsSchema>;
export type ClineRecommendedModelsDataSource = "remote" | "cache" | "fallback";
export interface ClineRecommendedModelsFetchResult {
	data: ClineRecommendedModelsData;
	source: ClineRecommendedModelsDataSource;
}

const CLINE_RECOMMENDED_MODEL_IDS_FALLBACK = [
	"google/gemini-3.1-pro-preview",
	"anthropic/claude-sonnet-4.6",
	"anthropic/claude-opus-4.6",
	"openai/gpt-5.3-codex",
] as const;
const CLINE_FREE_MODEL_IDS_FALLBACK = ["kwaipilot/kat-coder-pro", "arcee-ai/trinity-large-preview:free"] as const;

let inMemoryCache: { apiBaseUrl: string; result: ClineRecommendedModelsFetchResult; timestamp: number } | null = null;
let pendingRefresh: Promise<ClineRecommendedModelsFetchResult> | null = null;

function normalizeFeaturedModels(models: readonly ClineFeaturedModel[]): ClineFeaturedModel[] {
	const featuredModelsById = new Map<string, ClineFeaturedModel>();
	for (const model of models) {
		const id = model.id.trim();
		if (!id || featuredModelsById.has(id)) {
			continue;
		}
		featuredModelsById.set(id, {
			id,
			name: model.name?.trim() || undefined,
			description: model.description?.trim() || undefined,
			tags: model.tags?.map((tag) => tag.trim()).filter((tag) => tag.length > 0) ?? undefined,
		});
	}
	return [...featuredModelsById.values()];
}

function normalizeRecommendedModels(input: ClineRecommendedModelsData): ClineRecommendedModelsData {
	return {
		recommended: normalizeFeaturedModels(input.recommended),
		free: normalizeFeaturedModels(input.free),
	};
}

function resolveCacheFilePath(): string {
	return join(getSdkProviderSettingsDirectory(), CLINE_RECOMMENDED_MODELS_CACHE_FILE);
}

function getFallbackRecommendedModels(): ClineRecommendedModelsData {
	return {
		recommended: CLINE_RECOMMENDED_MODEL_IDS_FALLBACK.map((id) => ({ id })),
		free: CLINE_FREE_MODEL_IDS_FALLBACK.map((id) => ({ id })),
	};
}

async function readCachedRecommendedModels(): Promise<ClineRecommendedModelsData | null> {
	try {
		const raw = await readFile(resolveCacheFilePath(), "utf8");
		const parsed = recommendedModelsSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			return null;
		}
		const data = normalizeRecommendedModels(parsed.data);
		return data.recommended.length > 0 || data.free.length > 0 ? data : null;
	} catch {
		return null;
	}
}

async function writeCachedRecommendedModels(data: ClineRecommendedModelsData): Promise<void> {
	await mkdir(getSdkProviderSettingsDirectory(), { recursive: true });
	await writeFile(resolveCacheFilePath(), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function fetchAndCacheRecommendedModels(apiBaseUrl: string): Promise<ClineRecommendedModelsFetchResult> {
	try {
		const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/v1/ai/cline/recommended-models`);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const parsed = recommendedModelsSchema.safeParse(await response.json());
		if (!parsed.success) {
			throw new Error("Invalid response body");
		}

		const data = normalizeRecommendedModels(parsed.data);
		if (data.recommended.length > 0 || data.free.length > 0) {
			await writeCachedRecommendedModels(data);
			return {
				data,
				source: "remote",
			};
		}
	} catch {
		const cachedData = await readCachedRecommendedModels();
		if (cachedData && (cachedData.recommended.length > 0 || cachedData.free.length > 0)) {
			return {
				data: cachedData,
				source: "cache",
			};
		}
	}

	return {
		data: getFallbackRecommendedModels(),
		source: "fallback",
	};
}

export async function fetchClineRecommendedModels(apiBaseUrl: string): Promise<ClineRecommendedModelsFetchResult> {
	if (
		inMemoryCache &&
		inMemoryCache.apiBaseUrl === apiBaseUrl &&
		Date.now() - inMemoryCache.timestamp <= CLINE_RECOMMENDED_MODELS_CACHE_TTL_MS
	) {
		return inMemoryCache.result;
	}

	if (pendingRefresh) {
		return pendingRefresh;
	}

	pendingRefresh = (async () => {
		try {
			const result = await fetchAndCacheRecommendedModels(apiBaseUrl);
			if (result.data.recommended.length > 0 || result.data.free.length > 0) {
				inMemoryCache = {
					apiBaseUrl,
					result,
					timestamp: Date.now(),
				};
			}
			return result;
		} finally {
			pendingRefresh = null;
		}
	})();

	return pendingRefresh;
}

export async function fetchClineRecommendedModelsData(apiBaseUrl: string): Promise<ClineRecommendedModelsData> {
	return (await fetchClineRecommendedModels(apiBaseUrl)).data;
}

export async function fetchClineRecommendedModelIds(apiBaseUrl: string): Promise<string[]> {
	return (await fetchClineRecommendedModelsData(apiBaseUrl)).recommended.map((model) => model.id);
}

export function resetClineRecommendedModelsCacheForTests(): void {
	inMemoryCache = null;
	pendingRefresh = null;
}
