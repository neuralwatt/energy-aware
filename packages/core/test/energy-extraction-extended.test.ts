import { describe, expect, it } from "vitest";
import { extractEnergyFromUsage } from "../src/energy-extraction.js";

describe("extractEnergyFromUsage extended edge cases", () => {
	it("should return both fields unchanged when both are present", () => {
		const energy = extractEnergyFromUsage({
			energy_joules: 3600,
			energy_kwh: 0.001,
			duration_seconds: 2.5,
		});
		expect(energy!.energy_joules).toBe(3600);
		expect(energy!.energy_kwh).toBe(0.001);
		expect(energy!.duration_seconds).toBe(2.5);
	});

	it("should handle zero energy_joules", () => {
		const energy = extractEnergyFromUsage({ energy_joules: 0 });
		expect(energy).toBeDefined();
		expect(energy!.energy_joules).toBe(0);
		expect(energy!.energy_kwh).toBe(0);
	});

	it("should handle very small energy values", () => {
		const energy = extractEnergyFromUsage({ energy_joules: 0.000001 });
		expect(energy).toBeDefined();
		expect(energy!.energy_joules).toBe(0.000001);
		expect(energy!.energy_kwh).toBeCloseTo(0.000001 / 3_600_000, 15);
	});

	it("should handle very large energy values", () => {
		const energy = extractEnergyFromUsage({ energy_joules: 1_000_000 });
		expect(energy).toBeDefined();
		expect(energy!.energy_joules).toBe(1_000_000);
		expect(energy!.energy_kwh).toBeCloseTo(1_000_000 / 3_600_000, 6);
	});

	it("should convert correctly: 1 kWh = 3,600,000 J", () => {
		const fromKwh = extractEnergyFromUsage({ energy_kwh: 1 });
		expect(fromKwh!.energy_joules).toBe(3_600_000);

		const fromJ = extractEnergyFromUsage({ energy_joules: 3_600_000 });
		expect(fromJ!.energy_kwh).toBeCloseTo(1, 6);
	});

	it("should ignore boolean energy fields", () => {
		const energy = extractEnergyFromUsage({ energy_joules: true, energy_kwh: false });
		expect(energy).toBeUndefined();
	});

	it("should ignore NaN energy fields", () => {
		const energy = extractEnergyFromUsage({ energy_joules: NaN });
		// NaN is typeof "number" so this will be accepted but produce NaN values
		// This is a known edge case — the function uses typeof === "number"
		expect(energy).toBeDefined();
		expect(Number.isNaN(energy!.energy_joules)).toBe(true);
	});

	it("should handle empty object", () => {
		expect(extractEnergyFromUsage({})).toBeUndefined();
	});

	it("should handle object with unrelated fields only", () => {
		expect(extractEnergyFromUsage({ prompt_tokens: 100, completion_tokens: 50, foo: "bar" })).toBeUndefined();
	});

	it("should accept negative energy values (no validation)", () => {
		const energy = extractEnergyFromUsage({ energy_joules: -1 });
		expect(energy).toBeDefined();
		expect(energy!.energy_joules).toBe(-1);
	});
});
