import { randomUUID } from "node:crypto";
import type { PolicyContext, PolicyDecision, UsageWithEnergy, TelemetryRecord } from "@neuralwatt/energy-aware-core";
import type { BenchmarkTask, MockTurnUsage, PolicyDecisionLog, RunConfig, RunResult, TaskResult } from "./types.js";

const DEFAULT_TURN_USAGE: MockTurnUsage = {
	input: 500,
	output: 200,
	totalTokens: 700,
	cost: { total: 0.001 },
	energy_joules: 0.5,
	energy_kwh: 0.5 / 3_600_000,
	latency_ms: 100,
};

function getTurnUsage(task: BenchmarkTask, turn: number): MockTurnUsage {
	if (!task.mockTurnUsage || task.mockTurnUsage.length === 0) {
		return DEFAULT_TURN_USAGE;
	}
	const idx = Math.min(turn, task.mockTurnUsage.length - 1);
	return task.mockTurnUsage[idx];
}

function computePressure(
	consumedEnergy: number,
	consumedTime: number,
	budget: { energy_budget_joules?: number; time_budget_ms?: number },
): number {
	if (budget.energy_budget_joules && budget.energy_budget_joules > 0) {
		return consumedEnergy / budget.energy_budget_joules;
	}
	if (budget.time_budget_ms && budget.time_budget_ms > 0) {
		return consumedTime / budget.time_budget_ms;
	}
	return 0;
}

export async function runTask(task: BenchmarkTask, config: RunConfig): Promise<TaskResult> {
	const runId = config.runId ?? randomUUID();
	const startTime = Date.now();
	const telemetryRecords: TelemetryRecord[] = [];
	const policyDecisions: PolicyDecisionLog[] = [];

	let consumedEnergy = 0;
	let totalTokens = 0;
	let estimatedInputTokens = 0;

	for (let turn = 0; turn < task.maxTurns; turn++) {
		const stepId = `${task.id}-step-${turn}`;

		const ctx: PolicyContext = {
			taskId: task.id,
			turnNumber: turn,
			model: config.model,
			availableModels: config.availableModels,
			budget: config.budget,
			consumedEnergy,
			consumedTime: Date.now() - startTime,
			messageCount: turn,
			estimatedInputTokens,
		};

		let decision: PolicyDecision = {};
		if (config.policy) {
			decision = config.policy.beforeModelCall(ctx);
		}

		if (decision.abort) {
			policyDecisions.push({
				turn,
				pressure: computePressure(consumedEnergy, ctx.consumedTime, config.budget),
				reason: decision.reason ?? "budget exhausted",
				actions: ["abort"],
			});
			break;
		}

		const actions: string[] = [];
		if (decision.model) actions.push(`route:${decision.model.id}`);
		if (decision.reasoning) actions.push(`reasoning:${decision.reasoning}`);
		if (decision.maxTokens) actions.push(`maxTokens:${decision.maxTokens}`);
		if (decision.shouldCompact) actions.push("compact");

		if (actions.length > 0 || decision.reason) {
			policyDecisions.push({
				turn,
				pressure: computePressure(consumedEnergy, ctx.consumedTime, config.budget),
				reason: decision.reason ?? "",
				actions,
			});
		}

		const turnUsage = getTurnUsage(task, turn);
		const effectiveModel = decision.model ?? config.model;
		const energyScale = decision.model ? decision.model.cost.output / config.model.cost.output : 1;
		const adjustedEnergy = (turnUsage.energy_joules ?? 0.5) * energyScale;

		consumedEnergy += adjustedEnergy;
		totalTokens += turnUsage.totalTokens;
		estimatedInputTokens = turnUsage.totalTokens;

		const record: TelemetryRecord = {
			task_id: task.id,
			run_id: runId,
			step_id: stepId,
			model: effectiveModel.id,
			provider: "neuralwatt",
			tokens: { input: turnUsage.input, output: turnUsage.output, total: turnUsage.totalTokens },
			latency_ms: turnUsage.latency_ms ?? 100,
			energy_joules: adjustedEnergy,
			energy_kwh: adjustedEnergy / 3_600_000,
			timestamp: Date.now(),
		};
		telemetryRecords.push(record);

		if (config.policy) {
			const usageWithEnergy: UsageWithEnergy = {
				input: turnUsage.input,
				output: turnUsage.output,
				totalTokens: turnUsage.totalTokens,
				cost: turnUsage.cost,
				energy_joules: adjustedEnergy,
				energy_kwh: adjustedEnergy / 3_600_000,
			};
			config.policy.afterModelCall(ctx, usageWithEnergy);
		}
	}

	const validation = task.validator(telemetryRecords, policyDecisions);

	return {
		task_id: task.id,
		run_id: runId,
		mode: config.mode,
		passed: validation.passed,
		score: validation.score,
		time_ms: Date.now() - startTime,
		energy_joules: consumedEnergy,
		tokens_total: totalTokens,
		turns: telemetryRecords.length,
		policy_decisions: policyDecisions,
	};
}

export async function runSuite(tasks: BenchmarkTask[], config: RunConfig): Promise<RunResult> {
	const runId = config.runId ?? randomUUID();
	const results: TaskResult[] = [];

	for (const task of tasks) {
		const result = await runTask(task, { ...config, runId });
		results.push(result);
	}

	return { runId, mode: config.mode, results };
}
