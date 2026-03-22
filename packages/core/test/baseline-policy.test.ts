import { describe, expect, it } from "vitest";
import { BaselinePolicy } from "../src/policy/baseline-policy.js";
import type { ModelInfo, PolicyContext, UsageWithEnergy } from "../src/types.js";

function createModel(overrides?: Partial<ModelInfo>): ModelInfo {
	return {
		id: "test-model",
		reasoning: true,
		inputModalities: ["text", "image"],
		cost: { output: 10 },
		contextWindow: 128000,
		maxTokens: 4096,
		...overrides,
	};
}

function createCtx(overrides?: Partial<PolicyContext>): PolicyContext {
	return {
		turnNumber: 1,
		model: createModel(),
		availableModels: [],
		budget: { energy_budget_joules: 10 },
		consumedEnergy: 0,
		consumedTime: 0,
		messageCount: 1,
		estimatedInputTokens: 0,
		...overrides,
	};
}

describe("BaselinePolicy", () => {
	it("should have name 'baseline'", () => {
		expect(new BaselinePolicy().name).toBe("baseline");
	});

	it("should return empty decision from beforeModelCall", () => {
		const decision = new BaselinePolicy().beforeModelCall(createCtx());
		expect(decision).toEqual({});
		expect(decision.model).toBeUndefined();
		expect(decision.maxTokens).toBeUndefined();
		expect(decision.reasoning).toBeUndefined();
		expect(decision.shouldCompact).toBeUndefined();
		expect(decision.abort).toBeUndefined();
		expect(decision.reason).toBeUndefined();
	});

	it("should never intervene regardless of budget pressure", () => {
		const policy = new BaselinePolicy();
		const ctx = createCtx({ consumedEnergy: 999, budget: { energy_budget_joules: 1 } });
		expect(policy.beforeModelCall(ctx)).toEqual({});
	});

	it("should log telemetry on afterModelCall", () => {
		const policy = new BaselinePolicy();
		const usage: UsageWithEnergy = {
			input: 100, output: 50, totalTokens: 150,
			cost: { total: 0.003 }, energy_joules: 1.5, energy_kwh: 0.0000004,
		};
		policy.afterModelCall(createCtx({ turnNumber: 3 }), usage);
		expect(policy.log).toHaveLength(1);
		expect(policy.log[0].usage.energy_joules).toBe(1.5);
		expect(policy.log[0].ctx.turnNumber).toBe(3);
	});

	it("should accumulate multiple log entries", () => {
		const policy = new BaselinePolicy();
		for (let i = 0; i < 5; i++) {
			policy.afterModelCall(
				createCtx({ turnNumber: i + 1 }),
				{ input: 100, output: 50, totalTokens: 150, cost: { total: 0.003 } },
			);
		}
		expect(policy.log).toHaveLength(5);
		expect(policy.log[4].ctx.turnNumber).toBe(5);
	});

	it("should handle missing energy data gracefully", () => {
		const policy = new BaselinePolicy();
		policy.afterModelCall(createCtx(), { input: 100, output: 50, totalTokens: 150, cost: { total: 0.003 } });
		expect(policy.log[0].usage.energy_joules).toBeUndefined();
		expect(policy.log[0].usage.energy_kwh).toBeUndefined();
	});

	it("should snapshot context and usage (not share references)", () => {
		const policy = new BaselinePolicy();
		const ctx = createCtx({ turnNumber: 1 });
		const usage: UsageWithEnergy = { input: 100, output: 50, totalTokens: 150, cost: { total: 0.003 }, energy_joules: 1 };
		policy.afterModelCall(ctx, usage);
		ctx.turnNumber = 999;
		usage.energy_joules = 999;
		expect(policy.log[0].ctx.turnNumber).toBe(1);
		expect(policy.log[0].usage.energy_joules).toBe(1);
	});
});
