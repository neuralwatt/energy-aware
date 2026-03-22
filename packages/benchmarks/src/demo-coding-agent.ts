#!/usr/bin/env node
/**
 * Demo: Energy-Aware Coding Agent
 *
 * A real coding agent that uses Neuralwatt models with the energy-aware
 * architecture. Shows the 4-tier discriminator routing prompts to the
 * cheapest adequate model, with live energy tracking.
 *
 * This demo uses @neuralwatt/energy-aware-core directly with the openai
 * npm package — NO pi-mono dependency.
 *
 * Usage:
 *   NEURALWATT_API_KEY=... npx tsx packages/benchmarks/src/demo-coding-agent.ts
 *   NEURALWATT_API_KEY=... npx tsx packages/benchmarks/src/demo-coding-agent.ts --budget 25000
 *   NEURALWATT_API_KEY=... npx tsx packages/benchmarks/src/demo-coding-agent.ts --baseline
 *
 * Requires: NEURALWATT_API_KEY environment variable
 */

import { parseArgs } from "node:util";
import OpenAI from "openai";
import {
	EnergyAwarePolicy,
	BaselinePolicy,
	EnergySession,
	NEURALWATT_MODELS,
	extractEnergyFromUsage,
	discriminate,
	type ModelInfo,
	type ClassifyFn,
	type DiscriminatorConfig,
	type PolicyDecision,
} from "@neuralwatt/energy-aware-core";

// -- CLI args -----------------------------------------------------------------

const { values: args } = parseArgs({
	options: {
		budget: { type: "string", default: "25000" },
		baseline: { type: "boolean", default: false },
		turns: { type: "string", default: "5" },
	},
});

const BUDGET_JOULES = parseInt(args.budget!, 10);
const BASELINE_ONLY = args.baseline!;
const MAX_TURNS = parseInt(args.turns!, 10);

// -- API setup ----------------------------------------------------------------

const apiKey = process.env.NEURALWATT_API_KEY;
if (!apiKey) {
	console.error("Error: NEURALWATT_API_KEY environment variable is required.");
	console.error("Get a key at https://portal.neuralwatt.com");
	process.exit(1);
}

const client = new OpenAI({
	apiKey,
	baseURL: "https://api.neuralwatt.com/v1",
});

// -- Model catalog (using core's catalog) -------------------------------------

const models = [...NEURALWATT_MODELS];
// Find specific models for discriminator tiers
const findModel = (substr: string) => models.find((m) => m.id.includes(substr))!;

const KIMI = findModel("Kimi-K2.5");
const QWEN_397B = findModel("Qwen3.5-397B");
const DEVSTRAL = findModel("Devstral");
const GPT_OSS = findModel("gpt-oss");

// -- LLM call wrapper ---------------------------------------------------------

