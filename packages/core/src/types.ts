/**
 * Tool-agnostic model information interface.
 * Any coding tool maps its native model type to this interface.
 * The 6 core fields (id, reasoning, inputModalities, cost.output, contextWindow, maxTokens)
 * are required. Optional fields enable the LLM client and dynamic model catalog.
 */
export interface ModelInfo {
	id: string;
	reasoning: boolean;
	inputModalities: ("text" | "image")[];
	cost: { output: number; input?: number };
	contextWindow: number;
	maxTokens: number;
	/** Provider name (e.g., "neuralwatt"). Used for API key lookup. */
	provider?: string;
	/** API base URL (e.g., "https://api.neuralwatt.com/v1"). */
	baseUrl?: string;
	/** Display name (e.g., "Devstral 24B"). */
	name?: string;
	/** Model capabilities (e.g., ["tool_calling", "reasoning"]). */
	capabilities?: string[];
}

// -- LLM Client Types --------------------------------------------------------

export type StopReason = "stop" | "length" | "toolUse" | "error";

export interface Message {
	role: "user" | "assistant";
	content: string;
	toolCalls?: ToolCall[];
	toolResults?: ToolResult[];
}

export interface ToolParameter {
	type: string;
	description?: string;
	properties?: Record<string, ToolParameter>;
	required?: string[];
	items?: ToolParameter;
	enum?: string[];
}

export interface Tool {
	name: string;
	description: string;
	parameters: ToolParameter;
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ToolResult {
	toolCallId: string;
	content: string;
	isError?: boolean;
}

export interface LLMContext {
	systemPrompt: string;
	messages: Message[];
	tools?: Tool[];
}

export interface CompleteOptions {
	maxTokens?: number;
	temperature?: number;
	reasoning?: ThinkingLevel;
	signal?: AbortSignal;
	apiKey?: string;
	baseUrl?: string;
	toolChoice?: "auto" | "none" | "required";
}

export interface Usage {
	input: number;
	output: number;
	totalTokens: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost: {
		input: number;
		output: number;
		total: number;
	};
}

export interface AssistantMessage {
	role: "assistant";
	content: string;
	toolCalls?: ToolCall[];
	usage: Usage;
	energy?: EnergyUsage;
	model: string;
	provider?: string;
	stopReason: StopReason;
	timestamp: number;
}

export interface StreamEvent {
	type: "text" | "tool_call" | "usage" | "done";
	text?: string;
	toolCall?: ToolCall;
	usage?: Usage;
	energy?: EnergyUsage;
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
