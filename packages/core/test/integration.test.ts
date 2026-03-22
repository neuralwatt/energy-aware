import { describe, expect, it } from "vitest";
import { EnergyAwarePolicy } from "../src/policy/energy-aware-policy.js";
import { BaselinePolicy } from "../src/policy/baseline-policy.js";
import { EnergySession } from "../src/session.js";
import { NEURALWATT_MODELS } from "../src/models.js";
import { extractEnergyFromUsage } from "../src/energy-extraction.js";
import { buildTelemetryRecord, parseTelemetryRecord, serializeTelemetryRecord } from "../src/telemetry/serialization.js";
import { discriminate } from "../src/discriminator/discriminator.js";
import type { ModelInfo, UsageWithEnergy } from "../src/types.js";
import type { ClassifyFn, DiscriminatorConfig } from "../src/discriminator/types.js";

describe("integration: session + policy + telemetry", () => {
	it("should track a full multi-turn workflow with progressive escalation", () => {
		// Use a reasoning model so reasoning reduction can fire
		const expensive: ModelInfo = {
			id: "expensive-reasoning",
			reasoning: true,
			inputModalities: ["text", "image"],
			cost: { output: 15 },
			contextWindow: 128000,
			maxTokens: 4096,
		};
		const cheap: ModelInfo = {
			id: "cheap-model",
			reasoning: true,
			inputModalities: ["text", "image"],
			cost: { output: 1 },
			contextWindow: 32000,
			maxTokens: 2048,
		};
		const models = [cheap, expensive];

		const session = new EnergySession({
			policy: new EnergyAwarePolicy(),
			budget: { energy_budget_joules: 10 },
			availableModels: models,
		});

		// Turn 1: 0% pressure (0J consumed) — no intervention
		const d1 = session.beforeCall(expensive);
		expect(d1).toEqual({});
		session.afterCall({ input: 500, output: 200, totalTokens: 700, cost: { total: 0.01 }, energy_joules: 2 });
		expect(session.pressure).toBeCloseTo(0.2); // 2/10

		// Turn 2: 20% pressure (2J consumed) — still no intervention (<=30%)
		const d2 = session.beforeCall(expensive);
		expect(d2).toEqual({});
		session.afterCall({ input: 500, output: 200, totalTokens: 700, cost: { total: 0.01 }, energy_joules: 2 });
		expect(session.pressure).toBeCloseTo(0.4); // 4/10

		// Turn 3: 40% pressure (4J consumed) — reasoning reduction fires (>30%)
		const d3 = session.beforeCall(expensive);
		expect(d3.reasoning).toBeDefined();
		expect(d3.reasoning).toBe("medium");
		session.afterCall({ input: 500, output: 200, totalTokens: 700, cost: { total: 0.01 }, energy_joules: 2 });
		expect(session.pressure).toBeCloseTo(0.6); // 6/10

		// Turn 4: 60% pressure (6J consumed) — token reduction + reasoning
		// At exactly 60%, reasoning is still "medium" (threshold is >60% for "low")
		const d4 = session.beforeCall(expensive);
		expect(d4.maxTokens).toBeDefined();
		expect(d4.reasoning).toBe("medium");
		session.afterCall({ input: 500, output: 200, totalTokens: 700, cost: { total: 0.01 }, energy_joules: 2 });
		expect(session.pressure).toBeCloseTo(0.8); // 8/10

		// Turn 5: 80% pressure (8J consumed) — model routing + reasoning low
		// At exactly 80%, reasoning is "low" (threshold for "minimal" is >80%)
		const d5 = session.beforeCall(expensive);
		expect(d5.model).toBeDefined();
		expect(d5.model!.cost.output).toBeLessThan(expensive.cost.output);
		expect(d5.reasoning).toBe("low");
		session.afterCall({ input: 500, output: 200, totalTokens: 700, cost: { total: 0.01 }, energy_joules: 2 });

		// Turn 6: 100% pressure (10J consumed) — abort
		const d6 = session.beforeCall(expensive);
		expect(d6.abort).toBe(true);

		expect(session.telemetryLog).toHaveLength(5);
		expect(session.turnNumber).toBe(6);
		expect(session.consumedEnergy).toBe(10);
	});

	it("should create a valid telemetry record from session data after each call", () => {
		const session = new EnergySession({
			policy: new BaselinePolicy(),
			budget: { energy_budget_joules: 100 },
			availableModels: [...NEURALWATT_MODELS],
		});

		session.beforeCall(NEURALWATT_MODELS[0]);
		session.afterCall({ input: 100, output: 50, totalTokens: 150, cost: { total: 0.001 }, energy_joules: 0.42 });

		const log = session.telemetryLog;
		expect(log).toHaveLength(1);

		// Verify telemetry record has valid fields
		const record = log[0];
		expect(record.task_id).toBeTruthy();
		expect(record.energy_joules).toBe(0.42);
		expect(record.tokens.input).toBe(100);
		expect(record.tokens.output).toBe(50);
		expect(record.tokens.total).toBe(150);

		// Verify round-trip serialization
		const serialized = serializeTelemetryRecord(record);
		const parsed = parseTelemetryRecord(serialized);
		expect(parsed).toEqual(record);
	});
});

