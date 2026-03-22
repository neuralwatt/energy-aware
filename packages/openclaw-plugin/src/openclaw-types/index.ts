/**
 * Minimal type stubs for OpenClaw plugin SDK.
 *
 * These match the public API surface of openclaw/plugin-sdk/*.
 * When openclaw is available as a dependency (built or installed),
 * replace these imports with the real openclaw/plugin-sdk/* imports.
 */

export interface PluginHookBeforeModelResolveEvent {
	prompt: string;
}

export interface PluginHookBeforeModelResolveResult {
	modelOverride?: string;
	providerOverride?: string;
}

export interface PluginHookLlmOutputEvent {
	runId: string;
	sessionId: string;
	provider: string;
	model: string;
	assistantTexts: string[];
	lastAssistant?: unknown;
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		total?: number;
	};
}

export interface PluginHookAgentContext {
	agentId?: string;
	sessionKey?: string;
	sessionId?: string;
	workspaceDir?: string;
}

export type HookHandler<TEvent, TResult> = (
	event: TEvent,
	ctx: PluginHookAgentContext,
) => Promise<TResult | void> | TResult | void;

export interface OpenClawPluginApi {
	on(
		event: "before_model_resolve",
		handler: HookHandler<PluginHookBeforeModelResolveEvent, PluginHookBeforeModelResolveResult>,
	): void;
	on(
		event: "llm_output",
		handler: HookHandler<PluginHookLlmOutputEvent, void>,
	): void;
	on(event: string, handler: HookHandler<unknown, unknown>): void;
}

export interface OpenClawPluginDefinition {
	id: string;
	name: string;
	description: string;
	register(api: OpenClawPluginApi): void | Promise<void>;
}

export function definePluginEntry(def: OpenClawPluginDefinition): OpenClawPluginDefinition {
	return def;
}
