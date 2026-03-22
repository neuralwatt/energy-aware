#!/usr/bin/env bash
#
# Energy-Aware OpenClaw Demo: Developer Workday
#
# Simulates a realistic mix of tasks with side-by-side comparison:
#   BASELINE: all tasks use Qwen 397B ($4.14/M)
#   ENERGY-AWARE: discriminator routes each task to cheapest adequate model
#
# Shows cost savings, energy savings, and time delta.
#
# Usage:
#   export NEURALWATT_API_KEY=...
#   bash ~/dev/energy-aware/packages/benchmarks/src/demo-openclaw-workday.sh
#

set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22 > /dev/null 2>&1

cd ~/dev/openclaw

CONFIG="$HOME/.openclaw/openclaw.json"
TS=$(date +%s)

TASKS=(
  "What is the difference between interface and type in TypeScript?"
  "Write a debounce function in TypeScript with proper generics"
  "Implement a binary search tree with insert, search, delete, and in-order traversal. Include TypeScript generics and handle all edge cases."
  "Add JSDoc comments to this function: function merge(a: Record<string, unknown>, b: Record<string, unknown>) { return {...a, ...b}; }"
  "Implement a promise-based retry function with exponential backoff, jitter, max retries, and abort signal support"
  "What does the error 'Type X is not assignable to type Y' usually mean?"
)

LABELS=(
  "Quick question"
  "Utility function"
  "Data structure"
  "Add documentation"
  "Async pattern"
  "Error explanation"
)

cost_per_tok() {
  case "$1" in
    *gpt-oss*) echo "0.00000016" ;;
    *Devstral*) echo "0.00000035" ;;
    *Kimi*) echo "0.00000259" ;;
    *) echo "0.00000414" ;;
  esac
}

short_model() {
  local m="$1"
  m="${m//[^[:print:]]/}"  # strip control chars
  echo "$m" | sed 's|.*/||'
}

# --- Header ---
echo ""
echo -e "\033[1m╔══════════════════════════════════════════════════════════════╗\033[0m"
echo -e "\033[1m║       Energy-Aware OpenClaw Demo: Developer Workday        ║\033[0m"
echo -e "\033[1m╚══════════════════════════════════════════════════════════════╝\033[0m"
echo ""
echo -e "  \033[2m6 tasks of varying complexity, typical of a developer's day.\033[0m"
echo -e "  \033[2mDefault model: Qwen 397B (\$4.14/M output)\033[0m"
echo ""

# ═══ BASELINE ═══
echo -e "\033[1m━━━ BASELINE (plugin disabled) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
echo ""

cp "$CONFIG" "${CONFIG}.bak"
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$CONFIG','utf8'));if(c.plugins?.entries?.['energy-aware'])c.plugins.entries['energy-aware'].enabled=false;fs.writeFileSync('$CONFIG',JSON.stringify(c,null,2));"

declare -a B_OTOK B_COST B_MODEL B_TIME B_ENERGY
B_TOTAL_COST=0
B_TOTAL_TIME=0
B_TOTAL_ENERGY=0

for i in "${!TASKS[@]}"; do
  START_MS=$(($(date +%s%N)/1000000))
  OUT=$(pnpm openclaw agent --local --session-id "bl-wd-${TS}-${i}" --json --message "${TASKS[$i]}" 2>&1)
  END_MS=$(($(date +%s%N)/1000000))
  ELAPSED=$(( (END_MS - START_MS) / 1000 ))

  MODEL=$(echo "$OUT" | grep -oP '"model":\s*"\K[^"]+' | tail -1 || echo "unknown")
  OTOK=$(echo "$OUT" | grep -oP '"output":\s*\K[0-9]+' | head -1 || echo "0")
  CPER=$(cost_per_tok "$MODEL")
  COST=$(echo "scale=6; $OTOK * $CPER" | bc 2>/dev/null || echo "0")

  # Extract energy from plugin output (if present) — should not be since plugin is disabled
  # Use output-token-based estimation for baseline consistency
  ENERGY_EFFICIENCY_VAL="1.03"  # Qwen 397B tok/J
  ENERGY=$(echo "scale=1; $OTOK / $ENERGY_EFFICIENCY_VAL" | bc 2>/dev/null || echo "0")

  B_OTOK[$i]="$OTOK"
  B_COST[$i]="$COST"
  B_MODEL[$i]="$MODEL"
  B_TIME[$i]="$ELAPSED"
  B_ENERGY[$i]="$ENERGY"
  B_TOTAL_COST=$(echo "$B_TOTAL_COST + $COST" | bc 2>/dev/null)
  B_TOTAL_TIME=$((B_TOTAL_TIME + ELAPSED))
  B_TOTAL_ENERGY=$(echo "$B_TOTAL_ENERGY + $ENERGY" | bc 2>/dev/null)

  SM=$(short_model "$MODEL")
  printf "  \033[36m[baseline]\033[0m %-18s  \033[1m%-12s\033[0m  %4s tok  %3ds  \033[2m~%.0fJ  \$%s\033[0m\n" \
    "${LABELS[$i]}" "$SM" "$OTOK" "$ELAPSED" "$ENERGY" "$COST"