describe("integration: energy extraction + telemetry pipeline", () => {
	it("should flow energy data from raw usage to telemetry record", () => {
		const rawUsage = {
			prompt_tokens: 100,
			completion_tokens: 50,
			total_tokens: 150,
			energy_joules: 0.42,
			energy_kwh: 0.000000116667,
			duration_seconds: 1.5,
		};

		const energy = extractEnergyFromUsage(rawUsage);
		expect(energy).toBeDefined();

		const record = buildTelemetryRecord({
			task_id: "task-1",
			run_id: "run-1",
			step_id: "step-1",
			model: "openai/gpt-oss-20b",
			provider: "neuralwatt",
			usage: { input: 100, output: 50, totalTokens: 150 },
			energy: energy!,
			latency_ms: 1500,
		});

		expect(record.energy_joules).toBe(0.42);
		expect(record.energy_kwh).toBe(0.000000116667);

		// Full round-trip
		const line = serializeTelemetryRecord(record);
		const parsed = parseTelemetryRecord(line);
		expect(parsed.energy_joules).toBe(0.42);
	});
});

describe("integration: discriminator + session routing", () => {
	it("should classify prompt then use routing in session", async () => {
		const models = [...NEURALWATT_MODELS];
		const cheap = models[0];
		const expensive = models[models.length - 1];

		const config: DiscriminatorConfig = {
			classifierModel: cheap,
			complex: { model: expensive },
			simple: { model: cheap },
		};

		const classifyFn: ClassifyFn = async () => ({
			text: '{"tier":"simple","length":"full","reason":"trivial"}',
			energyJ: 0.05,
		});

		const decision = await discriminate("test", "hello world", config, classifyFn);
		expect(decision.tier).toBe("simple");
		expect(decision.model.id).toBe(cheap.id);

		// Use the discriminator result in a session
		const session = new EnergySession({
			policy: new EnergyAwarePolicy(),
			budget: { energy_budget_joules: 50 },
			availableModels: models,
		});

		const sessionDecision = session.beforeCall(decision.model);
		expect(sessionDecision.abort).toBeUndefined(); // fresh session, no pressure
	});
});

describe("integration: NEURALWATT_MODELS with EnergyAwarePolicy", () => {
	it("should route to cheapest real model under pressure", () => {
		const models = [...NEURALWATT_MODELS];
		const expensive = models[models.length - 1]; // most expensive
		const policy = new EnergyAwarePolicy();

		const ctx = {
			turnNumber: 1,
			model: expensive,
			availableModels: models,
			budget: { energy_budget_joules: 10 },
			consumedEnergy: 8, // 80% pressure
			consumedTime: 0,
			messageCount: 1,
			estimatedInputTokens: 0,
		};

		const decision = policy.beforeModelCall(ctx);
		expect(decision.model).toBeDefined();
		// Should route to cheapest model (first in sorted list)
		expect(decision.model!.id).toBe(models[0].id);
		expect(decision.model!.cost.output).toBeLessThan(expensive.cost.output);
	});
});
