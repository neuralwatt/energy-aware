import { describe, expect, it } from "vitest";
import {
	buildTelemetryRecord,
	parseTelemetryRecord,
	parseTelemetryLines,
	serializeTelemetryRecord,
} from "../src/telemetry/serialization.js";
import type { TelemetryInput } from "../src/telemetry/types.js";

function makeInput(overrides?: Partial<TelemetryInput>): TelemetryInput {
	return {
		task_id: "t", run_id: "r", step_id: "s",
		model: "m", provider: "p",
		usage: { input: 100, output: 50, totalTokens: 150 },
		energy: { energy_joules: 0.5, energy_kwh: 0.000000139, duration_seconds: 1 },
		latency_ms: 100,
		timestamp: 1700000000000,
		...overrides,
	};
}

describe("telemetry extended edge cases", () => {
	it("should handle zero values in usage", () => {
		const record = buildTelemetryRecord(makeInput({
			usage: { input: 0, output: 0, totalTokens: 0 },
			energy: { energy_joules: 0, energy_kwh: 0, duration_seconds: 0 },
		}));
		expect(record.tokens.input).toBe(0);
		expect(record.energy_joules).toBe(0);
	});

	it("should handle very large token counts", () => {
		const record = buildTelemetryRecord(makeInput({
			usage: { input: 1_000_000, output: 500_000, totalTokens: 1_500_000 },
		}));
		expect(record.tokens.total).toBe(1_500_000);
		const rt = parseTelemetryRecord(serializeTelemetryRecord(record));
		expect(rt.tokens.total).toBe(1_500_000);
	});

	it("should handle very large timestamps", () => {
		const record = buildTelemetryRecord(makeInput({ timestamp: Number.MAX_SAFE_INTEGER }));
		const rt = parseTelemetryRecord(serializeTelemetryRecord(record));
		expect(rt.timestamp).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("should accept extra fields in JSON without error", () => {
		const json = JSON.stringify({
			task_id: "t", run_id: "r", step_id: "s",
			model: "m", provider: "p",
			tokens: { input: 10, output: 5, total: 15 },
			latency_ms: 100, energy_joules: 0, energy_kwh: 0, timestamp: 1000,
			extra_field: "should be ignored",
		});
		const record = parseTelemetryRecord(json);
		expect(record.task_id).toBe("t");
	});

	it("should throw on missing tokens object", () => {
		const json = JSON.stringify({
			task_id: "t", run_id: "r", step_id: "s",
			model: "m", provider: "p",
			latency_ms: 100, energy_joules: 0, energy_kwh: 0, timestamp: 1000,
		});
		expect(() => parseTelemetryRecord(json)).toThrow("Invalid TelemetryRecord");
	});

	it("should throw on string latency_ms", () => {
		const json = JSON.stringify({
			task_id: "t", run_id: "r", step_id: "s",
			model: "m", provider: "p",
			tokens: { input: 10, output: 5, total: 15 },
			latency_ms: "fast", energy_joules: 0, energy_kwh: 0, timestamp: 1000,
		});
		expect(() => parseTelemetryRecord(json)).toThrow("Invalid TelemetryRecord");
	});

	it("parseTelemetryLines should throw on malformed JSON in middle", () => {
		const good = serializeTelemetryRecord(buildTelemetryRecord(makeInput()));
		const content = `${good}\nNOT_JSON\n${good}`;
		expect(() => parseTelemetryLines(content)).toThrow();
	});

	it("should handle unicode in string fields", () => {
		const record = buildTelemetryRecord(makeInput({
			task_id: "task-日本語",
			model: "model-émoji-🤖",
		}));
		const rt = parseTelemetryRecord(serializeTelemetryRecord(record));
		expect(rt.task_id).toBe("task-日本語");
		expect(rt.model).toBe("model-émoji-🤖");
	});
});
