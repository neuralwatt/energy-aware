import { describe, expect, it } from "vitest";
import { discriminate } from "../src/discriminator/discriminator.js";
import type { ClassifyFn, DiscriminatorConfig } from "../src/discriminator/types.js";
import type { ModelInfo } from "../src/types.js";

const simpleModel: ModelInfo = {
	id: "simple-model",
	reasoning: false,
	inputModalities: ["text"],
	cost: { output: 0.16 },
	contextWindow: 16384,
	maxTokens: 4096,
};

const complexModel: ModelInfo = {
	id: "complex-model",
	reasoning: true,
	inputModalities: ["text", "image"],
	cost: { output: 4.14 },
	contextWindow: 262144,
	maxTokens: 16384,
};

const config: DiscriminatorConfig = {
	classifierModel: simpleModel,
	complex: { model: complexModel },
	simple: { model: simpleModel, briefMaxTokens: 256 },
};

describe("discriminator", () => {
	it("should return the tier from the classifier response", async () => {
		const classifyFn: ClassifyFn = async () => ({
			text: '{"tier":"simple","length":"full","reason":"trivial task"}',
			energyJ: 0.1,
		});

		const result = await discriminate("test", "hello world", config, classifyFn);
		expect(result.tier).toBe("simple");
		expect(result.model.id).toBe("simple-model");
		expect(result.reason).toBe("trivial task");
		expect(result.energyJ).toBe(0.1);
	});

	it("should fall back to complex on classifier error", async () => {
		const classifyFn: ClassifyFn = async () => {
			throw new Error("API error");
		};

		const result = await discriminate("test", "hello", config, classifyFn);
		expect(result.tier).toBe("complex");
		expect(result.model.id).toBe("complex-model");
		expect(result.reason).toBe("fallback (classifier error)");
	});

	it("should fall back to complex on invalid JSON", async () => {
		const classifyFn: ClassifyFn = async () => ({
			text: "not json at all",
			energyJ: 0,
		});

		const result = await discriminate("test", "hello", config, classifyFn);
		expect(result.tier).toBe("complex");
	});

	it("should apply maxTier clamping", async () => {
		const classifyFn: ClassifyFn = async () => ({
			text: '{"tier":"complex","length":"full","reason":"needs quality"}',
			energyJ: 0,
		});

		const result = await discriminate("test", "hello", config, classifyFn, undefined, { maxTier: "simple" });
		expect(result.tier).toBe("simple");
	});

	it("should apply minTier clamping", async () => {
		const classifyFn: ClassifyFn = async () => ({
			text: '{"tier":"simple","length":"full","reason":"easy"}',
			energyJ: 0,
		});

		const result = await discriminate("test", "hello", config, classifyFn, undefined, { minTier: "complex" });
		expect(result.tier).toBe("complex");
	});

	it("should apply briefMaxTokens when classifier says brief", async () => {
		const classifyFn: ClassifyFn = async () => ({
			text: '{"tier":"simple","length":"brief","reason":"quick answer"}',
			energyJ: 0,
		});

		const result = await discriminate("test", "hello", config, classifyFn);
		expect(result.maxTokens).toBe(256);
	});

	it("should fall back thinking to complex when thinking not configured", async () => {
		const classifyFn: ClassifyFn = async () => ({
			text: '{"tier":"thinking","length":"full","reason":"needs reasoning"}',
			energyJ: 0,
		});

		const result = await discriminate("test", "hello", config, classifyFn);
		expect(result.tier).toBe("complex");
		expect(result.model.id).toBe("complex-model");
	});

	it("should extract JSON from mixed text", async () => {
		const classifyFn: ClassifyFn = async () => ({
			text: 'Sure! Here is my classification: {"tier":"simple","length":"full","reason":"obvious"}',
			energyJ: 0.05,
		});

		const result = await discriminate("test", "hello", config, classifyFn);
		expect(result.tier).toBe("simple");
		expect(result.reason).toBe("obvious");
	});
});
