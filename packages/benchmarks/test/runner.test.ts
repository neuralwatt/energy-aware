import { describe, expect, it } from "vitest";
import {
	EnergyAwarePolicy,
	BaselinePolicy,
	NEURALWATT_MODELS,
	type ModelInfo,
} from "@neuralwatt/energy-aware-core";
import { runTask, runSuite } from "../src/runner.js";
import type { BenchmarkTask, RunConfig } from "../src/types.js";

const cheapModel: ModelInfo = NEURALWATT_MODELS[0];
const expensiveModel: ModelInfo = NEURALWATT_MODELS[NEURALWATT_MODELS.length - 1];

function createTask(overrides?: Partial<BenchmarkTask>): BenchmarkTask {
	return {
		id: "test-task",
		name: "Test Task",
		description: "A test task",
		prompt: "Write hello world",
		maxTurns: 5,
		validator: (records, _decisions) => ({
			passed: records.length > 0,
			score: records.length / 5,
			reason: `Completed ${records.length} turns`,
		}),
		...overrides,
	};
}

function createConfig(overrides?: Partial<RunConfig>): RunConfig {
	return {
		mode: "baseline",
		model: expensiveModel,
		availableModels: [...NEURALWATT_MODELS],
		budget: { energy_budget_joules: 100 },
		...overrides,
	};
}

describe("runTask", () => {
	it("should complete all turns for baseline", async () => {
		const result = await runTask(createTask({ maxTurns: 5 }), createConfig());
		expect(result.turns).toBe(5);
		expect(result.passed).toBe(true);
		expect(result.mode).toBe("baseline");
		expect(result.energy_joules).toBeGreaterThan(0);
		expect(result.tokens_total).toBeGreaterThan(0);
	});

	it("should abort early with energy-aware policy under tight budget", async () => {
		const result = await runTask(
			createTask({ maxTurns: 20 }),
			createConfig({
				mode: "energy-aware",
				budget: { energy_budget_joules: 1 },
				policy: new EnergyAwarePolicy(),
			}),
		);
		// Default mock usage is 0.5J per turn, so at 1J budget:
		// Turn 0: 0J consumed -> no intervention, adds 0.5J
		// Turn 1: 0.5J consumed -> 50% pressure, token reduction, adds 0.5J
		// Turn 2: 1.0J consumed -> 100% pressure -> abort
		// So we get 2 completed turns
		expect(result.turns).toBeLessThan(20);
		expect(result.policy_decisions.some((d) => d.actions.includes("abort"))).toBe(true);
	});

	it("should use mock turn usage when provided", async () => {
		const result = await runTask(
			createTask({
				maxTurns: 3,
				mockTurnUsage: [
					{ input: 100, output: 50, totalTokens: 150, cost: { total: 0.001 }, energy_joules: 1.0, latency_ms: 50 },
					{ input: 200, output: 100, totalTokens: 300, cost: { total: 0.002 }, energy_joules: 2.0, latency_ms: 100 },
					{ input: 300, output: 150, totalTokens: 450, cost: { total: 0.003 }, energy_joules: 3.0, latency_ms: 150 },
				],
			}),
			createConfig(),
		);
		expect(result.turns).toBe(3);
		expect(result.tokens_total).toBe(150 + 300 + 450);
	});

	it("should repeat last mock entry when maxTurns exceeds mockTurnUsage length", async () => {
		const result = await runTask(
			createTask({
				maxTurns: 5,
				mockTurnUsage: [
					{ input: 100, output: 50, totalTokens: 150, cost: { total: 0.001 }, energy_joules: 1.0 },
				],
			}),
			createConfig(),
		);
		expect(result.turns).toBe(5);
		// All turns should use the same mock data
		expect(result.tokens_total).toBe(150 * 5);
	});

	it("should log policy decisions with energy-aware policy", async () => {
		const result = await runTask(
			createTask({ maxTurns: 10 }),
			createConfig({
				mode: "energy-aware",
				budget: { energy_budget_joules: 3 },
				policy: new EnergyAwarePolicy(),
			}),
		);
		expect(result.policy_decisions.length).toBeGreaterThan(0);
		for (const d of result.policy_decisions) {
			expect(typeof d.turn).toBe("number");
			expect(typeof d.pressure).toBe("number");
			expect(typeof d.reason).toBe("string");
			expect(Array.isArray(d.actions)).toBe(true);
		}
	});

	it("should scale energy when model routing occurs", async () => {
		const result = await runTask(
			createTask({ maxTurns: 10 }),
			createConfig({
				mode: "energy-aware",
				budget: { energy_budget_joules: 5 },
				policy: new EnergyAwarePolicy(),
			}),
		);
		// Energy-aware should use less energy than baseline due to routing
		const baselineResult = await runTask(
			createTask({ maxTurns: 10 }),
			createConfig({ policy: new BaselinePolicy() }),
		);
		// Energy-aware should use less energy (or at least abort sooner)
		expect(result.energy_joules).toBeLessThanOrEqual(baselineResult.energy_joules);
	});

	it("should call validator and propagate result", async () => {
		const result = await runTask(
			createTask({
				maxTurns: 3,
				validator: (records) => ({
					passed: records.length === 3,
					score: 0.95,
					reason: "custom validation",
				}),
			}),
			createConfig(),
		);
		expect(result.passed).toBe(true);
		expect(result.score).toBe(0.95);
	});

	it("should handle task with 1 turn", async () => {
		const result = await runTask(
			createTask({ maxTurns: 1 }),
			createConfig(),
		);
		expect(result.turns).toBe(1);
		expect(result.passed).toBe(true);
	});

	it("should use auto-generated runId when not provided", async () => {
		const result = await runTask(createTask(), createConfig());
		expect(result.run_id).toBeTruthy();
		expect(result.run_id.length).toBeGreaterThan(0);
	});

	it("should use provided runId", async () => {
		const result = await runTask(createTask(), createConfig({ runId: "my-run-id" }));
		expect(result.run_id).toBe("my-run-id");
	});

	it("should not log policy decisions for baseline (no policy)", async () => {
		const result = await runTask(createTask(), createConfig({ policy: undefined }));
		expect(result.policy_decisions).toHaveLength(0);
	});
});

describe("runSuite", () => {
	it("should run all tasks and aggregate results", async () => {
		const tasks = [
			createTask({ id: "task-1", maxTurns: 3 }),
			createTask({ id: "task-2", maxTurns: 2 }),
		];
		const result = await runSuite(tasks, createConfig());
		expect(result.results).toHaveLength(2);
		expect(result.results[0].task_id).toBe("task-1");
		expect(result.results[1].task_id).toBe("task-2");
	});

	it("should share runId across all tasks", async () => {
		const tasks = [
			createTask({ id: "task-1" }),
			createTask({ id: "task-2" }),
		];
		const result = await runSuite(tasks, createConfig());
		expect(result.results[0].run_id).toBe(result.results[1].run_id);
		expect(result.runId).toBe(result.results[0].run_id);
	});

	it("should handle empty task array", async () => {
		const result = await runSuite([], createConfig());
		expect(result.results).toHaveLength(0);
	});

	it("should propagate mode to results", async () => {
		const result = await runSuite(
			[createTask()],
			createConfig({ mode: "energy-aware", policy: new EnergyAwarePolicy() }),
		);
		expect(result.mode).toBe("energy-aware");
		expect(result.results[0].mode).toBe("energy-aware");
	});
});
