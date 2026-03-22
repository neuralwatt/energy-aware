#!/usr/bin/env bash
#
# Energy-Aware OpenClaw Demo: Baseline vs Energy-Aware Comparison
#
# Runs the same 4-step coding task twice through OpenClaw:
#   1. BASELINE: plugin disabled, all steps use Qwen 397B ($4.14/M)
#   2. ENERGY-AWARE: plugin enabled, discriminator routes each step
#
# Usage:
#   export NEURALWATT_API_KEY=...
#   bash ~/dev/energy-aware/packages/benchmarks/src/demo-openclaw-multistep.sh
#

set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22 > /dev/null 2>&1

cd ~/dev/openclaw

CONFIG="$HOME/.openclaw/openclaw.json"
TS=$(date +%s)

PROMPTS=(
  "Define TypeScript interfaces for an LRU cache: LRUCacheOptions with a capacity field, and a generic LRUCache<K,V> class signature with get(key), set(key, value), has(key), delete(key), clear(), and a size property. Just the type definitions, no implementation."
  "Implement the LRUCache<K,V> class using a Map for O(1) get and set. On get/set, delete and re-insert the key to maintain recency order. Evict the least recently used entry when capacity is exceeded. Include JSDoc comments."
  "Add input validation to the LRUCache constructor: throw descriptive errors for invalid capacity (must be positive integer). Add a peek(key) method that reads without updating recency, and a forEach callback method."
  "Write the final complete TypeScript implementation combining everything from the previous steps into a single file. Export the LRUCacheOptions interface and LRUCache class. No imports except node standard lib. Output raw TypeScript only, no markdown."
)
PHASES=("interfaces" "core impl" "validation" "consolidate")

# Cost per output token ($/token) for each model tier
# Used to compute comparable cost, not energy estimation
COST_397B="0.00000414"    # Qwen 397B: $4.14/M output
COST_DEVSTRAL="0.00000035"  # Devstral 24B: $0.35/M output
COST_GPTOSS="0.00000016"   # GPT-OSS 20B: $0.16/M output

model_cost() {
  local model="$1"
  case "$model" in
    *gpt-oss*) echo "$COST_GPTOSS" ;;
    *Devstral*) echo "$COST_DEVSTRAL" ;;
    *Kimi*) echo "0.00000259" ;;
    *) echo "$COST_397B" ;;
  esac
}

# --- Header ---
echo ""
echo -e "\033[1m╔══════════════════════════════════════════════════════════════╗\033[0m"
echo -e "\033[1m║     Energy-Aware OpenClaw Demo: LRU Cache (4 steps)        ║\033[0m"
echo -e "\033[1m╚══════════════════════════════════════════════════════════════╝\033[0m"
echo ""
echo -e "  \033[2mDefault model: Qwen/Qwen3.5-397B-A17B-FP8 (\$4.14/M output)\033[0m"
echo -e "  \033[2mTask: Define interfaces → Implement → Validate → Consolidate\033[0m"
echo ""

# ═══ BASELINE ═══
echo -e "\033[1m━━━ BASELINE (no energy-aware routing) ━━━━━━━━━━━━━━━━━━━━━━\033[0m"
echo -e "  \033[2mAll steps use Qwen 397B (\$4.14/M output)\033[0m"
echo ""

# Disable plugin
cp "$CONFIG" "${CONFIG}.bak"
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$CONFIG','utf8'));if(c.plugins?.entries?.['energy-aware'])c.plugins.entries['energy-aware'].enabled=false;fs.writeFileSync('$CONFIG',JSON.stringify(c,null,2));"

declare -a B_OUT_TOKENS B_COST B_MODELS
B_TOTAL_COST=0

for i in 0 1 2 3; do
  OUT=$(pnpm openclaw agent --local --session-id "bl-${TS}-${i}" --json --message "${PROMPTS[$i]}" 2>/dev/null)
  MODEL=$(echo "$OUT" | grep -oP '"model":\s*"\K[^"]+' | tail -1)
  OTOK=$(echo "$OUT" | grep -oP '"output":\s*\K[0-9]+' | head -1 || echo "0")
  CPER=$(model_cost "$MODEL")
  STEP_COST=$(echo "scale=6; $OTOK * $CPER" | bc 2>/dev/null || echo "0")

  B_OUT_TOKENS[$i]="$OTOK"
  B_COST[$i]="$STEP_COST"
  B_MODELS[$i]="$MODEL"
  B_TOTAL_COST=$(echo "$B_TOTAL_COST + $STEP_COST" | bc 2>/dev/null)

  SHORT=$(echo "$MODEL" | sed 's|.*/||')
  printf "  \033[36m[baseline]\033[0m Step %d \033[2m(%-12s)\033[0m  \033[1m%-18s\033[0m  %4s out tokens  \033[2m\$%s\033[0m\n" \
    "$((i+1))" "${PHASES[$i]}" "$SHORT" "$OTOK" "$STEP_COST"