interface LLMResult {
	text: string;
	energyJ: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

async function callLLM(
	model: ModelInfo,
	systemPrompt: string,
	messages: Array<{ role: "user" | "assistant"; content: string }>,
	maxTokens?: number,
): Promise<LLMResult> {
	const response = await client.chat.completions.create({
		model: model.id,
		messages: [
			{ role: "system", content: systemPrompt },
			...messages,
		],
		max_tokens: maxTokens ?? model.maxTokens,
		stream: false,
		stream_options: undefined,
	});

	const text = response.choices[0]?.message?.content ?? "";
	const usage = response.usage as unknown as Record<string, unknown>;

	const energy = extractEnergyFromUsage(usage ?? {});

	return {
		text,
		energyJ: energy?.energy_joules ?? 0,
		inputTokens: (usage?.prompt_tokens as number) ?? 0,
		outputTokens: (usage?.completion_tokens as number) ?? 0,
		totalTokens: (usage?.total_tokens as number) ?? 0,
	};
}

// -- Discriminator setup ------------------------------------------------------

const classifyFn: ClassifyFn = async (systemPrompt, userPrompt, maxTokens) => {
	const result = await callLLM(GPT_OSS, systemPrompt, [{ role: "user", content: userPrompt }], maxTokens);
	return { text: result.text, energyJ: result.energyJ };
};

const discriminatorConfig: DiscriminatorConfig = {
	classifierModel: GPT_OSS,
	thinking: { model: KIMI },
	complex: { model: QWEN_397B },
	medium: { model: DEVSTRAL, briefMaxTokens: 4096 },
	simple: { model: GPT_OSS, briefMaxTokens: 2048 },
	systemPrompt:
		"You are a routing classifier for a four-tier coding AI system.\n" +
		"Choose the CHEAPEST tier that can handle the task correctly:\n" +
		'  "thinking" -- step-by-step reasoning, debugging, algorithmic puzzles\n' +
		'  "complex"  -- novel architecture, design decisions\n' +
		'  "medium"   -- standard implementation, clear spec\n' +
		'  "simple"   -- boilerplate, types, trivial wrappers\n' +
		'Reply with ONLY valid JSON: {"tier":"medium","length":"full","reason":"<=10 words"}',
};

// -- Display helpers ----------------------------------------------------------

function energyBar(consumed: number, budget: number, width = 20): string {
	if (budget <= 0) return `${consumed.toFixed(2)}J`;
	const pct = consumed / budget;
	const filled = Math.min(width, Math.round(Math.min(1, pct) * width));
	const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
	const color = pct >= 0.9 ? "\x1b[31m" : pct >= 0.7 ? "\x1b[33m" : "\x1b[32m";
	return `${color}[${bar}]\x1b[0m ${consumed.toFixed(0)}J / ${budget}J (${Math.round(pct * 100)}%)`;
}

// -- Task definition ----------------------------------------------------------

const SYSTEM_PROMPT =
	"You are an expert TypeScript engineer. " +
	"Implement code concisely and correctly. " +
	"Each response should be tightly focused. " +
	"No preamble, no prose explanations, just the code.";

const BUILD_TURNS = [
	"Design a TypeScript interface for an LRU cache: LRUCacheOptions (capacity: number) and the LRUCache<K,V> class with get(key), set(key, value), has(key), delete(key), clear(), and a size property. Keep it concise.",
	"Implement the LRUCache<K,V> class using a Map for O(1) operations. The Map insertion order tracks recency — on get/set, delete and re-insert the key. Add JSDoc.",
	"Add eviction callback support: LRUCacheOptions gets an optional onEvict(key, value) callback. When capacity is exceeded, evict the least recently used entry and call onEvict. Also add a peek(key) method that reads without updating recency.",
	"Add input validation to the constructor (capacity must be positive integer). Add a forEach(fn) method and a toJSON() method that returns the cache contents as an array of [key, value] pairs in LRU order.",
];

const CONSOLIDATE_PROMPT =
	"Write the final complete TypeScript implementation combining everything into a single file.\n" +
	"Required exports: LRUCacheOptions interface, LRUCache class.\n" +
	"No imports except node standard lib. Output raw TypeScript only.";

// -- Main run -----------------------------------------------------------------

interface ModeResult {
	mode: string;
	totalEnergyJ: number;
	turns: number;
	decisions: string[];
}

async function runMode(mode: "baseline" | "energy-aware"): Promise<ModeResult> {
	const isBaseline = mode === "baseline";
	const policy = isBaseline ? new BaselinePolicy() : new EnergyAwarePolicy();

	const session = new EnergySession({
		policy,
		budget: { energy_budget_joules: BUDGET_JOULES },
		availableModels: models,
	});

	const conversation: Array<{ role: "user" | "assistant"; content: string }> = [];
	const decisions: string[] = [];
	let turnCount = 0;
	const maxTurns = Math.min(MAX_TURNS, BUILD_TURNS.length + 1); // +1 for consolidate

	const tag = isBaseline ? "\x1b[36m[baseline]\x1b[0m" : "\x1b[35m[energy-\u25BC]\x1b[0m";

	for (let i = 0; i < maxTurns; i++) {
		const isConsolidate = i === BUILD_TURNS.length;
		const prompt = isConsolidate ? CONSOLIDATE_PROMPT : BUILD_TURNS[i];
		const phase = isConsolidate ? "consolidate" : `build-${i + 1}`;

		// Determine model for this turn
		let effectiveModel: ModelInfo;
		let decisionLabel = "";

		if (isBaseline) {
			effectiveModel = KIMI; // baseline always uses expensive model
		} else {
			// Use discriminator to pick the right tier
			const routing = await discriminate(phase, prompt, discriminatorConfig, classifyFn);
			effectiveModel = routing.model;

			// Also consult the session for budget-pressure overrides
			const sessionDecision: PolicyDecision = session.beforeCall(effectiveModel);

			if (sessionDecision.abort) {
				console.log(`${tag} Turn ${i + 1} ABORTED — budget exhausted`);
				decisions.push(`Turn ${i + 1}: ABORT`);
				break;
			}

			if (sessionDecision.model) {
				effectiveModel = sessionDecision.model;
				decisionLabel = `policy override: ${sessionDecision.reason}`;
			} else {
				decisionLabel = `discriminator: ${routing.tier} (${routing.reason})`;
			}

			// Track discriminator energy
			if (routing.energyJ > 0) {
				session.afterCall({
					input: 0, output: 0, totalTokens: 0,
					cost: { total: 0 }, energy_joules: routing.energyJ,
				});
			}
		}

		if (isBaseline) {
			session.beforeCall(effectiveModel);
		}

		console.log(`\n${tag} Turn ${i + 1}/${maxTurns}  [${phase}]  model: ${effectiveModel.id}`);
		if (decisionLabel) console.log(`          ${decisionLabel}`);
		console.log(`          ${energyBar(session.consumedEnergy, BUDGET_JOULES)}`);

		// Make the LLM call
		conversation.push({ role: "user", content: prompt });
		const result = await callLLM(effectiveModel, SYSTEM_PROMPT, conversation);
		conversation.push({ role: "assistant", content: result.text });

		// Track energy
		session.afterCall({
			input: result.inputTokens,
			output: result.outputTokens,
			totalTokens: result.totalTokens,
			cost: { total: 0 },
			energy_joules: result.energyJ,
		});

		const energyLabel = result.energyJ > 0 ? `${result.energyJ.toFixed(2)}J` : "0J (no telemetry)";
		console.log(`          tokens: ${result.inputTokens}in/${result.outputTokens}out  energy: ${energyLabel}`);

		const codePreview = result.text.split("\n").slice(0, 3).join("\n");
		console.log(`          \x1b[2m${codePreview}...\x1b[0m`);

		decisions.push(`Turn ${i + 1} [${phase}]: ${effectiveModel.id} — ${energyLabel}`);
		turnCount++;
	}

	return {
		mode,
		totalEnergyJ: session.consumedEnergy,
		turns: turnCount,
		decisions,
	};
}

// -- Entry point --------------------------------------------------------------

async function main() {
	console.log("=== Energy-Aware Coding Agent Demo ===\n");
	console.log(`Budget: ${BUDGET_JOULES}J | Max turns: ${MAX_TURNS} | Task: LRU Cache`);
	console.log(`Models: ${models.map((m) => m.id.split("/").pop()).join(", ")}\n`);

	const results: ModeResult[] = [];

	if (BASELINE_ONLY) {
		results.push(await runMode("baseline"));
	} else {
		// Run both modes
		console.log("--- Baseline Mode ---");
		results.push(await runMode("baseline"));
		console.log("\n\n--- Energy-Aware Mode ---");
		results.push(await runMode("energy-aware"));
	}

	// Summary
	console.log("\n\n=== Summary ===\n");
	for (const r of results) {
		const label = r.mode === "baseline" ? "Baseline    " : "Energy-Aware";
		console.log(`${label}: ${r.totalEnergyJ.toFixed(2)}J total, ${r.turns} turns`);
		for (const d of r.decisions) {
			console.log(`  ${d}`);
		}
	}

	if (results.length === 2) {
		const [baseline, ea] = results;
		if (baseline.totalEnergyJ > 0) {
			const savings = ((baseline.totalEnergyJ - ea.totalEnergyJ) / baseline.totalEnergyJ) * 100;
			console.log(`\nEnergy saved: ${savings.toFixed(1)}%`);
		}
	}
}

main().catch((e) => {
	console.error("Fatal error:", e);
	process.exit(1);
});