done

echo ""
printf "  \033[36mBaseline: \$%s  ~%.0fJ  %ds\033[0m\n" "$B_TOTAL_COST" "$B_TOTAL_ENERGY" "$B_TOTAL_TIME"
echo ""

# ═══ ENERGY-AWARE ═══
echo -e "\033[1m━━━ ENERGY-AWARE (discriminator routing) ━━━━━━━━━━━━━━━━━━━━\033[0m"
echo ""

node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$CONFIG','utf8'));if(c.plugins?.entries?.['energy-aware'])c.plugins.entries['energy-aware'].enabled=true;fs.writeFileSync('$CONFIG',JSON.stringify(c,null,2));"

declare -a E_OTOK E_COST E_MODEL E_TIER E_TIME E_ENERGY
E_TOTAL_COST=0
E_TOTAL_TIME=0
E_TOTAL_ENERGY=0

for i in "${!TASKS[@]}"; do
  START_MS=$(($(date +%s%N)/1000000))
  FULL=$(pnpm openclaw agent --local --session-id "ea-wd-${TS}-${i}" --json --message "${TASKS[$i]}" 2>&1)
  END_MS=$(($(date +%s%N)/1000000))
  ELAPSED=$(( (END_MS - START_MS) / 1000 ))

  TIER=$(echo "$FULL" | grep -oP '\[energy-aware\] \K\S+(?= ->)' | head -1 || echo "?")
  MODEL=$(echo "$FULL" | grep -oP 'model overridden to \K\S+' | tail -1)
  [ -z "$MODEL" ] && MODEL=$(echo "$FULL" | grep -oP '"model":\s*"\K[^"]+' | tail -1)
  MODEL=$(echo "$MODEL" | sed 's/\x1b\[[0-9;]*m//g')  # strip ANSI
  OTOK=$(echo "$FULL" | grep -oP '"output":\s*\K[0-9]+' | head -1 || echo "0")
  CPER=$(cost_per_tok "$MODEL")
  COST=$(echo "scale=6; $OTOK * $CPER" | bc 2>/dev/null || echo "0")

  # Extract energy from plugin's llm_output line
  PLUGIN_ENERGY=$(echo "$FULL" | grep -oP 'Energy: \K[0-9.]+' | tail -1 || echo "")
  if [ -n "$PLUGIN_ENERGY" ] && [ "$PLUGIN_ENERGY" != "0" ]; then
    ENERGY="$PLUGIN_ENERGY"
  else
    # Fallback: estimate from output tokens
    case "$MODEL" in
      *gpt-oss*)   EFF="0.50" ;;
      *Devstral*)  EFF="22.35" ;;
      *Kimi*)      EFF="0.21" ;;
      *)           EFF="1.03" ;;
    esac
    ENERGY=$(echo "scale=1; $OTOK / $EFF" | bc 2>/dev/null || echo "0")
  fi

  E_OTOK[$i]="$OTOK"
  E_COST[$i]="$COST"
  E_MODEL[$i]="$MODEL"
  E_TIER[$i]="$TIER"
  E_TIME[$i]="$ELAPSED"
  E_ENERGY[$i]="$ENERGY"
  E_TOTAL_COST=$(echo "$E_TOTAL_COST + $COST" | bc 2>/dev/null)
  E_TOTAL_TIME=$((E_TOTAL_TIME + ELAPSED))
  E_TOTAL_ENERGY=$(echo "$E_TOTAL_ENERGY + $ENERGY" | bc 2>/dev/null)

  SM=$(short_model "$MODEL")

  case "$TIER" in
    SIMPLE)  TC="\033[32m" ;;
    MEDIUM)  TC="\033[36m" ;;
    COMPLEX) TC="\033[35m" ;;
    THINKING) TC="\033[33m" ;;
    *)       TC="\033[2m" ;;
  esac

  printf "  ${TC}[energy-▼]\033[0m %-18s  ${TC}%-7s\033[0m \033[1m%-12s\033[0m  %4s tok  %3ds  \033[2m~%.0fJ  \$%s\033[0m\n" \
    "${LABELS[$i]}" "$TIER" "$SM" "$OTOK" "$ELAPSED" "$ENERGY" "$COST"
