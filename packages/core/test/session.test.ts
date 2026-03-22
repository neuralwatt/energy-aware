import { describe, expect, it } from "vitest";
import { EnergySession } from "../src/session.js";
import { EnergyAwarePolicy } from "../src/policy/energy-aware-policy.js";
import { BaselinePolicy } from "../src/policy/baseline-policy.js";
import type { ModelInfo } from "../src/types.js";

const cheapModel: ModelInfo = {
	id: "cheap",
	reasoning: false,
	inputModalities: ["text"],
	cost: { output: 1 },
	contextWindow: 32000,
	maxTokens: 2048,
};

const expensiveModel: ModelInfo = {
	id: "expensive",
	reasoning: true,
	inputModalities: ["text", "image"],
	cost: { output: 15 },
	contextWindow: 128000,
	maxTokens: 4096,
};

describe("EnergySession", () => {
	it("should track pressure as energy accumulates", () => {
		const session = new EnergySession({
			policy: new EnergyAwarePolicy(),
			budget: { energy_budget_joules: 10 },
			availableModels: [cheapModel, expensiveModel],
		});

		expect(session.pressure).toBe(0);

		session.beforeCall(expensiveModel);
		session.afterCall({ input: 100, output: 50, totalTokens: 150, cost: { total: 0.003 }, energy_joules: 3 });

		expect(session.pressure).toBeCloseTo(0.3, 1);
		expect(session.consumedEnergy).toBe(3);
		expect(session.budgetRemaining).toBe(7);
	});

	it("should return abort decision when budget exhausted", () => {
		const session = new EnergySession({
			policy: new EnergyAwarePolicy(),
			budget: { energy_budget_joules: 5 },
			availableModels: [cheapModel],
		});

		session.beforeCall(expensiveModel);
		session.afterCall({ input: 100, output: 50, totalTokens: 150, cost: { total: 0.003 }, energy_joules: 5 });

		const decision = session.beforeCall(expensiveModel);
		expect(decision.abort).toBe(true);
	});

	it("should accumulate telemetry log", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { energy_budget_joules: 100 },
			availableModels: [cheapModel],
		});

		session.beforeCall(cheapModel);
		session.afterCall({ input: 100, output: 50, totalTokens: 150, cost: { total: 0.001 }, energy_joules: 0.5 });

		session.beforeCall(cheapModel);
		session.afterCall({ input: 200, output: 100, totalTokens: 300, cost: { total: 0.002 }, energy_joules: 1.0 });

		expect(session.telemetryLog).toHaveLength(2);
		expect(session.turnNumber).toBe(2);
		expect(session.consumedEnergy).toBe(1.5);
	});

	it("should handle missing energy data gracefully", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { energy_budget_joules: 100 },
			availableModels: [cheapModel],
		});

		session.beforeCall(cheapModel);
		session.afterCall({ input: 100, output: 50, totalTokens: 150, cost: { total: 0.001 } });

		expect(session.consumedEnergy).toBe(0);
		expect(session.pressure).toBe(0);
	});
});
