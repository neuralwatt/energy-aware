// Types
export type {
	ModelInfo,
	ThinkingLevel,
	EnergyBudget,
	PolicyContext,
	PolicyDecision,
	UsageWithEnergy,
	RuntimePolicy,
	EnergyUsage,
	// LLM Client types
	StopReason,
	Message,
	Tool,
	ToolParameter,
	ToolCall,
	ToolResult,
	LLMContext,
	CompleteOptions,
	Usage,
	AssistantMessage,
	StreamEvent,
} from "./types.js";

// Policies
export { EnergyAwarePolicy } from "./policy/energy-aware-policy.js";
export { BaselinePolicy } from "./policy/baseline-policy.js";

// Session
export { EnergySession } from "./session.js";
export type { EnergySessionConfig } from "./session.js";

// LLM Client
export { completeSimple, streamSimple } from "./client.js";

// Telemetry
export type { TelemetryRecord, TelemetryInput } from "./telemetry/types.js";
export {
	buildTelemetryRecord,
	serializeTelemetryRecord,
	parseTelemetryRecord,
	appendTelemetryLine,
	parseTelemetryLines,
} from "./telemetry/serialization.js";

// Energy extraction
export { extractEnergyFromUsage } from "./energy-extraction.js";

// Models
export { NEURALWATT_MODELS, ENERGY_EFFICIENCY, getNeuralwattModel, fetchNeuralwattModels } from "./models.js";

// Discriminator
export type {
	DiscriminatorTier,
	DiscriminatorTierConfig,
	DiscriminatorConfig,
	RoutingDecision,
	DiscriminateOptions,
	ClassifyFn,
} from "./discriminator/types.js";
export { discriminate, DEFAULT_DISCRIMINATOR_SYSTEM_PROMPT } from "./discriminator/discriminator.js";