done

echo ""
printf "  \033[36mBaseline total cost: \$%s\033[0m\n" "$B_TOTAL_COST"
echo ""

# ═══ ENERGY-AWARE ═══
echo -e "\033[1m━━━ ENERGY-AWARE (discriminator routing) ━━━━━━━━━━━━━━━━━━━━\033[0m"
echo -e "  \033[2mEach step classified and routed to cheapest adequate model\033[0m"
echo ""

# Re-enable plugin
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$CONFIG','utf8'));if(c.plugins?.entries?.['energy-aware'])c.plugins.entries['energy-aware'].enabled=true;fs.writeFileSync('$CONFIG',JSON.stringify(c,null,2));"

declare -a E_OUT_TOKENS E_COST E_MODELS E_TIERS
E_TOTAL_COST=0

for i in 0 1 2 3; do
  # Capture both stderr (plugin output) and stdout (json)
  FULL_OUT=$(pnpm openclaw agent --local --session-id "ea-${TS}-${i}" --json --message "${PROMPTS[$i]}" 2>&1)

  TIER=$(echo "$FULL_OUT" | grep -oP '\[energy-aware\] \K\S+(?= ->)' | head -1 || echo "?")
  REASON=$(echo "$FULL_OUT" | grep -oP 'Reason: \K[^|]+' | head -1 | sed 's/ *$//' || echo "")
  MODEL=$(echo "$FULL_OUT" | grep -oP 'model overridden to \K\S+' | tail -1)
  [ -z "$MODEL" ] && MODEL=$(echo "$FULL_OUT" | grep -oP '"model":\s*"\K[^"]+' | tail -1)
  OTOK=$(echo "$FULL_OUT" | grep -oP '"output":\s*\K[0-9]+' | head -1 || echo "0")
  CPER=$(model_cost "$MODEL")
  STEP_COST=$(echo "scale=6; $OTOK * $CPER" | bc 2>/dev/null || echo "0")

  E_OUT_TOKENS[$i]="$OTOK"
  E_COST[$i]="$STEP_COST"
  E_MODELS[$i]="$MODEL"
  E_TIERS[$i]="$TIER"
  E_TOTAL_COST=$(echo "$E_TOTAL_COST + $STEP_COST" | bc 2>/dev/null)

  SHORT=$(echo "$MODEL" | sed 's|.*/||')

  case "$TIER" in
    SIMPLE)  TC="\033[32m" ;;
    MEDIUM)  TC="\033[36m" ;;
    COMPLEX) TC="\033[35m" ;;
    THINKING) TC="\033[33m" ;;
    *)       TC="\033[2m" ;;
  esac

  printf "  ${TC}[energy-▼]\033[0m Step %d \033[2m(%-12s)\033[0m  ${TC}%-8s\033[0m -> \033[1m%-18s\033[0m  %4s out  \033[2m\$%s\033[0m\n" \
    "$((i+1))" "${PHASES[$i]}" "$TIER" "$SHORT" "$OTOK" "$STEP_COST"
  [ -n "$REASON" ] && echo -e "                                   \033[2m${REASON}\033[0m"
done

echo ""
printf "  \033[35mEnergy-aware total cost: \$%s\033[0m\n" "$E_TOTAL_COST"
echo ""

# ═══ COMPARISON ═══
echo -e "\033[1m━━━ COMPARISON ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
echo ""

printf "  \033[1m%-14s  %-22s  %-8s  %-22s  %-8s\033[0m\n" "Step" "Baseline Model" "Cost" "Energy-Aware Model" "Cost"
for i in 0 1 2 3; do
  B_SHORT=$(echo "${B_MODELS[$i]}" | sed 's|.*/||')
  E_SHORT=$(echo "${E_MODELS[$i]}" | sed 's|.*/||')
  printf "  %-14s  %-22s  \$%-7s  %-22s  \$%-7s  %s\n" \
    "${PHASES[$i]}" "$B_SHORT" "${B_COST[$i]}" "$E_SHORT" "${E_COST[$i]}" "${E_TIERS[$i]}"
done

echo ""
printf "  Baseline total:     \033[36m\$%s\033[0m\n" "$B_TOTAL_COST"
printf "  Energy-aware total: \033[35m\$%s\033[0m\n" "$E_TOTAL_COST"

if [ "$(echo "$B_TOTAL_COST > 0" | bc 2>/dev/null)" = "1" ] && [ "$(echo "$E_TOTAL_COST > 0" | bc 2>/dev/null)" = "1" ]; then
  SAVINGS=$(echo "scale=1; ($B_TOTAL_COST - $E_TOTAL_COST) / $B_TOTAL_COST * 100" | bc 2>/dev/null || echo "?")
  echo ""
  echo -e "  \033[1m\033[32m▼ Cost saved: ${SAVINGS}%\033[0m"
fi
echo ""

# Restore config
cp "${CONFIG}.bak" "$CONFIG"
rm -f "${CONFIG}.bak"
