export type { TelemetryRecord, TelemetryInput } from "./types.js";
export {
	buildTelemetryRecord,
	serializeTelemetryRecord,
	parseTelemetryRecord,
	appendTelemetryLine,
	parseTelemetryLines,
} from "./serialization.js";
