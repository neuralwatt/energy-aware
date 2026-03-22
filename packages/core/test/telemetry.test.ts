import { describe, expect, it } from "vitest";
import type { TelemetryInput, TelemetryRecord } from "../src/telemetry/types.js";
import {
	appendTelemetryLine,
	buildTelemetryRecord,
	parseTelemetryLines,
	parseTelemetryRecord,
	serializeTelemetryRecord,
} from "../src/telemetry/serialization.js";
import type { EnergyUsage } from "../src/types.js";

function makeUsage() {
	return { input: 100, output: 50, totalTokens: 150 };
}

function makeEnergy(overrides?: Partial<EnergyUsage>): EnergyUsage {
	return { energy_joules: 0.42, energy_kwh: 0.000000116667, duration_seconds: 1.5, ...overrides };
}

function makeInput(overrides?: Partial<TelemetryInput>): TelemetryInput {
	return {
		task_id: "task-001",
		run_id: "run-abc",
		step_id: "step-1",
		model: "openai/gpt-oss-20b",
		provider: "neuralwatt",
		usage: makeUsage(),
		energy: makeEnergy(),
		latency_ms: 1500,
		timestamp: 1700000000000,
		...overrides,
	};
}

describe("telemetry schema", () => {
	describe("buildTelemetryRecord", () => {
		it("should build a complete record from input", () => {
			const record = buildTelemetryRecord(makeInput());
			expect(record.task_id).toBe("task-001");
			expect(record.tokens.input).toBe(100);
			expect(record.energy_joules).toBe(0.42);
			expect(record.timestamp).toBe(1700000000000);
		});

		it("should default energy to 0 when not provided", () => {
			const record = buildTelemetryRecord(makeInput({ energy: undefined }));
			expect(record.energy_joules).toBe(0);
			expect(record.energy_kwh).toBe(0);
		});

		it("should use Date.now() when timestamp not provided", () => {
			const before = Date.now();
			const record = buildTelemetryRecord(makeInput({ timestamp: undefined }));
			const after = Date.now();
			expect(record.timestamp).toBeGreaterThanOrEqual(before);
			expect(record.timestamp).toBeLessThanOrEqual(after);
		});
	});

	describe("serialization round-trip", () => {
		it("should serialize to a single JSON line", () => {
			const record = buildTelemetryRecord(makeInput());
			const line = serializeTelemetryRecord(record);
			expect(line).not.toContain("\n");
			expect(JSON.parse(line).task_id).toBe("task-001");
		});

		it("should round-trip through serialize/parse", () => {
			const original = buildTelemetryRecord(makeInput());
			const parsed = parseTelemetryRecord(serializeTelemetryRecord(original));
			expect(parsed).toEqual(original);
		});
	});

	describe("parseTelemetryRecord", () => {
		it("should throw on invalid JSON", () => {
			expect(() => parseTelemetryRecord("not-json")).toThrow();
		});

		it("should throw on missing required fields", () => {
			expect(() => parseTelemetryRecord(JSON.stringify({ task_id: "x" }))).toThrow("Invalid TelemetryRecord");
		});
	});

	describe("appendTelemetryLine", () => {
		it("should append serialized records to an array", () => {
			const lines: string[] = [];
			appendTelemetryLine(lines, buildTelemetryRecord(makeInput({ step_id: "step-1" })));
			appendTelemetryLine(lines, buildTelemetryRecord(makeInput({ step_id: "step-2" })));
			expect(lines.length).toBe(2);
			expect(JSON.parse(lines[1]).step_id).toBe("step-2");
		});
	});

	describe("parseTelemetryLines", () => {
		it("should parse JSONL content into records", () => {
			const r1 = buildTelemetryRecord(makeInput({ step_id: "step-1" }));
			const r2 = buildTelemetryRecord(makeInput({ step_id: "step-2" }));
			const content = [serializeTelemetryRecord(r1), serializeTelemetryRecord(r2)].join("\n");
			const records = parseTelemetryLines(content);
			expect(records.length).toBe(2);
		});

		it("should skip empty lines", () => {
			const r1 = buildTelemetryRecord(makeInput());
			const content = `\n${serializeTelemetryRecord(r1)}\n\n`;
			expect(parseTelemetryLines(content).length).toBe(1);
		});

		it("should handle empty string", () => {
			expect(parseTelemetryLines("").length).toBe(0);
		});
	});

	describe("schema contract", () => {
		it("should have all required fields", () => {
			const record = buildTelemetryRecord(makeInput());
			const requiredFields: (keyof TelemetryRecord)[] = [
				"task_id", "run_id", "step_id", "model", "provider",
				"tokens", "latency_ms", "energy_joules", "energy_kwh", "timestamp",
			];
			for (const field of requiredFields) {
				expect(record).toHaveProperty(field);
			}
		});
	});
});
