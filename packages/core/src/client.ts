/**
 * Lightweight LLM client for OpenAI-compatible APIs (including Neuralwatt).
 *
 * Uses the `openai` npm package internally. Supports:
 * - Non-streaming completion (completeSimple)
 * - Streaming completion (streamSimple)
 * - Tool calling
 * - Energy extraction from Neuralwatt's response.energy field
 */

import OpenAI from "openai";
import type {
	AssistantMessage,
	CompleteOptions,
	EnergyUsage,
	LLMContext,
	ModelInfo,
	StreamEvent,
	ToolCall,
	Usage,
} from "./types.js";
import { extractEnergyFromUsage } from "./energy-extraction.js";

const DEFAULT_BASE_URL = "https://api.neuralwatt.com/v1";

function getApiKey(_model: ModelInfo, options?: CompleteOptions): string {
	if (options?.apiKey) return options.apiKey;
	const envKey = process.env.NEURALWATT_API_KEY ?? process.env.OPENAI_API_KEY;
	if (!envKey) {
		throw new Error(
			`No API key found. Set NEURALWATT_API_KEY or pass apiKey in options.`,
		);
	}
	return envKey;
}

function getBaseUrl(model: ModelInfo, options?: CompleteOptions): string {
	return options?.baseUrl ?? model.baseUrl ?? DEFAULT_BASE_URL;
}

function buildMessages(
	context: LLMContext,
): Array<OpenAI.ChatCompletionMessageParam> {
	const msgs: OpenAI.ChatCompletionMessageParam[] = [];

	if (context.systemPrompt) {
		msgs.push({ role: "system", content: context.systemPrompt });
	}

	for (const msg of context.messages) {
		if (msg.role === "user") {
			if (msg.toolResults && msg.toolResults.length > 0) {
				// Tool results go as separate tool messages
				for (const tr of msg.toolResults) {
					msgs.push({
						role: "tool",
						tool_call_id: tr.toolCallId,
						content: tr.content,
					});
				}
			} else {
				msgs.push({ role: "user", content: msg.content });
			}
		} else if (msg.role === "assistant") {
			const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
				role: "assistant",
				content: msg.content || null,
			};
			if (msg.toolCalls && msg.toolCalls.length > 0) {
				assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
					id: tc.id,
					type: "function" as const,
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.arguments),
					},
				}));
			}
			msgs.push(assistantMsg);
		}
	}

	return msgs;
}

function buildTools(
	context: LLMContext,
): OpenAI.ChatCompletionTool[] | undefined {
	if (!context.tools || context.tools.length === 0) return undefined;
	return context.tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters as unknown as Record<string, unknown>,
		},
	}));
}

function computeCost(
	model: ModelInfo,
	inputTokens: number,
	outputTokens: number,
): { input: number; output: number; total: number } {
	const inputCostPerToken = (model.cost.input ?? 0) / 1_000_000;
	const outputCostPerToken = model.cost.output / 1_000_000;
	const inputCost = inputTokens * inputCostPerToken;
	const outputCost = outputTokens * outputCostPerToken;
	return { input: inputCost, output: outputCost, total: inputCost + outputCost };
}

function parseToolCalls(
	choices: OpenAI.ChatCompletion.Choice[],
): ToolCall[] | undefined {
	const tc = choices[0]?.message?.tool_calls;
	if (!tc || tc.length === 0) return undefined;
	return tc
		.filter((t): t is OpenAI.ChatCompletionMessageToolCall & { type: "function" } => t.type === "function")
		.map((t) => ({
			id: t.id,
			name: t.function.name,
			arguments: JSON.parse(t.function.arguments) as Record<string, unknown>,
		}));
}

function mapStopReason(
	finishReason: string | null,
	toolCalls?: ToolCall[],
): "stop" | "length" | "toolUse" | "error" {
	if (toolCalls && toolCalls.length > 0) return "toolUse";
	switch (finishReason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "tool_calls":
			return "toolUse";
		default:
			return "stop";
	}
}

/**
 * Non-streaming LLM completion.
 *
 * Calls an OpenAI-compatible API and returns a complete AssistantMessage
 * with usage stats and energy telemetry (if available from Neuralwatt).
 */
