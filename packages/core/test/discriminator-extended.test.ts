import { describe, expect, it } from "vitest";
import { discriminate, DEFAULT_DISCRIMINATOR_SYSTEM_PROMPT } from "../src/discriminator/discriminator.js";
import type { ClassifyFn, DiscriminatorConfig } from "../src/discriminator/types.js";
import type { ModelInfo } from "../src/types.js";

const simpleModel: ModelInfo = {
	id: "simple", reasoning: false, inputModalities: ["text"],
	cost: { output: 0.16 }, contextWindow: 16384, maxTokens: 4096,
};
const mediumModel: ModelInfo = {
	id: "medium", reasoning: false, inputModalities: ["text"],
	cost: { output: 0.35 }, contextWindow: 262144, maxTokens: 16384,
};
const complexModel: ModelInfo = {
	id: "complex", reasoning: true, inputModalities: ["text", "image"],
	cost: { output: 4.14 }, contextWindow: 262144, maxTokens: 16384,
};
const thinkingModel: ModelInfo = {
	id: "thinking", reasoning: true, inputModalities: ["text"],
	cost: { output: 2.59 }, contextWindow: 262144, maxTokens: 16384,
};

const fullConfig: DiscriminatorConfig = {
	classifierModel: simpleModel,
	thinking: { model: thinkingModel },
	complex: { model: complexModel },
	medium: { model: mediumModel, briefMaxTokens: 512 },
	simple: { model: simpleModel, briefMaxTokens: 256 },
};

function classifyAs(tier: string, length = "full", reason = "test"): ClassifyFn {
	return async () => ({
		text: JSON.stringify({ tier, length, reason }),
		energyJ: 0.1,
	});
}

