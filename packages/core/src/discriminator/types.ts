import type { ModelInfo } from "../types.js";

export type DiscriminatorTier = "thinking" | "complex" | "medium" | "simple";

export interface DiscriminatorTierConfig {
	model: ModelInfo;
	briefMaxTokens?: number;
}

export interface DiscriminatorConfig {
	classifierModel: ModelInfo;
	thinking?: DiscriminatorTierConfig;
	complex: DiscriminatorTierConfig;
	medium?: DiscriminatorTierConfig;
	simple: DiscriminatorTierConfig;
	systemPrompt?: string;
}

export interface RoutingDecision {
	tier: DiscriminatorTier;
	model: ModelInfo;
	maxTokens?: number;
	reason: string;
	energyJ: number;
}

export interface DiscriminateOptions {
	maxTier?: DiscriminatorTier;
	minTier?: DiscriminatorTier;
}

/**
 * Generic classify function signature. Any LLM client can implement this.
 * Returns the raw text response and energy consumed by the classification call.
 */
export interface ClassifyFn {
	(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<{ text: string; energyJ: number }>;
}