export async function completeSimple(
	model: ModelInfo,
	context: LLMContext,
	options?: CompleteOptions,
): Promise<AssistantMessage> {
	const apiKey = getApiKey(model, options);
	const baseURL = getBaseUrl(model, options);

	const client = new OpenAI({ apiKey, baseURL });

	const response = await client.chat.completions.create(
		{
			model: model.id,
			messages: buildMessages(context),
			tools: buildTools(context),
			tool_choice: context.tools && context.tools.length > 0 ? (options?.toolChoice ?? "auto") : undefined,
			max_tokens: options?.maxTokens ?? model.maxTokens,
			temperature: options?.temperature,
			stream: false,
		},
		{ signal: options?.signal },
	);

	const text = response.choices[0]?.message?.content ?? "";
	const toolCalls = parseToolCalls(response.choices);
	const rawUsage = response.usage;
	const inputTokens = rawUsage?.prompt_tokens ?? 0;
	const outputTokens = rawUsage?.completion_tokens ?? 0;

	// Extract energy from Neuralwatt's top-level response.energy field
	const responseAny = response as unknown as Record<string, unknown>;
	const energy = extractEnergyFromUsage(
		(responseAny.energy as Record<string, unknown>) ?? {},
	);

	const usage: Usage = {
		input: inputTokens,
		output: outputTokens,
		totalTokens: inputTokens + outputTokens,
		cost: computeCost(model, inputTokens, outputTokens),
	};

	return {
		role: "assistant",
		content: text,
		toolCalls,
		usage,
		energy,
		model: model.id,
		provider: model.provider,
		stopReason: mapStopReason(response.choices[0]?.finish_reason, toolCalls),
		timestamp: Date.now(),
	};
}

/**
 * Streaming LLM completion.
 *
 * Returns an async iterable of StreamEvents with a `.result()` method
 * that resolves to the final AssistantMessage when the stream completes.
 */
export function streamSimple(
	model: ModelInfo,
	context: LLMContext,
	options?: CompleteOptions,
): AsyncIterable<StreamEvent> & { result(): Promise<AssistantMessage> } {
	const apiKey = getApiKey(model, options);
	const baseURL = getBaseUrl(model, options);
	const client = new OpenAI({ apiKey, baseURL });

	let resolveResult: (msg: AssistantMessage) => void;
	let rejectResult: (err: Error) => void;
	const resultPromise = new Promise<AssistantMessage>((resolve, reject) => {
		resolveResult = resolve;
		rejectResult = reject;
	});

	async function* generate(): AsyncGenerator<StreamEvent> {
		try {
			const stream = await client.chat.completions.create(
				{
					model: model.id,
					messages: buildMessages(context),
					tools: buildTools(context),
					tool_choice: context.tools && context.tools.length > 0 ? (options?.toolChoice ?? "auto") : undefined,
					max_tokens: options?.maxTokens ?? model.maxTokens,
					temperature: options?.temperature,
					stream: true,
					stream_options: { include_usage: true },
				},
				{ signal: options?.signal },
			);

			let fullText = "";
			const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
			let finalUsage: Usage | undefined;
			let finalEnergy: EnergyUsage | undefined;

			for await (const chunk of stream) {
				// Text content
				const delta = chunk.choices?.[0]?.delta;
				if (delta?.content) {
					fullText += delta.content;
					yield { type: "text", text: delta.content };
				}

				// Tool calls
				if (delta?.tool_calls) {
					for (const tc of delta.tool_calls) {
						const existing = toolCallsMap.get(tc.index);
						if (existing) {
							existing.args += tc.function?.arguments ?? "";
						} else {
							toolCallsMap.set(tc.index, {
								id: tc.id ?? "",
								name: tc.function?.name ?? "",
								args: tc.function?.arguments ?? "",
							});
						}
					}
				}

				// Usage (final chunk)
				if (chunk.usage) {
					const inputTokens = chunk.usage.prompt_tokens ?? 0;
					const outputTokens = chunk.usage.completion_tokens ?? 0;
					finalUsage = {
						input: inputTokens,
						output: outputTokens,
						totalTokens: inputTokens + outputTokens,
						cost: computeCost(model, inputTokens, outputTokens),
					};
					yield { type: "usage", usage: finalUsage };
				}
			}

			// Build tool calls
			const toolCalls: ToolCall[] | undefined =
				toolCallsMap.size > 0
					? Array.from(toolCallsMap.values()).map((tc) => ({
							id: tc.id,
							name: tc.name,
							arguments: JSON.parse(tc.args || "{}") as Record<string, unknown>,
						}))
					: undefined;

			const stopReason = mapStopReason(null, toolCalls);

			const result: AssistantMessage = {
				role: "assistant",
				content: fullText,
				toolCalls,
				usage: finalUsage ?? {
					input: 0,
					output: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, total: 0 },
				},
				energy: finalEnergy,
				model: model.id,
				provider: model.provider,
				stopReason,
				timestamp: Date.now(),
			};

			yield { type: "done" };
			resolveResult!(result);
		} catch (err) {
			rejectResult!(err instanceof Error ? err : new Error(String(err)));
		}
	}

	const iterable = generate();

	return Object.assign(iterable, {
		result: () => resultPromise,
	});
}
