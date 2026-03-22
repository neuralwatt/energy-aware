import { describe, expect, it } from "vitest";
import { extractEnergyFromUsage } from "../src/energy-extraction.js";

describe("extractEnergyFromUsage", () => {
	it("should parse energy_joules and energy_kwh from usage", () => {
		const energy = extractEnergyFromUsage({
			energy_joules: 0.42,
			energy_kwh: 0.000000116667,
			duration_seconds: 1.5,
		});
		expect(energy).toBeDefined();
		expect(energy!.energy_joules).toBe(0.42);
		expect(energy!.energy_kwh).toBe(0.000000116667);
		expect(energy!.duration_seconds).toBe(1.5);
	});

	it("should compute energy_kwh from energy_joules when energy_kwh is missing", () => {
		const energy = extractEnergyFromUsage({ energy_joules: 3600 });
		expect(energy).toBeDefined();
		expect(energy!.energy_joules).toBe(3600);
		expect(energy!.energy_kwh).toBeCloseTo(0.001, 6);
		expect(energy!.duration_seconds).toBe(0);
	});

	it("should compute energy_joules from energy_kwh when energy_joules is missing", () => {
		const energy = extractEnergyFromUsage({ energy_kwh: 0.001 });
		expect(energy).toBeDefined();
		expect(energy!.energy_joules).toBe(3600);
		expect(energy!.energy_kwh).toBe(0.001);
	});

	it("should return undefined when no energy fields present", () => {
		const energy = extractEnergyFromUsage({
			prompt_tokens: 10,
			completion_tokens: 5,
		});
		expect(energy).toBeUndefined();
	});

	it("should ignore non-numeric energy fields", () => {
		const energy = extractEnergyFromUsage({
			energy_joules: "not-a-number",
			energy_kwh: null,
		});
		expect(energy).toBeUndefined();
	});

	it("should default duration_seconds to 0 when missing", () => {
		const energy = extractEnergyFromUsage({ energy_joules: 1.0 });
		expect(energy!.duration_seconds).toBe(0);
	});
});
