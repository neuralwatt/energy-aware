/**
 * @neuralwatt/energy-aware-openclaw
 *
 * OpenClaw plugin that adds energy-aware model routing using Neuralwatt models.
 *
 * Integration approach:
 * - Uses `before_model_resolve` hook to route to cheaper models under budget pressure
 * - Uses `llm_output` hook to track energy consumption per call
 * - Energy estimation uses tokens-per-joule efficiency data when actual energy
 *   telemetry is not available (upgrades automatically when openclaw propagates
 *   energy data from the provider response)
 * - Plugin holds EnergySession state in closure across hook calls
 *
 * No upstream openclaw changes required.
 *
 * Install: openclaw plugins install @neuralwatt/energy-aware-openclaw
 * Config:
 *   plugins:
 *     "@neuralwatt/energy-aware-openclaw":
 *       enabled: true
 *       budget_joules: 50
 */

// When openclaw is built/installed, replace with: import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "./openclaw-types/index.js";
import {
	EnergyAwarePolicy,
	EnergySession,
	NEURALWATT_MODELS,
	ENERGY_EFFICIENCY,
	type ModelInfo,
	type UsageWithEnergy,
} from "@neuralwatt/energy-aware-core";

const PLUGIN_ID = "energy-aware";
const DEFAULT_BUDGET_JOULES = 50;

/**
 * Map a Neuralwatt model ID to our ModelInfo catalog entry.
 * Falls back to a generic entry if the model isn't in our catalog.
 */
function resolveModelInfo(modelId: string): ModelInfo | undefined {
	return NEURALWATT_MODELS.find((m) => m.id === modelId);
}

/**
 * Estimate energy from token usage when actual energy telemetry is unavailable.
 * Uses the ENERGY_EFFICIENCY table (tokens per joule) to approximate.
 */
function estimateEnergyJoules(modelId: string, totalTokens: number): number {
	const tokensPerJoule = ENERGY_EFFICIENCY[modelId];
	if (tokensPerJoule && tokensPerJoule > 0) {
		return totalTokens / tokensPerJoule;
	}
	// Conservative fallback: assume 1 token/joule for unknown models
	return totalTokens;
}

export default definePluginEntry({
	id: PLUGIN_ID,
	name: "Energy-Aware Router",
	description: "Energy-aware model routing via Neuralwatt — reduces energy consumption while maintaining task quality",

	register(api) {
		// Create the energy session in the plugin closure — persists across hook calls
		const session = new EnergySession({
			policy: new EnergyAwarePolicy(),
			budget: { energy_budget_joules: DEFAULT_BUDGET_JOULES },
			availableModels: [...NEURALWATT_MODELS],
		});

		// Track the last model used for energy estimation in llm_output
		let lastModelId: string | undefined;

		/**
		 * Hook: before_model_resolve
		 *
		 * Called before each LLM request. Consults the EnergySession to decide
		 * if we should route to a cheaper model based on budget pressure.
		 */
		api.on("before_model_resolve", (event) => {
			const currentModel = lastModelId ? resolveModelInfo(lastModelId) : NEURALWATT_MODELS[NEURALWATT_MODELS.length - 1];
			if (!currentModel) return;

			const decision = session.beforeCall(currentModel);

			if (decision.abort) {
				// Budget exhausted — we can't actually abort from this hook,
				// but we can route to the cheapest model to minimize further spend
				return {
					modelOverride: NEURALWATT_MODELS[0].id,
					providerOverride: "neuralwatt",
				};
			}

			if (decision.model && decision.model.id !== currentModel.id) {
				return {
					modelOverride: decision.model.id,
					providerOverride: "neuralwatt",
				};
			}

			return undefined;
		});

		/**
		 * Hook: llm_output
		 *
		 * Called after each LLM response completes. Tracks energy consumption.
		 *
		 * When actual energy_joules data is available in usage (after openclaw
		 * upstream PRs), it will be used directly. Until then, energy is estimated
		 * from token counts using the ENERGY_EFFICIENCY table.
		 */
		api.on("llm_output", (event) => {
			lastModelId = event.model;

			const usage = event.usage;
			if (!usage) return;

			const totalTokens = (usage.input ?? 0) + (usage.output ?? 0);

			// Check for actual energy data first (available after upstream PRs)
			const usageAny = usage as Record<string, unknown>;
			const actualEnergyJ = typeof usageAny.energy_joules === "number" ? usageAny.energy_joules : undefined;

			const energyJ = actualEnergyJ ?? estimateEnergyJoules(event.model, totalTokens);

			const usageWithEnergy: UsageWithEnergy = {
				input: usage.input ?? 0,
				output: usage.output ?? 0,
				totalTokens,
				cost: { total: 0 },
				energy_joules: energyJ,
			};

			session.afterCall(usageWithEnergy);
		});
	},
});
