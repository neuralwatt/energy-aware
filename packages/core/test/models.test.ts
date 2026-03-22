import { describe, expect, it } from "vitest";
import { NEURALWATT_MODELS, ENERGY_EFFICIENCY, getNeuralwattModel } from "../src/models.js";

describe("NEURALWATT_MODELS catalog", () => {
	it("should have at least 5 models", () => {
		expect(NEURALWATT_MODELS.length).toBeGreaterThanOrEqual(5);
	});

	it("should be sorted by cost.output ascending", () => {
		for (let i = 1; i < NEURALWATT_MODELS.length; i++) {
			expect(NEURALWATT_MODELS[i].cost.output).toBeGreaterThanOrEqual(NEURALWATT_MODELS[i - 1].cost.output);
		}
	});

	it("should have no duplicate model IDs", () => {
		const ids = NEURALWATT_MODELS.map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("should have valid fields for every model", () => {
		for (const model of NEURALWATT_MODELS) {
			expect(model.id).toBeTruthy();
			expect(model.cost.output).toBeGreaterThan(0);
			expect(model.contextWindow).toBeGreaterThan(0);
			expect(model.maxTokens).toBeGreaterThan(0);
			expect(model.inputModalities.length).toBeGreaterThan(0);
			expect(typeof model.reasoning).toBe("boolean");
		}
	});

	it("should include known model IDs", () => {
		const ids = NEURALWATT_MODELS.map((m) => m.id);
		expect(ids).toContain("openai/gpt-oss-20b");
		expect(ids).toContain("mistralai/Devstral-Small-2-24B-Instruct-2512");
		expect(ids).toContain("Qwen/Qwen3.5-397B-A17B-FP8");
	});
});

describe("ENERGY_EFFICIENCY", () => {
	it("should have entries for known models", () => {
		expect(ENERGY_EFFICIENCY["Qwen/Qwen3.5-35B-A3B"]).toBeGreaterThan(0);
		expect(ENERGY_EFFICIENCY["mistralai/Devstral-Small-2-24B-Instruct-2512"]).toBeGreaterThan(0);
	});

	it("should have all positive values", () => {
		for (const [, tokPerJ] of Object.entries(ENERGY_EFFICIENCY)) {
			expect(tokPerJ).toBeGreaterThan(0);
		}
	});

	it("should return undefined for unknown models", () => {
		expect(ENERGY_EFFICIENCY["nonexistent-model"]).toBeUndefined();
	});
});

describe("getNeuralwattModel", () => {
	it("should return a model for a valid ID", () => {
		const model = getNeuralwattModel("openai/gpt-oss-20b");
		expect(model).toBeDefined();
		expect(model!.id).toBe("openai/gpt-oss-20b");
	});

	it("should return undefined for an unknown ID", () => {
		expect(getNeuralwattModel("nonexistent/model")).toBeUndefined();
	});

	it("should return undefined for empty string", () => {
		expect(getNeuralwattModel("")).toBeUndefined();
	});
});