done

echo ""
printf "  \033[35mEnergy-aware: \$%s  ~%.0fJ  %ds\033[0m\n" "$E_TOTAL_COST" "$E_TOTAL_ENERGY" "$E_TOTAL_TIME"
echo ""

# ═══ SUMMARY TABLE ═══
echo -e "\033[1m━━━ SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
echo ""
printf "  \033[1m%-18s  %-12s  %6s  %5s  %-12s  %6s  %5s  %s\033[0m\n" \
  "Task" "Baseline" "Cost" "Time" "Routed To" "Cost" "Time" "Tier"

for i in "${!TASKS[@]}"; do
  B_SM=$(short_model "${B_MODEL[$i]}")
  E_SM=$(short_model "${E_MODEL[$i]}")
  printf "  %-18s  %-12s  \$%5s  %3ds   %-12s  \$%5s  %3ds   %s\n" \
    "${LABELS[$i]}" "$B_SM" "$(printf '%.4f' "${B_COST[$i]}")" "${B_TIME[$i]}" \
    "$E_SM" "$(printf '%.4f' "${E_COST[$i]}")" "${E_TIME[$i]}" "${E_TIER[$i]}"
done

echo ""
echo -e "  \033[1m                    ─────────────────────  ─────────────────────\033[0m"
printf "  \033[1m%-18s  %-12s  \$%5s  %3ds   %-12s  \$%5s  %3ds\033[0m\n" \
  "TOTAL" "" "$(printf '%.4f' "$B_TOTAL_COST")" "$B_TOTAL_TIME" \
  "" "$(printf '%.4f' "$E_TOTAL_COST")" "$E_TOTAL_TIME"
echo ""

# Compute deltas
if [ "$(echo "$B_TOTAL_COST > 0" | bc 2>/dev/null)" = "1" ]; then
  COST_SAVINGS=$(echo "scale=1; ($B_TOTAL_COST - $E_TOTAL_COST) / $B_TOTAL_COST * 100" | bc 2>/dev/null || echo "?")
else
  COST_SAVINGS="?"
fi

if [ "$(echo "$B_TOTAL_ENERGY > 0" | bc 2>/dev/null)" = "1" ]; then
  ENERGY_SAVINGS=$(echo "scale=1; ($B_TOTAL_ENERGY - $E_TOTAL_ENERGY) / $B_TOTAL_ENERGY * 100" | bc 2>/dev/null || echo "?")
else
  ENERGY_SAVINGS="?"
fi

if [ "$B_TOTAL_TIME" -gt 0 ]; then
  TIME_DELTA=$(( E_TOTAL_TIME - B_TOTAL_TIME ))
  TIME_PCT=$(echo "scale=1; $TIME_DELTA * 100 / $B_TOTAL_TIME" | bc 2>/dev/null || echo "?")
  if [ "$TIME_DELTA" -ge 0 ]; then
    TIME_LABEL="+${TIME_DELTA}s (+${TIME_PCT}%)"
  else
    TIME_LABEL="${TIME_DELTA}s (${TIME_PCT}%)"
  fi
else
  TIME_LABEL="?"
fi

echo -e "  \033[1m\033[32m▼ Cost saved:   ${COST_SAVINGS}%\033[0m"
printf "  \033[1m\033[32m▼ Energy saved: %s%%\033[0m  \033[2m(%.0fJ -> %.0fJ)\033[0m\n" "$ENERGY_SAVINGS" "$B_TOTAL_ENERGY" "$E_TOTAL_ENERGY"
echo -e "  \033[1m  Time delta:   ${TIME_LABEL}\033[0m  \033[2m(includes classifier overhead)\033[0m"
echo ""

# Restore config
cp "${CONFIG}.bak" "$CONFIG"
rm -f "${CONFIG}.bak"
