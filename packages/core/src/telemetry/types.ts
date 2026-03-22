import type { EnergyUsage } from "../types.js";

/**
 * A single telemetry record emitted after each model call.
 * Output format: one JSON object per line (JSONL).
 */
export interface TelemetryRecord {
	task_id: string;
	run_id: string;
	step_id: string;
	model: string;
	provider: string;
	tokens: { input: number; output: number; total: number };
	latency_ms: number;
	energy_joules: number;
	energy_kwh: number;
	timestamp: number;
}

/**
 * Input shape for building a telemetry record from a completed model call.
 */
export interface TelemetryInput {
	task_id: string;
	run_id: string;
	step_id: string;
	model: string;
	provider: string;
	usage: { input: number; output: number; totalTokens: number };
	energy?: EnergyUsage;
	latency_ms: number;
	timestamp?: number;
}
