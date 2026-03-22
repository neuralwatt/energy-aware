import type {
	EnergyBudget,
	ModelInfo,
	RuntimePolicy,
	TelemetryRecord,
} from "@neuralwatt/energy-aware-core";

export type { TelemetryRecord } from "@neuralwatt/energy-aware-core";

export interface MockTurnUsage {
	input: number;
	output: number;
	totalTokens: number;
	cost: { total: number };
	energy_joules?: number;
	energy_kwh?: number;
	latency_ms?: number;
}

export interface BenchmarkTask {
	id: string;
	name: string;
	description: string;
	prompt: string;
	maxTurns: number;
	mockTurnUsage?: MockTurnUsage[];
	validator: (
		records: TelemetryRecord[],
		decisions: PolicyDecisionLog[],
	) => { passed: boolean; score: number; reason: string };
}

export interface TaskResult {
	task_id: string;
	run_id: string;
	mode: "baseline" | "energy-aware";
	passed: boolean;
	score: number;
	time_ms: number;
	energy_joules: number;
	tokens_total: number;
	turns: number;
	policy_decisions: PolicyDecisionLog[];
}

export interface PolicyDecisionLog {
	turn: number;
	pressure: number;
	reason: string;
	actions: string[];
}

export interface TaskComparison {
	task_id: string;
	task_name: string;
	baseline: TaskResult;
	energy_aware: TaskResult;
	energy_savings_pct: number;
}

export interface BenchmarkReport {
	run_date: string;
	tasks: TaskComparison[];
	aggregate: {
		mean_energy_savings_pct: number;
		baseline_success_rate: number;
		energy_aware_success_rate: number;
	};
}

export interface RunConfig {
	runId?: string;
	mode: "baseline" | "energy-aware";
	model: ModelInfo;
	availableModels: ModelInfo[];
	budget: EnergyBudget;
	policy?: RuntimePolicy;
}

export interface RunResult {
	runId: string;
	mode: "baseline" | "energy-aware";
	results: TaskResult[];
}
