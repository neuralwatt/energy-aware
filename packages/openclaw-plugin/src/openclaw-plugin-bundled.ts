/**
 * Energy-Aware Router Plugin for OpenClaw
 *
 * Uses a lightweight 4-tier discriminator to classify each prompt and route
 * to the cheapest Neuralwatt model that can handle it:
 *
 *   thinking -> Kimi K2.5      ($0.52/$2.59/M) — CoT reasoning, debugging
 *   complex  -> Qwen3.5 397B   ($0.69/$4.14/M) — high quality, no CoT
 *   medium   -> Devstral 24B   ($0.12/$0.35/M) — standard implementation
 *   simple   -> GPT-OSS 20B   ($0.03/$0.16/M) — boilerplate, trivial
 *
 * The classifier itself runs on GPT-OSS 20B (cheapest model, ~0.1J per call).
 *
 * Also tracks energy consumption per turn with budget pressure display.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import OpenAI from "openai";

// -- Model tiers --------------------------------------------------------------

type Tier = "thinking" | "complex" | "medium" | "simple";

interface TierConfig {
  model: string;
  label: string;
  costOutput: number;
  briefMaxTokens?: number;
}

const TIERS: Record<Tier, TierConfig> = {
  thinking: { model: "moonshotai/Kimi-K2.5", label: "Kimi K2.5", costOutput: 2.59 },
  complex: { model: "Qwen/Qwen3.5-397B-A17B-FP8", label: "Qwen3.5 397B", costOutput: 4.14 },
  medium: { model: "mistralai/Devstral-Small-2-24B-Instruct-2512", label: "Devstral 24B", costOutput: 0.35, briefMaxTokens: 4096 },
  simple: { model: "openai/gpt-oss-20b", label: "GPT-OSS 20B", costOutput: 0.16, briefMaxTokens: 2048 },
};

const CLASSIFIER_MODEL = "openai/gpt-oss-20b";

const CLASSIFIER_SYSTEM_PROMPT =
  "You are a routing classifier for a four-tier coding AI system.\n" +
  "Choose the CHEAPEST tier that can handle the task correctly.\n" +
  "IMPORTANT: if the task would take a senior engineer more than 30 minutes, it is complex or thinking.\n\n" +
  "Tiers (cheapest first):\n" +
  '  "simple"   -- interface/type definitions, boilerplate, trivial wrappers, config files, re-exports\n' +
  '  "medium"   -- standard implementations with clear specs (e.g. LRU cache, debounce, event emitter, CRUD, middleware, validation)\n' +
  '  "complex"  -- non-trivial algorithms, probabilistic structures, concurrent/async coordination, parsers, state machines, anything needing careful invariant management (e.g. skip list, B-tree, CRDT, regex engine)\n' +
  '  "thinking" -- step-by-step debugging, root-cause analysis, performance reasoning, explaining subtle bugs\n\n' +
  'Also classify response length: "full" for complete implementations, "brief" for short answers.\n' +
  'Reply with ONLY valid JSON: {"tier":"medium","length":"full","reason":"<=10 words"}';

const TIER_ORDER: Tier[] = ["simple", "medium", "complex", "thinking"];
const VALID_TIERS: Tier[] = ["thinking", "complex", "medium", "simple"];

/** Tokens per joule for energy estimation. */
const ENERGY_EFFICIENCY: Record<string, number> = {
  "Qwen/Qwen3.5-35B-A3B": 27.51,
  "mistralai/Devstral-Small-2-24B-Instruct-2512": 22.35,
  "Qwen/Qwen3.5-397B-A17B-FP8": 1.03,
  "openai/gpt-oss-20b": 0.50,
  "MiniMaxAI/MiniMax-M2.5": 0.50,
  "moonshotai/Kimi-K2.5": 0.21,
};

const DEFAULT_BUDGET_JOULES = 25_000;

// -- Classifier ---------------------------------------------------------------

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (client) return client;
  const apiKey = process.env.NEURALWATT_API_KEY;
  if (!apiKey) return null;
  client = new OpenAI({ apiKey, baseURL: "https://api.neuralwatt.com/v1" });
  return client;
}

interface ClassifierResult {
  tier: Tier;
  tierConfig: TierConfig;
  reason: string;
  classifierEnergyJ: number;
}

