#!/usr/bin/env node
/**
 * Demo: Compare baseline vs energy-aware mode using mock data.
 *
 * Run: npx tsx packages/benchmarks/src/demo-compare.ts
 *
 * This demo uses mocked turn data (no API keys required) to show how
 * the EnergyAwarePolicy progressively intervenes as budget pressure rises.
 */

import {
	EnergyAwarePolicy,
	BaselinePolicy,
	NEURALWATT_MODELS,
	type ModelInfo,
} from "@neuralwatt/energy-aware-core";
import { runSuite } from "./runner.js";
import type { BenchmarkTask, TaskComparison } from "./types.js";

// Use the most expensive model as baseline
const primaryModel: ModelInfo = NEURALWATT_MODELS[NEURALWATT_MODELS.length - 1]; // Qwen3.5-397B
const availableModels = [...NEURALWATT_MODELS];

const BUDGET_JOULES = 5;

const tasks: BenchmarkTask[] = [
	{
		id: "coding-task",
		name: "Coding Task (10 turns)",
		description: "Simulates a multi-turn coding task with increasing energy consumption",
		prompt: "Implement a TypeScript module for...",
		maxTurns: 10,
		mockTurnUsage: Array.from({ length: 10 }, (_, i) => ({
			input: 300 + i * 100,
			output: 100 + i * 50,
			totalTokens: 400 + i * 150,
			cost: { total: 0.001 * (i + 1) },
			energy_joules: 0.5 + i * 0.1,
			latency_ms: 80 + i * 20,
		})),
		validator: (records) => ({
			passed: records.length > 0,
			score: records.length / 10,
			reason: `Completed ${records.length}/10 turns`,
		}),
	},
	{
		id: "review-task",
		name: "Code Review (5 turns)",
		description: "Simulates a code review with uniform energy per turn",
		prompt: "Review this PR...",
		maxTurns: 5,
		validator: (records) => ({
			passed: records.length > 0,
			score: records.length / 5,
			reason: `Completed ${records.length}/5 turns`,
		}),
	},
];

async function main() {
	console.log("=== Energy-Aware Benchmark Comparison ===\n");
	console.log(`Primary model: ${primaryModel.id} (cost: $${primaryModel.cost.output}/M output)`);
	console.log(`Budget: ${BUDGET_JOULES} joules`);
	console.log(`Available models: ${availableModels.map((m) => m.id).join(", ")}`);
	console.log();

	// Run baseline (no policy)
	const baselineResult = await runSuite(tasks, {
		mode: "baseline",
		model: primaryModel,
		availableModels,
		budget: { energy_budget_joules: BUDGET_JOULES },
		policy: new BaselinePolicy(),
	});

	// Run energy-aware
	const energyAwareResult = await runSuite(tasks, {
		mode: "energy-aware",
		model: primaryModel,
		availableModels,
		budget: { energy_budget_joules: BUDGET_JOULES },
		policy: new EnergyAwarePolicy(),
	});

	// Compare
	console.log("--- Results ---\n");
	const comparisons: TaskComparison[] = [];

	for (let i = 0; i < tasks.length; i++) {
		const baseline = baselineResult.results[i];
		const energyAware = energyAwareResult.results[i];
		const savings = baseline.energy_joules > 0
			? ((baseline.energy_joules - energyAware.energy_joules) / baseline.energy_joules) * 100
			: 0;

		comparisons.push({
			task_id: tasks[i].id,
			task_name: tasks[i].name,
			baseline,
			energy_aware: energyAware,
			energy_savings_pct: savings,
		});

		console.log(`Task: ${tasks[i].name}`);
		console.log(`  Baseline:     ${baseline.energy_joules.toFixed(2)}J, ${baseline.turns} turns`);
		console.log(`  Energy-aware: ${energyAware.energy_joules.toFixed(2)}J, ${energyAware.turns} turns`);
		console.log(`  Energy saved: ${savings.toFixed(1)}%`);

		if (energyAware.policy_decisions.length > 0) {
			console.log("  Policy decisions:");
			for (const d of energyAware.policy_decisions) {
				console.log(`    Turn ${d.turn}: [${d.actions.join(", ")}] ${d.reason}`);
			}
		}
		console.log();
	}

	const meanSavings = comparisons.reduce((sum, c) => sum + c.energy_savings_pct, 0) / comparisons.length;
	console.log(`Mean energy savings: ${meanSavings.toFixed(1)}%`);
}

main().catch(console.error);
