import { describe, expect, it } from "vitest";
import { EnergyAwarePolicy } from "../src/policy/energy-aware-policy.js";
import type { ModelInfo, PolicyContext, PolicyDecision, UsageWithEnergy } from "../src/types.js";

function createModel(overrides?: Partial<ModelInfo>): ModelInfo {
	return {
		id: "neuralwatt-large",
		reasoning: true,
		inputModalities: ["text", "image"],
		cost: { output: 15 },
		contextWindow: 128000,
		maxTokens: 4096,
		...overrides,
	};
}

function createCheapModel(overrides?: Partial<ModelInfo>): ModelInfo {
	return {
		id: "neuralwatt-mini",
		reasoning: false,
		inputModalities: ["text"],
		cost: { output: 1.5 },
		contextWindow: 32000,
		maxTokens: 2048,
		...overrides,
	};
}

function createMidModel(overrides?: Partial<ModelInfo>): ModelInfo {
	return {
		id: "neuralwatt-mid",
		reasoning: true,
		inputModalities: ["text", "image"],
		cost: { output: 7 },
		contextWindow: 64000,
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

function createUsage(overrides?: Partial<UsageWithEnergy>): UsageWithEnergy {
	return {
		input: 100,
		output: 50,
		totalTokens: 150,
		cost: { total: 0.003 },
		energy_joules: 1.0,
		energy_kwh: 0.00000028,
		...overrides,
	};
}

describe("EnergyAwarePolicy", () => {
	it("should have name 'energy-aware'", () => {
		const policy = new EnergyAwarePolicy();
		expect(policy.name).toBe("energy-aware");
	});

	describe("pressure calculation", () => {
		it("should return empty decision when no budget is set", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ budget: {}, consumedEnergy: 100 });
			expect(policy.beforeModelCall(ctx)).toEqual({});
		});

		it("should use energy budget for pressure when available", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 5, budget: { energy_budget_joules: 10 } });
			expect(policy.beforeModelCall(ctx).reason).toBeDefined();
		});

		it("should fall back to time-based pressure when no energy budget", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ budget: { time_budget_ms: 10000 }, consumedTime: 5000, consumedEnergy: 0 });
			expect(policy.beforeModelCall(ctx).reason).toBeDefined();
		});

		it("should prefer energy budget over time budget when both are set", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				budget: { energy_budget_joules: 10, time_budget_ms: 10000 },
				consumedEnergy: 1,
				consumedTime: 5000,
			});
			expect(policy.beforeModelCall(ctx)).toEqual({});
		});

		it("should return empty decision when pressure is 0", () => {
			const policy = new EnergyAwarePolicy();
			expect(policy.beforeModelCall(createCtx({ consumedEnergy: 0 }))).toEqual({});
		});

		it("should handle 0 energy budget without crashing", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ budget: { energy_budget_joules: 0 }, consumedEnergy: 5 });
			expect(policy.beforeModelCall(ctx)).toEqual({});
		});
	});

	describe("reasoning reduction", () => {
		it("should not reduce reasoning when pressure <= 30%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 3, budget: { energy_budget_joules: 10 } });
			expect(policy.beforeModelCall(ctx).reasoning).toBeUndefined();
		});

		it("should reduce reasoning to medium when pressure > 30%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 3.5, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.reasoning).toBe("medium");
			expect(decision.reason).toContain("reasoning");
		});

		it("should reduce reasoning to low when pressure > 60%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 6.5, budget: { energy_budget_joules: 10 } });
			expect(policy.beforeModelCall(ctx).reasoning).toBe("low");
		});

		it("should reduce reasoning to minimal when pressure > 80%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 8.5, budget: { energy_budget_joules: 10 } });
			expect(policy.beforeModelCall(ctx).reasoning).toBe("minimal");
		});

		it("should not reduce reasoning on non-reasoning model", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 8.5,
				budget: { energy_budget_joules: 10 },
				model: createModel({ reasoning: false }),
			});
			expect(policy.beforeModelCall(ctx).reasoning).toBeUndefined();
		});
	});

	describe("token reduction", () => {
		it("should not reduce tokens when pressure <= 50%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 5, budget: { energy_budget_joules: 10 } });
			expect(policy.beforeModelCall(ctx).maxTokens).toBeUndefined();
		});

		it("should reduce tokens when pressure > 50%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 6, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.maxTokens).toBeDefined();
			expect(decision.maxTokens!).toBeLessThan(4096);
		});

		it("should scale token reduction linearly with pressure", () => {
			const policy = new EnergyAwarePolicy();
			const d60 = policy.beforeModelCall(createCtx({ consumedEnergy: 6, budget: { energy_budget_joules: 10 } }));
			const d80 = policy.beforeModelCall(createCtx({ consumedEnergy: 8, budget: { energy_budget_joules: 10 } }));
			expect(d60.maxTokens!).toBeGreaterThan(d80.maxTokens!);
		});

		it("should cap token reduction at 40%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 9.9, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			const expectedFactor = Math.min(0.4, ((0.99 - 0.5) / 0.5) * 0.4);
			expect(decision.maxTokens).toBe(Math.floor(4096 * (1 - expectedFactor)));
		});
	});

	describe("model routing", () => {
		it("should not route when pressure <= 70%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 7,
				budget: { energy_budget_joules: 10 },
				availableModels: [createCheapModel(), createModel()],
			});
			expect(policy.beforeModelCall(ctx).model).toBeUndefined();
		});

		it("should route to cheaper model when pressure > 70%", () => {
			const policy = new EnergyAwarePolicy();
			const cheap = createCheapModel({ reasoning: true, inputModalities: ["text", "image"] });
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheap, createModel()],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model).toBeDefined();
			expect(decision.model!.id).toBe("neuralwatt-mini");
		});

		it("should skip candidates that lack reasoning capability", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [createCheapModel({ reasoning: false })],
			});
			expect(policy.beforeModelCall(ctx).model).toBeUndefined();
		});

		it("should skip candidates that lack image capability", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [createCheapModel({ reasoning: true, inputModalities: ["text"] })],
			});
			expect(policy.beforeModelCall(ctx).model).toBeUndefined();
		});

		it("should not route to a model with same or higher cost", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [createModel({ id: "expensive", cost: { output: 20 } })],
			});
			expect(policy.beforeModelCall(ctx).model).toBeUndefined();
		});

		it("should pick the first (cheapest) suitable candidate", () => {
			const policy = new EnergyAwarePolicy();
			const cheap = createCheapModel({ reasoning: true, inputModalities: ["text", "image"] });
			const mid = createMidModel();
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheap, mid, createModel()],
			});
			expect(policy.beforeModelCall(ctx).model!.id).toBe("neuralwatt-mini");
		});

		it("should not require reasoning from non-reasoning model", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				model: createModel({ reasoning: false, inputModalities: ["text"] }),
				availableModels: [createCheapModel({ reasoning: false, inputModalities: ["text"] })],
			});
			expect(policy.beforeModelCall(ctx).model!.id).toBe("neuralwatt-mini");
		});
	});

	describe("context compaction", () => {
		it("should not compact when pressure <= 50%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 5, budget: { energy_budget_joules: 10 }, estimatedInputTokens: 100000 });
			expect(policy.beforeModelCall(ctx).shouldCompact).toBeUndefined();
		});

		it("should compact when pressure > 50% AND tokens > 60% of context window", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 6, budget: { energy_budget_joules: 10 }, estimatedInputTokens: 80000 });
			expect(policy.beforeModelCall(ctx).shouldCompact).toBe(true);
		});

		it("should use routed model's context window for compaction check", () => {
			const policy = new EnergyAwarePolicy();
			const cheap = createCheapModel({ reasoning: true, inputModalities: ["text", "image"] });
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheap],
				estimatedInputTokens: 20000,
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model!.id).toBe("neuralwatt-mini");
			expect(decision.shouldCompact).toBe(true);
		});
	});

	describe("budget exhaustion", () => {
		it("should abort at exactly 100% pressure", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 10, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.abort).toBe(true);
			expect(decision.reason).toContain("budget exhausted");
		});

		it("should abort when over 100% pressure", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 15, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.abort).toBe(true);
			expect(decision.reason).toContain("150%");
		});

		it("should not set other strategies when aborting", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 10,
				budget: { energy_budget_joules: 10 },
				availableModels: [createCheapModel()],
				estimatedInputTokens: 100000,
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.abort).toBe(true);
			expect(decision.model).toBeUndefined();
			expect(decision.maxTokens).toBeUndefined();
		});
	});

	describe("afterModelCall", () => {
		it("should log telemetry entries", () => {
			const policy = new EnergyAwarePolicy();
			policy.afterModelCall(createCtx(), createUsage());
			expect(policy.log).toHaveLength(1);
			expect(policy.log[0].usage.energy_joules).toBe(1.0);
		});

		it("should accumulate multiple entries", () => {
			const policy = new EnergyAwarePolicy();
			for (let i = 0; i < 5; i++) {
				policy.afterModelCall(createCtx({ turnNumber: i + 1 }), createUsage({ energy_joules: i + 1 }));
			}
			expect(policy.log).toHaveLength(5);
			expect(policy.log[4].usage.energy_joules).toBe(5);
		});
	});

	describe("progressive escalation", () => {
		it("should escalate strategies as energy accumulates", () => {
			const policy = new EnergyAwarePolicy();
			const budget = { energy_budget_joules: 10 };
			const cheap = createCheapModel({ reasoning: true, inputModalities: ["text", "image"] });
			const availableModels = [cheap, createModel()];

			const d1 = policy.beforeModelCall(createCtx({ consumedEnergy: 1, budget, availableModels, turnNumber: 1 }));
			const d2 = policy.beforeModelCall(createCtx({ consumedEnergy: 3.5, budget, availableModels, turnNumber: 2 }));
			const d3 = policy.beforeModelCall(createCtx({ consumedEnergy: 5.5, budget, availableModels, turnNumber: 3 }));
			const d4 = policy.beforeModelCall(createCtx({ consumedEnergy: 7.5, budget, availableModels, turnNumber: 4 }));
			const d5 = policy.beforeModelCall(createCtx({ consumedEnergy: 10, budget, availableModels, turnNumber: 5 }));

			expect(d1).toEqual({});
			expect(d2.reason).toBeDefined();
			expect(d3.maxTokens).toBeDefined();
			expect(d4.model).toBeDefined();
			expect(d4.model!.id).toBe("neuralwatt-mini");
			expect(d5.abort).toBe(true);
		});
	});
});
