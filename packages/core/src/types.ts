/**
 * Tool-agnostic model information interface.
 * Any coding tool maps its native model type to this 6-field interface.
 */
export interface ModelInfo {
	id: string;
	reasoning: boolean;
	inputModalities: ("text" | "image")[];
	cost: { output: number };
	contextWindow: number;
	maxTokens: number;
}

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface EnergyBudget {
	energy_budget_joules?: number;
	time_budget_ms?: number;
}

export interface PolicyContext {
	taskId?: string;
	turnNumber: number;
	model: ModelInfo;
	/** Models available for routing, sorted by cost.output ascending. */
	availableModels: ModelInfo[];
	budget: EnergyBudget;
	/** Joules consumed so far in this run. */
	consumedEnergy: number;
	/** Milliseconds elapsed since run start. */
	consumedTime: number;
	messageCount: number;
	/**
	 * Total input tokens of the current context.
	 * Use the last assistant message's usage.totalTokens as a proxy for context size.
	 */
	estimatedInputTokens: number;
}

export interface PolicyDecision {
	model?: ModelInfo;
	maxTokens?: number;
	reasoning?: ThinkingLevel;
	shouldCompact?: boolean;
	abort?: boolean;
	reason?: string;
}

export interface UsageWithEnergy {
	input: number;
	output: number;
	totalTokens: number;
	cost: { total: number };
	energy_joules?: number;
	energy_kwh?: number;
}

export interface RuntimePolicy {
	name: string;
	beforeModelCall(ctx: PolicyContext): PolicyDecision;
	afterModelCall(ctx: PolicyContext, usage: UsageWithEnergy): void;
}

export interface EnergyUsage {
	energy_joules: number;
	energy_kwh: number;
	duration_seconds: number;
}
