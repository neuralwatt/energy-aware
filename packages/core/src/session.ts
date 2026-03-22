import type {
	EnergyBudget,
	ModelInfo,
	PolicyContext,
	PolicyDecision,
	RuntimePolicy,
	UsageWithEnergy,
} from "./types.js";
import type { TelemetryRecord } from "./telemetry/types.js";
import { buildTelemetryRecord } from "./telemetry/serialization.js";

export interface EnergySessionConfig {
	policy: RuntimePolicy;
	budget: EnergyBudget;
	availableModels: ModelInfo[];
	taskId?: string;
}

/**
 * EnergySession: stateful convenience wrapper around RuntimePolicy.
 * Tracks budget state across calls and provides the main integration surface
 * for any tool.
 *
 * Usage:
 *   const session = new EnergySession({ policy, budget, availableModels });
 *   const decision = session.beforeCall(currentModel);
 *   // ... make LLM call, applying decision overrides ...
 *   session.afterCall(usage);
 */
export class EnergySession {
	private readonly policy: RuntimePolicy;
	private readonly budget: EnergyBudget;
	private readonly availableModels: ModelInfo[];
	private readonly taskId: string;

	private _turnNumber = 0;
	private _consumedEnergy = 0;
	private _consumedTime = 0;
	private _estimatedInputTokens = 0;
	private _messageCount = 0;
	private _startTime = Date.now();
	private readonly _telemetryLog: TelemetryRecord[] = [];

	constructor(config: EnergySessionConfig) {
		this.policy = config.policy;
		this.budget = config.budget;
		this.availableModels = config.availableModels;
		this.taskId = config.taskId ?? `session-${Date.now()}`;
	}

	/**
	 * Call before each LLM request. Returns a PolicyDecision with optional
	 * overrides for model, maxTokens, reasoning, compaction, or abort.
	 */
	beforeCall(currentModel: ModelInfo): PolicyDecision {
		this._turnNumber++;
		this._consumedTime = Date.now() - this._startTime;

		const ctx: PolicyContext = {
			taskId: this.taskId,
			turnNumber: this._turnNumber,
			model: currentModel,
			availableModels: this.availableModels,
			budget: this.budget,
			consumedEnergy: this._consumedEnergy,
			consumedTime: this._consumedTime,
			messageCount: this._messageCount,
			estimatedInputTokens: this._estimatedInputTokens,
		};

		return this.policy.beforeModelCall(ctx);
	}

	/**
	 * Call after each LLM request completes. Accumulates energy and token data.
	 */
	afterCall(usage: UsageWithEnergy): void {
		this._consumedTime = Date.now() - this._startTime;

		const ctx: PolicyContext = {
			taskId: this.taskId,
			turnNumber: this._turnNumber,
			model: this.availableModels[0] ?? { id: "unknown", reasoning: false, inputModalities: ["text"], cost: { output: 0 }, contextWindow: 0, maxTokens: 0 },
			availableModels: this.availableModels,
			budget: this.budget,
			consumedEnergy: this._consumedEnergy,
			consumedTime: this._consumedTime,
			messageCount: this._messageCount,
			estimatedInputTokens: this._estimatedInputTokens,
		};

		this.policy.afterModelCall(ctx, usage);

		if (usage.energy_joules != null) {
			this._consumedEnergy += usage.energy_joules;
		}
		this._estimatedInputTokens = usage.totalTokens;
		this._messageCount++;

		this._telemetryLog.push(
			buildTelemetryRecord({
				task_id: this.taskId,
				run_id: this.taskId,
				step_id: `turn-${this._turnNumber}`,
				model: "unknown",
				provider: "unknown",
				usage: { input: usage.input, output: usage.output, totalTokens: usage.totalTokens },
				energy: usage.energy_joules != null
					? { energy_joules: usage.energy_joules, energy_kwh: usage.energy_kwh ?? 0, duration_seconds: 0 }
					: undefined,
				latency_ms: 0,
			}),
		);
	}

	get pressure(): number {
		if (this.budget.energy_budget_joules != null && this.budget.energy_budget_joules > 0) {
			return this._consumedEnergy / this.budget.energy_budget_joules;
		}
		if (this.budget.time_budget_ms != null && this.budget.time_budget_ms > 0) {
			return this._consumedTime / this.budget.time_budget_ms;
		}
		return 0;
	}

	get consumedEnergy(): number {
		return this._consumedEnergy;
	}

	get budgetRemaining(): number {
		if (this.budget.energy_budget_joules != null) {
			return Math.max(0, this.budget.energy_budget_joules - this._consumedEnergy);
		}
		return Infinity;
	}

	get turnNumber(): number {
		return this._turnNumber;
	}

	get telemetryLog(): readonly TelemetryRecord[] {
		return this._telemetryLog;
	}
}