describe("discriminator extended", () => {
	it("should resolve all 4 tiers when fully configured", async () => {
		for (const tier of ["simple", "medium", "complex", "thinking"] as const) {
			const result = await discriminate("test", "hello", fullConfig, classifyAs(tier));
			expect(result.tier).toBe(tier);
		}
	});

	it("should fall back medium to simple when medium not configured", async () => {
		const config: DiscriminatorConfig = {
			classifierModel: simpleModel,
			complex: { model: complexModel },
			simple: { model: simpleModel },
		};
		const result = await discriminate("test", "hello", config, classifyAs("medium"));
		expect(result.tier).toBe("simple");
		expect(result.model.id).toBe("simple");
	});

	it("should fall back thinking to complex when thinking not configured", async () => {
		const config: DiscriminatorConfig = {
			classifierModel: simpleModel,
			complex: { model: complexModel },
			simple: { model: simpleModel },
		};
		const result = await discriminate("test", "hello", config, classifyAs("thinking"));
		expect(result.tier).toBe("complex");
		expect(result.model.id).toBe("complex");
	});

	it("should handle minTier > maxTier (maxTier wins)", async () => {
		const result = await discriminate("test", "hello", fullConfig, classifyAs("complex"), undefined, {
			minTier: "complex",
			maxTier: "simple",
		});
		expect(result.tier).toBe("simple"); // maxTier takes precedence
	});

	it("should truncate prompt to 500 chars", async () => {
		const longPrompt = "a".repeat(1000);
		let capturedInput = "";
		const fn: ClassifyFn = async (_sys, user) => {
			capturedInput = user;
			return { text: '{"tier":"simple","length":"full","reason":"ok"}', energyJ: 0 };
		};
		await discriminate("test", longPrompt, fullConfig, fn);
		// The input contains prefix + classify header + truncated prompt
		expect(capturedInput.length).toBeLessThan(600); // 500 chars + overhead
	});

	it("should handle empty prompt", async () => {
		const result = await discriminate("test", "", fullConfig, classifyAs("simple"));
		expect(result.tier).toBe("simple");
	});

	it("should use custom system prompt when provided", async () => {
		let capturedSystem = "";
		const fn: ClassifyFn = async (sys) => {
			capturedSystem = sys;
			return { text: '{"tier":"simple","length":"full","reason":"ok"}', energyJ: 0 };
		};
		const config = { ...fullConfig, systemPrompt: "CUSTOM PROMPT" };
		await discriminate("test", "hello", config, fn);
		expect(capturedSystem).toBe("CUSTOM PROMPT");
	});

	it("should use default system prompt when none provided", async () => {
		let capturedSystem = "";
		const fn: ClassifyFn = async (sys) => {
			capturedSystem = sys;
			return { text: '{"tier":"simple","length":"full","reason":"ok"}', energyJ: 0 };
		};
		await discriminate("test", "hello", fullConfig, fn);
		expect(capturedSystem).toBe(DEFAULT_DISCRIMINATOR_SYSTEM_PROMPT);
	});

	it("should include memContext in classifier input", async () => {
		let capturedInput = "";
		const fn: ClassifyFn = async (_sys, user) => {
			capturedInput = user;
			return { text: '{"tier":"simple","length":"full","reason":"ok"}', energyJ: 0 };
		};
		await discriminate("test", "hello", fullConfig, fn, "MEMORY CONTEXT HERE");
		expect(capturedInput).toContain("MEMORY CONTEXT HERE");
	});

	it("should handle reason longer than 80 chars by truncating", async () => {
		const longReason = "x".repeat(200);
		const result = await discriminate("test", "hello", fullConfig, classifyAs("simple", "full", longReason));
		expect(result.reason.length).toBeLessThanOrEqual(80);
	});

	it("should default to resolved tier name when reason is empty", async () => {
		const fn: ClassifyFn = async () => ({
			text: '{"tier":"medium","length":"full","reason":""}',
			energyJ: 0,
		});
		const result = await discriminate("test", "hello", fullConfig, fn);
		expect(result.reason).toBe("medium");
	});

	it("should handle invalid tier string by defaulting to complex", async () => {
		const fn: ClassifyFn = async () => ({
			text: '{"tier":"super-ultra","length":"full","reason":"ok"}',
			energyJ: 0,
		});
		const result = await discriminate("test", "hello", fullConfig, fn);
		expect(result.tier).toBe("complex");
	});

	it("should handle non-string tier by defaulting to complex", async () => {
		const fn: ClassifyFn = async () => ({
			text: '{"tier":42,"length":"full","reason":"ok"}',
			energyJ: 0,
		});
		const result = await discriminate("test", "hello", fullConfig, fn);
		expect(result.tier).toBe("complex");
	});

	it("should return briefMaxTokens for medium tier with brief length", async () => {
		const result = await discriminate("test", "hello", fullConfig, classifyAs("medium", "brief"));
		expect(result.maxTokens).toBe(512);
	});

	it("should return undefined maxTokens for full length", async () => {
		const result = await discriminate("test", "hello", fullConfig, classifyAs("medium", "full"));
		expect(result.maxTokens).toBeUndefined();
	});

	it("should handle extra JSON fields gracefully", async () => {
		const fn: ClassifyFn = async () => ({
			text: '{"tier":"simple","length":"brief","reason":"ok","extra":"data","nested":{"x":1}}',
			energyJ: 0,
		});
		const result = await discriminate("test", "hello", fullConfig, fn);
		expect(result.tier).toBe("simple");
	});

	it("should propagate energyJ from classifyFn", async () => {
		const fn: ClassifyFn = async () => ({
			text: '{"tier":"simple","length":"full","reason":"ok"}',
			energyJ: 0.42,
		});
		const result = await discriminate("test", "hello", fullConfig, fn);
		expect(result.energyJ).toBe(0.42);
	});

	it("should include phase in classifier input", async () => {
		let capturedInput = "";
		const fn: ClassifyFn = async (_sys, user) => {
			capturedInput = user;
			return { text: '{"tier":"simple","length":"full","reason":"ok"}', energyJ: 0 };
		};
		await discriminate("build-1", "hello", fullConfig, fn);
		expect(capturedInput).toContain("build-1");
	});
});
