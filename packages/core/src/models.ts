import type { ModelInfo } from "./types.js";

/**
 * Neuralwatt model catalog with cost and energy efficiency data.
 * Sorted by cost.output ascending (cheapest first).
 */
export const NEURALWATT_MODELS: readonly ModelInfo[] = [
	{
		id: "openai/gpt-oss-20b",
		reasoning: false,
		inputModalities: ["text"],
		cost: { output: 0.16 },
		contextWindow: 16_384,
		maxTokens: 4_096,
	},
	{
		id: "Qwen/Qwen3.5-35B-A3B",
		reasoning: false,
		inputModalities: ["text"],
		cost: { output: 0.16 },
		contextWindow: 16_384,
		maxTokens: 4_096,
	},
	{
		id: "mistralai/Devstral-Small-2-24B-Instruct-2512",
		reasoning: false,
		inputModalities: ["text"],
		cost: { output: 0.35 },
		contextWindow: 262_144,
		maxTokens: 16_384,
	},
	{
		id: "MiniMaxAI/MiniMax-M2.5",
		reasoning: false,
		inputModalities: ["text"],
		cost: { output: 1.10 },
		contextWindow: 262_144,
		maxTokens: 16_384,
	},
	{
		id: "zai-org/GLM-5-FP8",
		reasoning: false,
		inputModalities: ["text"],
		cost: { output: 1.10 },
		contextWindow: 262_144,
		maxTokens: 16_384,
	},
	{
		id: "moonshotai/Kimi-K2.5",
		reasoning: false,
		inputModalities: ["text"],
		cost: { output: 2.59 },
		contextWindow: 262_144,
		maxTokens: 16_384,
	},
	{
		id: "Qwen/Qwen3.5-397B-A17B-FP8",
		reasoning: false,
		inputModalities: ["text"],
		cost: { output: 4.14 },
		contextWindow: 262_144,
		maxTokens: 16_384,
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
