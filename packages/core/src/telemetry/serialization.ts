import type { TelemetryInput, TelemetryRecord } from "./types.js";

export function buildTelemetryRecord(input: TelemetryInput): TelemetryRecord {
	return {
		task_id: input.task_id,
		run_id: input.run_id,
		step_id: input.step_id,
		model: input.model,
		provider: input.provider,
		tokens: {
			input: input.usage.input,
			output: input.usage.output,
			total: input.usage.totalTokens,
		},
		latency_ms: input.latency_ms,
		energy_joules: input.energy?.energy_joules ?? 0,
		energy_kwh: input.energy?.energy_kwh ?? 0,
		timestamp: input.timestamp ?? Date.now(),
	};
}

export function serializeTelemetryRecord(record: TelemetryRecord): string {
	return JSON.stringify(record);
}

export function parseTelemetryRecord(line: string): TelemetryRecord {
	const obj = JSON.parse(line);
	if (
		typeof obj.task_id !== "string" ||
		typeof obj.run_id !== "string" ||
		typeof obj.step_id !== "string" ||
		typeof obj.model !== "string" ||
		typeof obj.provider !== "string" ||
		typeof obj.tokens?.input !== "number" ||
		typeof obj.tokens?.output !== "number" ||
		typeof obj.tokens?.total !== "number" ||
		typeof obj.latency_ms !== "number" ||
		typeof obj.energy_joules !== "number" ||
		typeof obj.energy_kwh !== "number" ||
		typeof obj.timestamp !== "number"
	) {
		throw new Error("Invalid TelemetryRecord: missing or invalid fields");
	}
	return obj as TelemetryRecord;
}

export function appendTelemetryLine(lines: string[], record: TelemetryRecord): string[] {
	lines.push(serializeTelemetryRecord(record));
	return lines;
}

export function parseTelemetryLines(content: string): TelemetryRecord[] {
	return content
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map(parseTelemetryRecord);
}
