import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("barrel exports", () => {
	it("should export EnergyAwarePolicy class", () => {
		expect(core.EnergyAwarePolicy).toBeDefined();
		expect(new core.EnergyAwarePolicy().name).toBe("energy-aware");
	});

	it("should export BaselinePolicy class", () => {
		expect(core.BaselinePolicy).toBeDefined();
		expect(new core.BaselinePolicy().name).toBe("baseline");
	});

	it("should export EnergySession class", () => {
		expect(core.EnergySession).toBeDefined();
		const session = new core.EnergySession({
			policy: new core.BaselinePolicy(),
			budget: { energy_budget_joules: 10 },
			availableModels: [],
		});
		expect(session.pressure).toBe(0);
	});

	it("should export telemetry functions", () => {
		expect(typeof core.buildTelemetryRecord).toBe("function");
		expect(typeof core.serializeTelemetryRecord).toBe("function");
		expect(typeof core.parseTelemetryRecord).toBe("function");
		expect(typeof core.appendTelemetryLine).toBe("function");
		expect(typeof core.parseTelemetryLines).toBe("function");
	});

	it("should export extractEnergyFromUsage", () => {
		expect(typeof core.extractEnergyFromUsage).toBe("function");
		const result = core.extractEnergyFromUsage({ energy_joules: 1.0 });
		expect(result).toBeDefined();
	});

	it("should export model catalog", () => {
		expect(core.NEURALWATT_MODELS).toBeDefined();
		expect(core.NEURALWATT_MODELS.length).toBeGreaterThan(0);
		expect(core.ENERGY_EFFICIENCY).toBeDefined();
		expect(typeof core.getNeuralwattModel).toBe("function");
	});

	it("should export discriminator", () => {
		expect(typeof core.discriminate).toBe("function");
		expect(typeof core.DEFAULT_DISCRIMINATOR_SYSTEM_PROMPT).toBe("string");
		expect(core.DEFAULT_DISCRIMINATOR_SYSTEM_PROMPT.length).toBeGreaterThan(0);
	});

	it("should export LLM client functions", () => {
		expect(typeof core.completeSimple).toBe("function");
		expect(typeof core.streamSimple).toBe("function");
	});

	it("should export fetchNeuralwattModels", () => {
		expect(typeof core.fetchNeuralwattModels).toBe("function");
	});

	it("should have extended ModelInfo fields in catalog", () => {
		const model = core.NEURALWATT_MODELS[0];
		expect(model.provider).toBe("neuralwatt");
		expect(model.baseUrl).toBe("https://api.neuralwatt.com/v1");
		expect(model.name).toBeTruthy();
		expect(model.cost.input).toBeDefined();
	});
});
