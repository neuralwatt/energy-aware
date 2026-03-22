# energy-aware

Tool-agnostic energy-aware model routing for AI coding tools. Extracted from
[energy-aware-pi-mono](https://github.com/neuralwatt/energy-aware-pi-mono) as
a standalone package that any tool can adopt without installing a custom fork.

## What it does

Gives AI agents an **energy budget** and a policy that automatically adapts
behavior to stay within it. Instead of every model call using the most expensive
model at maximum parameters, the agent spends energy where it matters and
conserves where it doesn't.

The 5-strategy policy chain activates progressively as budget pressure rises:

| Pressure | Strategy | What happens |
|----------|----------|-------------|
| >30% | Reasoning reduction | Steps down: high -> medium -> low -> minimal |
| >50% | Token limit reduction | Caps output tokens by up to 40% |
| >70% | Model routing | Switches to cheapest model that meets capability requirements |
| >50% + context bloat | Context compaction | Signals the host to compact context |
| >=100% | Abort | Stops the agent with a clear reason |

Typical result: **50-80% energy savings** with less than 5% degradation in task
success rate.

## Packages

```
energy-aware/
  packages/
    core/              @neuralwatt/energy-aware-core     Zero-dependency core
    openclaw-plugin/   @neuralwatt/energy-aware-openclaw OpenClaw plugin
    benchmarks/        @neuralwatt/energy-aware-benchmarks  Demos + harness
```

### @neuralwatt/energy-aware-core

The foundation. Zero external dependencies. Pure TypeScript.

**Key concepts:**

- **`ModelInfo`** — 6-field interface that decouples from any tool's native model type.
  Any tool maps its models to `{ id, reasoning, inputModalities, cost, contextWindow, maxTokens }`.
- **`EnergyAwarePolicy`** — the 5-strategy chain above
- **`EnergySession`** — stateful wrapper that tracks budget across turns (main integration surface)
- **`extractEnergyFromUsage()`** — parses energy telemetry from Neuralwatt API responses
- **`discriminate()`** — 4-tier prompt classifier that routes to the cheapest adequate model
- **`NEURALWATT_MODELS`** — model catalog with cost and energy efficiency data

**Quick start (any tool):**

```typescript
import { EnergyAwarePolicy, EnergySession, NEURALWATT_MODELS } from "@neuralwatt/energy-aware-core";

const session = new EnergySession({
  policy: new EnergyAwarePolicy(),
  budget: { energy_budget_joules: 50 },
  availableModels: [...NEURALWATT_MODELS],
});

// Before each LLM call
const decision = session.beforeCall(currentModel);
// decision.model    — use this model instead (if set)
// decision.maxTokens — cap output tokens (if set)
// decision.abort    — stop the agent (if true)

// After each LLM call
session.afterCall({
  input: usage.prompt_tokens,
  output: usage.completion_tokens,
  totalTokens: usage.total_tokens,
  cost: { total: 0 },
  energy_joules: response.energy?.energy_joules ?? 0,
});

// Query state
session.pressure;        // 0.0 - 1.0+
session.consumedEnergy;  // cumulative joules
session.budgetRemaining; // joules left
```

### @neuralwatt/energy-aware-openclaw

OpenClaw plugin for energy-aware model routing. See [OpenClaw Integration](#openclaw-integration) below.

### @neuralwatt/energy-aware-benchmarks

Mock-based benchmark runner and live demos. No API keys needed for the mock runner.

## Neuralwatt API

All energy data comes from [Neuralwatt](https://api.neuralwatt.com). The API is
OpenAI-compatible with energy telemetry:

```
POST https://api.neuralwatt.com/v1/chat/completions
Authorization: Bearer $NEURALWATT_API_KEY
```

Energy telemetry is returned as a **top-level `energy` object** on the response
(not inside `usage`):

```json
{
  "choices": [...],
  "usage": { "prompt_tokens": 73, "completion_tokens": 23, "total_tokens": 96 },
  "energy": {
    "energy_joules": 37.11,
    "energy_kwh": 0.000010308,
    "duration_seconds": 0.398,
    "avg_power_watts": 372.7,
    "attribution_method": "prorated",
    "attribution_ratio": 0.25
  }
}
```

Get a key at [portal.neuralwatt.com](https://portal.neuralwatt.com).

## Running the demos

### Mock comparison (no API key needed)

```bash
npx tsx packages/benchmarks/src/demo-compare.ts
```

Shows baseline vs energy-aware using mocked turn data. Output:
```
Task: Coding Task (10 turns)
  Baseline:     9.50J, 10 turns
  Energy-aware: 4.69J, 10 turns
  Energy saved: 50.6%
```

### Live coding agent

```bash
NEURALWATT_API_KEY=... npx tsx packages/benchmarks/src/demo-coding-agent.ts
```

Real multi-turn coding task against Neuralwatt API. Compares baseline (always
uses expensive model) vs energy-aware (discriminator routes each turn).

Options: `--budget 50000`, `--turns 3`, `--baseline`

## OpenClaw Integration

### Architecture

The plugin hooks into OpenClaw's lifecycle without any upstream code changes:

```
                    OpenClaw Agent Loop
                          |
    before_model_resolve  |  llm_output
    (classify + route)    |  (track energy)
              \           |           /
               \          |          /
            +---------------------------+
            |   Energy-Aware Plugin     |
            |                           |
            |  Discriminator (GPT-OSS)  |
            |  classifies prompt ->     |
            |  simple/medium/complex/   |
            |  thinking -> routes to    |
            |  cheapest adequate model  |
            +---------------------------+
```

**Hooks used:**
- `before_model_resolve` — runs the 4-tier discriminator (GPT-OSS 20B) to
  classify the user's prompt, then returns `modelOverride` to route to the
  cheapest model that can handle that tier
- `llm_output` — receives token usage after each LLM call, estimates energy
  consumption using the `ENERGY_EFFICIENCY` table (tokens per joule), accumulates
  to `consumedEnergy`

**Discriminator tiers:**

| Tier | Model | Cost | When |
|------|-------|------|------|
| simple | GPT-OSS 20B | $0.03/$0.16/M | Type definitions, boilerplate, trivial answers |
| medium | Devstral 24B | $0.12/$0.35/M | Standard implementation, clear spec |
| complex | Qwen3.5 397B | $0.69/$4.14/M | Novel architecture, design decisions |
| thinking | Kimi K2.5 | $0.52/$2.59/M | Step-by-step reasoning, debugging, CoT |

**Verified routing examples:**

```
"Define a TypeScript interface"           -> simple  -> GPT-OSS 20B
"Add input validation"                    -> medium  -> Devstral 24B
"Implement a skip list with balancing"    -> complex -> Qwen3.5 397B
"Debug this topological sort step by step"-> complex -> Qwen3.5 397B
```

### State persistence

The plugin tracks energy state in JavaScript variables inside the plugin closure.
This has implications for how state persists:

| Mode | State behavior | Routing works? |
|------|---------------|----------------|
| **Gateway** (long-running daemon) | State persists across all turns in the process lifetime | Yes |
| **CLI one-shot** (`openclaw agent --local`) | State resets each invocation (new process) | No — each call starts at 0J |

**Why CLI one-shot doesn't show routing:**

Each `openclaw agent --local --message "..."` invocation:
1. Starts a new Node.js process
2. Plugin initializes with `consumedEnergy = 0`
3. Makes one LLM call (typically 2-4J)
4. Plugin logs `pressure: 0%` (4J / 25,000J budget = 0.02%)
5. Process exits — state is gone

The `before_model_resolve` hook only routes when pressure > 70%. A single turn
can never reach that threshold with a 25,000J budget.

**Solutions:**

1. **Use gateway mode** (recommended for production):
   ```bash
   openclaw gateway --port 18789
   # Send multiple messages — state accumulates in the long-running process
   ```

2. **Persist state to disk** — the plugin can write `consumedEnergy` to a file
   and reload it on startup (planned feature)

3. **Use a tiny budget for demo** — set budget to 5J so a single ~3J turn hits
   60% pressure immediately

### Energy estimation vs actual telemetry

The plugin estimates energy from token counts when actual telemetry isn't
available:

```
estimatedEnergy = totalTokens / tokensPerJoule
```

Where `tokensPerJoule` comes from the `ENERGY_EFFICIENCY` table:

| Model | Tokens/Joule |
|-------|-------------|
| Qwen3.5-35B | 27.51 |
| Devstral 24B | 22.35 |
| Qwen3.5-397B | 1.03 |
| GPT-OSS 20B | 0.50 |
| Kimi K2.5 | 0.21 |

This is approximate. When OpenClaw propagates actual `energy_joules` from the
API response (requires upstream PRs to pass the `response.energy` object through
to hooks), the plugin will use real telemetry automatically — the code already
checks for it:

```typescript
const actualEnergyJ = typeof usageAny.energy_joules === "number"
  ? usageAny.energy_joules : undefined;
const energyJ = actualEnergyJ ?? estimateEnergyJ(model, totalTokens);
```

### Setup

**Prerequisites:** Node 22+, pnpm, OpenClaw built from source.

**1. Configure Neuralwatt provider** in `~/.openclaw/openclaw.json`:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "neuralwatt": {
        "baseUrl": "https://api.neuralwatt.com/v1",
        "apiKey": "${NEURALWATT_API_KEY}",
        "api": "openai-completions",
        "models": [
          {
            "id": "mistralai/Devstral-Small-2-24B-Instruct-2512",
            "name": "Devstral 24B",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0.12, "output": 0.35, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 262144,
            "maxTokens": 16384
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "neuralwatt/mistralai/Devstral-Small-2-24B-Instruct-2512"
      }
    }
  }
}
```

**2. Add the plugin** to OpenClaw's extensions:

Copy `extensions/energy-aware/` into `~/dev/openclaw/extensions/energy-aware/`
and register it in `src/plugins/contracts/registry.ts`.

**3. Enable the plugin:**

```bash
openclaw plugins enable energy-aware
```

**4. Run the demo:**

```bash
export NEURALWATT_API_KEY=...
cd ~/dev/openclaw

# Simple prompt -> routes to GPT-OSS 20B ($0.03/$0.16/M)
pnpm openclaw agent --local --session-id demo-1 \
  --message "Define a TypeScript interface for a cache with get, set, and delete methods"

# Medium prompt -> routes to Devstral 24B ($0.12/$0.35/M)
pnpm openclaw agent --local --session-id demo-2 \
  --message "Implement an LRU cache class in TypeScript with O(1) get and set using a Map"

# Complex prompt -> routes to Qwen3.5 397B ($0.69/$4.14/M)
pnpm openclaw agent --local --session-id demo-3 \
  --message "Implement a skip list data structure with probabilistic balancing, search, insert, and delete operations with proper TypeScript generics"

# Thinking/debug prompt -> routes to Kimi K2.5 ($0.52/$2.59/M)
pnpm openclaw agent --local --session-id demo-4 \
  --message "Debug this: my topological sort returns wrong results when the graph has multiple disconnected components. Walk through the algorithm step by step and identify the bug"
```

Each command shows the discriminator's routing decision:
```
[energy-aware] Turn 1: simple -> GPT-OSS 20B (type definition) [░░░░░░░░░░░░░░░] 47J/25000J
[hooks] model overridden to openai/gpt-oss-20b
```

## Integration with other tools

### Any tool (direct npm)

```bash
npm install @neuralwatt/energy-aware-core
```

Use `EnergySession` — 3 calls: constructor, `beforeCall`, `afterCall`. Map your
models to `ModelInfo` (6 fields). See the [quick start](#neuralwatt-energy-aware-core) above.

### Kilocode

Direct npm integration. Same `EnergySession` pattern — wrap the agent loop with
`beforeCall`/`afterCall`.

### NanoClaw

Container skill that wraps `container-runner.ts` with `EnergySession`. Configure
`ANTHROPIC_BASE_URL` to point at Neuralwatt API.

### Pi-mono (backward compat)

Replace inline policy code with `@neuralwatt/energy-aware-core` imports. Adapter
maps `Model<Api>` -> `ModelInfo` (trivial 6-field mapping).

## Development

```bash
# Install
npm install

# Type check
npm run check

# Run tests (153 tests across 14 files)
npx vitest run --workspace vitest.workspace.ts

# Build core
npx tsc -p packages/core/tsconfig.json

# Run mock demo
npx tsx packages/benchmarks/src/demo-compare.ts

# Run live demo
NEURALWATT_API_KEY=... npx tsx packages/benchmarks/src/demo-coding-agent.ts
```

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Any AI Tool (openclaw, kilocode, opencode, etc.)    │
│  Maps its models to ModelInfo, calls EnergySession   │
├──────────────────────────────────────────────────────┤
│  @neuralwatt/energy-aware-core                       │
│                                                      │
│  EnergySession ──► EnergyAwarePolicy                 │
│    beforeCall()     5-strategy chain                  │
│    afterCall()      (reasoning, tokens, routing,      │
│    pressure         compaction, abort)                │
│    telemetryLog                                      │
│                                                      │
│  ModelInfo          extractEnergyFromUsage()          │
│  { id, reasoning,   discriminate()                   │
│    cost, ... }      NEURALWATT_MODELS                │
├──────────────────────────────────────────────────────┤
│  Neuralwatt API (https://api.neuralwatt.com/v1)      │
│  OpenAI-compatible + energy telemetry                │
│  response.energy = { energy_joules, energy_kwh, ... }│
└──────────────────────────────────────────────────────┘
```

The key architectural decision is the **`ModelInfo` interface** — a 6-field seam
that decouples the energy-aware logic from any tool's native model type. Pi-mono
uses `Model<Api>` (12+ fields), OpenClaw uses `ModelDefinitionConfig`, other tools
have their own types. Each tool maps to `ModelInfo`; the policy engine never
knows about tool-specific types.
