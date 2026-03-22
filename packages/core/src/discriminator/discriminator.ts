import type {
	ClassifyFn,
	DiscriminateOptions,
	DiscriminatorConfig,
	DiscriminatorTier,
	DiscriminatorTierConfig,
	RoutingDecision,
} from "./types.js";

export const DEFAULT_DISCRIMINATOR_SYSTEM_PROMPT =
	"You are a prompt routing classifier for a four-tier AI system.\n" +
	"Choose the tier that best matches the task:\n" +
	'  "thinking" — needs step-by-step reasoning, debugging, or chain-of-thought\n' +
	'  "complex"  — needs high quality but reasoning is not required; direct answer ok\n' +
	'  "medium"   — moderately complex but clear spec; no deep reasoning needed\n' +
	'  "simple"   — boilerplate, obvious implementation, or trivial answer\n' +
	'Also classify response length: "full" if a detailed response is needed, "brief" if a short concise answer suffices.\n' +
	'Reply with ONLY valid JSON: {"tier":"medium","length":"full","reason":"<=10 words"}';

const TIER_ORDER: DiscriminatorTier[] = ["simple", "medium", "complex", "thinking"];

function clampTier(tier: DiscriminatorTier, maxTier: DiscriminatorTier): DiscriminatorTier {
	const tierIdx = TIER_ORDER.indexOf(tier);
	const maxIdx = TIER_ORDER.indexOf(maxTier);
	return tierIdx > maxIdx ? maxTier : tier;
}

function clampTierUp(tier: DiscriminatorTier, minTier: DiscriminatorTier): DiscriminatorTier {
	const tierIdx = TIER_ORDER.indexOf(tier);
	const minIdx = TIER_ORDER.indexOf(minTier);
	return tierIdx < minIdx ? minTier : tier;
}

function resolveTier(
	tier: DiscriminatorTier,
	config: DiscriminatorConfig,
): { resolvedTier: DiscriminatorTier; tierConfig: DiscriminatorTierConfig } {
	if (tier === "thinking") {
		return config.thinking
			? { resolvedTier: "thinking", tierConfig: config.thinking }
			: { resolvedTier: "complex", tierConfig: config.complex };
	}
	if (tier === "medium") {
		return config.medium
			? { resolvedTier: "medium", tierConfig: config.medium }
			: { resolvedTier: "simple", tierConfig: config.simple };
	}
	if (tier === "simple") return { resolvedTier: "simple", tierConfig: config.simple };
	return { resolvedTier: "complex", tierConfig: config.complex };
}

/**
 * Classifies a prompt and returns a full RoutingDecision.
 *
 * Uses a generic classifyFn callback — any LLM client can provide this.
 * Falls back to complex+full (safe default) on any error.
 */
export async function discriminate(
	phase: string,
	prompt: string,
	config: DiscriminatorConfig,
	classifyFn: ClassifyFn,
	memContext?: string,
	options?: DiscriminateOptions,
): Promise<RoutingDecision> {
	const systemPrompt = config.systemPrompt ?? DEFAULT_DISCRIMINATOR_SYSTEM_PROMPT;
	const contextPrefix = memContext ? `${memContext}\n\n` : "";
	const input = `${contextPrefix}Classify (phase: ${phase}):\n${prompt.slice(0, 500)}`;

	try {
		const { text: raw, energyJ } = await classifyFn(systemPrompt, input, 60);

		let parsed: { tier?: string; length?: string; reason?: string } = {};
		try {
			parsed = JSON.parse(raw) as typeof parsed;
		} catch {
			const m = raw.match(/\{[^{}]+\}/);
			if (m) {
				try {
					parsed = JSON.parse(m[0]) as typeof parsed;
				} catch {
					// Fall through to defaults
				}
			}
		}

		const VALID_TIERS: DiscriminatorTier[] = ["thinking", "complex", "medium", "simple"];
		const rawTier = typeof parsed.tier === "string" ? parsed.tier : "complex";
		const tier: DiscriminatorTier = (VALID_TIERS as string[]).includes(rawTier)
			? (rawTier as DiscriminatorTier)
			: "complex";

		let clampedTier = options?.maxTier ? clampTier(tier, options.maxTier) : tier;
		if (options?.minTier) {
			clampedTier = clampTierUp(clampedTier, options.minTier);
			if (options.maxTier) clampedTier = clampTier(clampedTier, options.maxTier);
		}

		const { resolvedTier, tierConfig } = resolveTier(clampedTier, config);
		const isBrief = parsed.length === "brief";
		const maxTokens = isBrief ? tierConfig.briefMaxTokens : undefined;
		const reason =
			typeof parsed.reason === "string" && parsed.reason.length > 0 ? parsed.reason.slice(0, 80) : resolvedTier;

		return { tier: resolvedTier, model: tierConfig.model, maxTokens, reason, energyJ };
	} catch {
		return {
			tier: "complex",
			model: config.complex.model,
			maxTokens: undefined,
			reason: "fallback (classifier error)",
			energyJ: 0,
		};
	}
}
