import type { EnergyUsage } from "./types.js";

/**
 * Extract energy telemetry from an object containing energy fields.
 *
 * Neuralwatt returns energy as a top-level `energy` object on the response:
 *   response.energy = { energy_joules, energy_kwh, duration_seconds, ... }
 *
 * Pass `response.energy` (or any object with energy_joules/energy_kwh fields)
 * to this function. Returns undefined when no energy data is present.
 */
export function extractEnergyFromUsage(usageObj: Record<string, unknown>): EnergyUsage | undefined {
	const energyJoules = typeof usageObj.energy_joules === "number" ? usageObj.energy_joules : undefined;
	const energyKwh = typeof usageObj.energy_kwh === "number" ? usageObj.energy_kwh : undefined;
	const durationSeconds = typeof usageObj.duration_seconds === "number" ? usageObj.duration_seconds : undefined;

	if (energyJoules !== undefined || energyKwh !== undefined) {
		return {
			energy_joules: energyJoules ?? (energyKwh !== undefined ? energyKwh * 3_600_000 : 0),
			energy_kwh: energyKwh ?? (energyJoules !== undefined ? energyJoules / 3_600_000 : 0),
			duration_seconds: durationSeconds ?? 0,
		};
	}

	return undefined;
}
