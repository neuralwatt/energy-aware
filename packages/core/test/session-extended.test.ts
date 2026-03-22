import { describe, expect, it } from "vitest";
import { EnergySession } from "../src/session.js";
import { EnergyAwarePolicy } from "../src/policy/energy-aware-policy.js";
import { BaselinePolicy } from "../src/policy/baseline-policy.js";
import type { ModelInfo } from "../src/types.js";

const model: ModelInfo = {
	id: "test-model",
	reasoning: false,
	inputModalities: ["text"],
	cost: { output: 5 },
	contextWindow: 128000,
	maxTokens: 4096,
};

describe("EnergySession extended", () => {
	it("should use custom taskId when provided", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { energy_budget_joules: 10 },
			availableModels: [model],
			taskId: "custom-task-123",
		});
		session.beforeCall(model);
		session.afterCall({ input: 100, output: 50, totalTokens: 150, cost: { total: 0 }, energy_joules: 1 });
		expect(session.telemetryLog[0].task_id).toBe("custom-task-123");
	});

	it("should generate taskId when not provided", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { energy_budget_joules: 10 },
			availableModels: [model],
		});
		session.beforeCall(model);
		session.afterCall({ input: 100, output: 50, totalTokens: 150, cost: { total: 0 }, energy_joules: 1 });
		expect(session.telemetryLog[0].task_id).toMatch(/^session-\d+$/);
	});

	it("should track time-based pressure", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { time_budget_ms: 10000 },
			availableModels: [model],
		});
		// Can't easily control Date.now() in this test, but we can verify it returns a number >= 0
		expect(session.pressure).toBeGreaterThanOrEqual(0);
	});

	it("should return Infinity for budgetRemaining when using time budget", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { time_budget_ms: 10000 },
			availableModels: [model],
		});
		expect(session.budgetRemaining).toBe(Infinity);
	});

	it("should return Infinity for budgetRemaining when no budget set", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: {},
			availableModels: [model],
		});
		expect(session.budgetRemaining).toBe(Infinity);
	});

	it("should not go below 0 for budgetRemaining", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { energy_budget_joules: 5 },
			availableModels: [model],
		});
		session.beforeCall(model);
		session.afterCall({ input: 100, output: 50, totalTokens: 150, cost: { total: 0 }, energy_joules: 10 });
		expect(session.budgetRemaining).toBe(0);
	});

	it("should isolate state between sessions", () => {
		const s1 = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { energy_budget_joules: 10 },
			availableModels: [model],
		});
		const s2 = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { energy_budget_joules: 10 },
			availableModels: [model],
		});

		s1.beforeCall(model);
		s1.afterCall({ input: 100, output: 50, totalTokens: 150, cost: { total: 0 }, energy_joules: 5 });

		expect(s1.consumedEnergy).toBe(5);
		expect(s2.consumedEnergy).toBe(0);
		expect(s1.turnNumber).toBe(1);
		expect(s2.turnNumber).toBe(0);
	});

	it("should update estimatedInputTokens from afterCall usage", () => {
		const session = new EnergySession({
			policy: new EnergyAwarePolicy(),
			budget: { energy_budget_joules: 100 },
			availableModels: [model],
		});

		session.beforeCall(model);
		session.afterCall({ input: 500, output: 200, totalTokens: 5000, cost: { total: 0 }, energy_joules: 1 });

		// The next beforeCall should see estimatedInputTokens = 5000 from last afterCall
		// We can verify indirectly — high input tokens at >50% pressure would trigger compaction
		// But here we just verify the session accepts the data without error
		session.beforeCall(model);
		session.afterCall({ input: 600, output: 300, totalTokens: 90000, cost: { total: 0 }, energy_joules: 1 });

		expect(session.turnNumber).toBe(2);
	});

	it("should handle afterCall with zero tokens", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { energy_budget_joules: 10 },
			availableModels: [model],
		});
		session.beforeCall(model);
		session.afterCall({ input: 0, output: 0, totalTokens: 0, cost: { total: 0 }, energy_joules: 0 });
		expect(session.consumedEnergy).toBe(0);
		expect(session.turnNumber).toBe(1);
	});

	it("should accumulate energy across many turns", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { energy_budget_joules: 1000 },
			availableModels: [model],
		});

		for (let i = 0; i < 100; i++) {
			session.beforeCall(model);
			session.afterCall({ input: 100, output: 50, totalTokens: 150, cost: { total: 0 }, energy_joules: 1 });
		}

		expect(session.turnNumber).toBe(100);
		expect(session.consumedEnergy).toBe(100);
		expect(session.telemetryLog).toHaveLength(100);
		expect(session.pressure).toBeCloseTo(0.1);
	});
});
