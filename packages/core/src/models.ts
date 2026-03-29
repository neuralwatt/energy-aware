import type { ModelInfo } from "./types.js";

/**
 * Neuralwatt model catalog with cost and energy efficiency data.
 * Sorted by cost.output ascending (cheapest first).
 */
export const NEURALWATT_MODELS: readonly ModelInfo[] = [
	{
		id: "openai/gpt-oss-20b",
		name: "GPT-OSS 20B",
		reasoning: false,
		inputModalities: ["text"],
		cost: { input: 0.03, output: 0.16 },
		contextWindow: 16_384,
		maxTokens: 4_096,
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
	},
	{
		id: "Qwen/Qwen3.5-35B-A3B",
		name: "Qwen3.5 35B",
		reasoning: false,
		inputModalities: ["text"],
		cost: { input: 0.03, output: 0.16 },
		contextWindow: 16_384,
		maxTokens: 4_096,
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
	},
	{
		id: "mistralai/Devstral-Small-2-24B-Instruct-2512",
		name: "Devstral 24B",
		reasoning: false,
		inputModalities: ["text"],
		cost: { input: 0.12, output: 0.35 },
		contextWindow: 262_144,
		maxTokens: 16_384,
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		capabilities: ["tool_calling"],
	},
	{
		id: "MiniMaxAI/MiniMax-M2.5",
		name: "MiniMax M2.5",
		reasoning: false,
		inputModalities: ["text"],
		cost: { input: 0.35, output: 1.10 },
		contextWindow: 262_144,
		maxTokens: 16_384,
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
	},
	{
		id: "zai-org/GLM-5-FP8",
		name: "GLM-5",
		reasoning: false,
		inputModalities: ["text"],
		cost: { input: 0.35, output: 1.10 },
		contextWindow: 262_144,
		maxTokens: 16_384,
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
	},
	{
		id: "moonshotai/Kimi-K2.5",
		name: "Kimi K2.5",
		reasoning: false,
		inputModalities: ["text"],
		cost: { input: 0.52, output: 2.59 },
		contextWindow: 262_144,
		maxTokens: 16_384,
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		capabilities: ["tool_calling"],
	},
	{
		id: "Qwen/Qwen3.5-397B-A17B-FP8",
		name: "Qwen3.5 397B",
		reasoning: false,
		inputModalities: ["text"],
		cost: { input: 0.69, output: 4.14 },
		contextWindow: 262_144,
		maxTokens: 16_384,
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		capabilities: ["tool_calling"],
	},
] as const;

/**
 * Energy efficiency data (tokens per joule) for Neuralwatt models.
 * These are approximations from portal.neuralwatt.com.
 * Prefer API-reported energy_joules when available.
 */
export const ENERGY_EFFICIENCY: Record<string, number> = {
	"Qwen/Qwen3.5-35B-A3B": 27.51,
	"mistralai/Devstral-Small-2-24B-Instruct-2512": 22.35,
	"Qwen/Qwen3.5-397B-A17B-FP8": 1.03,
	"openai/gpt-oss-20b": 0.50,
	"MiniMaxAI/MiniMax-M2.5": 0.50,
	"moonshotai/Kimi-K2.5": 0.21,
};

export function getNeuralwattModel(id: string): ModelInfo | undefined {
	return NEURALWATT_MODELS.find((m) => m.id === id);
}

const DEFAULT_NEURALWATT_BASE_URL = "https://api.neuralwatt.com/v1";

/**
 * Fetch the current model catalog from the Neuralwatt API.
 * Falls back to the static NEURALWATT_MODELS catalog on failure.
 */
export async function fetchNeuralwattModels(
	apiKey: string,
	baseUrl?: string,
): Promise<ModelInfo[]> {
	const url = `${baseUrl ?? DEFAULT_NEURALWATT_BASE_URL}/models`;
	try {
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			console.warn(`[energy-aware] Failed to fetch models (${response.status}), using static catalog`);
			return [...NEURALWATT_MODELS];
		}

		const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
		const models = body.data;
		if (!Array.isArray(models)) {
			return [...NEURALWATT_MODELS];
		}

		const result: ModelInfo[] = [];
		for (const m of models) {
			const id = typeof m.id === "string" ? m.id : undefined;
			if (!id) continue;

			// Try to find static model info for cost/capability data
			const staticInfo = getNeuralwattModel(id);

			result.push({
				id,
				name: typeof m.name === "string" ? m.name : (staticInfo?.name ?? id),
				reasoning: staticInfo?.reasoning ?? false,
				inputModalities: staticInfo?.inputModalities ?? ["text"],
				cost: staticInfo?.cost ?? { output: 0 },
				contextWindow: typeof m.context_length === "number" ? m.context_length : (staticInfo?.contextWindow ?? 128_000),
				maxTokens: staticInfo?.maxTokens ?? 16_384,
				provider: "neuralwatt",
				baseUrl: baseUrl ?? DEFAULT_NEURALWATT_BASE_URL,
				capabilities: staticInfo?.capabilities,
			});
		}

		// Sort by cost.output ascending
		result.sort((a, b) => a.cost.output - b.cost.output);
		return result.length > 0 ? result : [...NEURALWATT_MODELS];
	} catch (err) {
		console.warn(`[energy-aware] Failed to fetch models: ${err instanceof Error ? err.message : err}, using static catalog`);
		return [...NEURALWATT_MODELS];
	}
}