async function classifyPrompt(prompt: string): Promise<ClassifierResult | null> {
  const c = getClient();
  if (!c) return null;

  try {
    const response = await c.chat.completions.create({
      model: CLASSIFIER_MODEL,
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: `Classify:\n${prompt.slice(0, 500)}` },
      ],
      max_tokens: 60,
      stream: false,
    });

    const text = response.choices[0]?.message?.content?.trim() ?? "";

    // Extract energy from response
    const responseAny = response as unknown as Record<string, unknown>;
    const energyObj = responseAny.energy as Record<string, unknown> | undefined;
    const classifierEnergyJ = typeof energyObj?.energy_joules === "number" ? energyObj.energy_joules : 0;

    // Parse JSON
    let parsed: { tier?: string; length?: string; reason?: string } = {};
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      const m = text.match(/\{[^{}]+\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]) as typeof parsed; } catch { /* fallback */ }
      }
    }

    const rawTier = typeof parsed.tier === "string" ? parsed.tier : "complex";
    const tier: Tier = (VALID_TIERS as string[]).includes(rawTier) ? rawTier as Tier : "complex";
    const reason = typeof parsed.reason === "string" && parsed.reason.length > 0
      ? parsed.reason.slice(0, 80)
      : tier;

    return {
      tier,
      tierConfig: TIERS[tier],
      reason,
      classifierEnergyJ,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 60) : "unknown error";
    console.log(`\x1b[31m[energy-aware]\x1b[0m classifier error: ${msg} — falling back to default model`);
    return null;
  }
}

// -- Plugin state -------------------------------------------------------------

let consumedEnergy = 0;
let turnNumber = 0;

function estimateEnergyJ(modelId: string, totalTokens: number): number {
  const tokPerJ = ENERGY_EFFICIENCY[modelId];
  if (tokPerJ && tokPerJ > 0) return totalTokens / tokPerJ;
  return totalTokens;
}

function energyBar(consumed: number, budget: number): string {
  const pct = budget > 0 ? consumed / budget : 0;
  const width = 15;
  const filled = Math.min(width, Math.round(Math.min(1, pct) * width));
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
  const color = pct >= 0.9 ? "\x1b[31m" : pct >= 0.7 ? "\x1b[33m" : "\x1b[32m";
  return `${color}[${bar}]\x1b[0m ${consumed.toFixed(0)}J/${budget}J`;
}

// -- Plugin definition --------------------------------------------------------

export default definePluginEntry({
  id: "energy-aware",
  name: "Energy-Aware Router",
  description: "4-tier discriminator routes each prompt to the cheapest adequate Neuralwatt model",

  register(api) {
    const budget = DEFAULT_BUDGET_JOULES;

    // Hook: before each LLM call — classify prompt and route to cheapest tier
    api.on("before_model_resolve", async (event) => {
      turnNumber++;

      // Classify the prompt
      const result = await classifyPrompt(event.prompt);

      if (!result) {
        console.log(
          `\x1b[36m[energy-aware]\x1b[0m Turn ${turnNumber}: no classifier available, using default model`,
        );
        return;
      }

      // Track classifier energy cost
      if (result.classifierEnergyJ > 0) {
        consumedEnergy += result.classifierEnergyJ;
      }

      // Display routing decision
      const tierIdx = TIER_ORDER.indexOf(result.tier);
      const tierColors = ["\x1b[32m", "\x1b[36m", "\x1b[35m", "\x1b[33m"]; // green, cyan, magenta, yellow
      const tierColor = tierColors[tierIdx] ?? "\x1b[36m";

      console.log("");
      console.log(
        `${tierColor}  [energy-aware] ` +
        `${result.tier.toUpperCase()} -> ${result.tierConfig.label} ` +
        `($${result.tierConfig.costOutput}/M output)\x1b[0m`,
      );
      console.log(
        `  \x1b[2mReason: ${result.reason} | ` +
        `Classifier cost: ${result.classifierEnergyJ.toFixed(1)}J | ` +
        `${energyBar(consumedEnergy, budget)}\x1b[0m`,
      );
      console.log("");

      return {
        modelOverride: result.tierConfig.model,
        providerOverride: "neuralwatt",
      };
    });

    // Hook: after each LLM response — track energy consumption
    api.on("llm_output", (event) => {
      const usage = event.usage;
      if (!usage) return;

      // Use output tokens only for estimation — input tokens include
      // cached system prompt which doesn't represent actual compute
      const outputTokens = usage.output ?? 0;

      // Check for actual energy data first (not yet propagated by openclaw)
      const usageAny = usage as Record<string, unknown>;
      const actualEnergyJ = typeof usageAny.energy_joules === "number" ? usageAny.energy_joules : undefined;

      const energyJ = actualEnergyJ ?? estimateEnergyJ(event.model, outputTokens);
      consumedEnergy += energyJ;

      console.log("");
      console.log(
        `  \x1b[36m[energy-aware] Response complete:\x1b[0m ${event.model}`,
      );
      console.log(
        `  \x1b[2mTokens: ${(usage.input ?? 0)} in / ${(usage.output ?? 0)} out | ` +
        `Energy: ${energyJ.toFixed(1)}J | ` +
        `${energyBar(consumedEnergy, budget)}\x1b[0m`,
      );
      console.log("");
    });
  },
});
