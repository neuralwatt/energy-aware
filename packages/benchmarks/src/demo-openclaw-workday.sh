#!/usr/bin/env bash
#
# Energy-Aware OpenClaw Demo: A Developer's Workday
#
# Simulates a realistic mix of tasks a developer sends to openclaw
# throughout a day. Shows how energy-aware routing saves money by
# matching model capability to task complexity.
#
# Without the plugin: every task uses Qwen 397B ($4.14/M output)
# With the plugin: simple tasks get GPT-OSS ($0.16/M), medium get
# Devstral ($0.35/M), only complex tasks get Qwen 397B ($4.14/M)
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

# --- Tasks that represent a real developer workday ---
# Mix of simple, medium, and complex tasks

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

# Cost per output token by model
cost_per_tok() {
  case "$1" in
    *gpt-oss*) echo "0.00000016" ;;
    *Devstral*) echo "0.00000035" ;;
    *Kimi*) echo "0.00000259" ;;
    *) echo "0.00000414" ;;
  esac
}

short_model() {
  echo "$1" | sed 's|.*/||' | sed 's|\x1b\[[0-9;]*m||g'
}

# --- Header ---
echo ""
echo -e "\033[1m╔══════════════════════════════════════════════════════════════╗\033[0m"
echo -e "\033[1m║       Energy-Aware OpenClaw Demo: Developer Workday        ║\033[0m"
echo -e "\033[1m╚══════════════════════════════════════════════════════════════╝\033[0m"
echo ""
echo -e "  \033[2m6 tasks of varying complexity, typical of a developer's day.\033[0m"
echo -e "  \033[2mWithout routing: all tasks use Qwen 397B (\$4.14/M output)\033[0m"
echo -e "  \033[2mWith routing: discriminator picks cheapest adequate model\033[0m"
echo ""

# ═══ BASELINE ═══
echo -e "\033[1m━━━ BASELINE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
echo ""

# Disable plugin
cp "$CONFIG" "${CONFIG}.bak"
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$CONFIG','utf8'));if(c.plugins?.entries?.['energy-aware'])c.plugins.entries['energy-aware'].enabled=false;fs.writeFileSync('$CONFIG',JSON.stringify(c,null,2));"

declare -a B_OTOK B_COST B_MODEL
B_TOTAL=0

for i in "${!TASKS[@]}"; do
  OUT=$(pnpm openclaw agent --local --session-id "bl-wd-${TS}-${i}" --json --message "${TASKS[$i]}" 2>/dev/null)
  MODEL=$(echo "$OUT" | grep -oP '"model":\s*"\K[^"]+' | tail -1 || echo "unknown")
  OTOK=$(echo "$OUT" | grep -oP '"output":\s*\K[0-9]+' | head -1 || echo "0")
  CPER=$(cost_per_tok "$MODEL")
  COST=$(echo "scale=6; $OTOK * $CPER" | bc 2>/dev/null || echo "0")

  B_OTOK[$i]="$OTOK"
  B_COST[$i]="$COST"
  B_MODEL[$i]="$MODEL"
  B_TOTAL=$(echo "$B_TOTAL + $COST" | bc 2>/dev/null)

  SM=$(short_model "$MODEL")
  printf "  \033[36m[baseline]\033[0m %-20s  \033[1m%-14s\033[0m  %5s tok  \033[2m\$%s\033[0m\n" \
    "${LABELS[$i]}" "$SM" "$OTOK" "$COST"
done

echo ""
printf "  \033[36mBaseline total: \$%s\033[0m\n" "$B_TOTAL"
echo ""

# ═══ ENERGY-AWARE ═══
echo -e "\033[1m━━━ ENERGY-AWARE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
echo ""

# Re-enable plugin
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$CONFIG','utf8'));if(c.plugins?.entries?.['energy-aware'])c.plugins.entries['energy-aware'].enabled=true;fs.writeFileSync('$CONFIG',JSON.stringify(c,null,2));"

declare -a E_OTOK E_COST E_MODEL E_TIER
E_TOTAL=0

for i in "${!TASKS[@]}"; do
  FULL=$(pnpm openclaw agent --local --session-id "ea-wd-${TS}-${i}" --json --message "${TASKS[$i]}" 2>&1)

  TIER=$(echo "$FULL" | grep -oP '\[energy-aware\] \K\S+(?= ->)' | head -1 || echo "?")
  MODEL=$(echo "$FULL" | grep -oP 'model overridden to \K\S+' | tail -1)
  [ -z "$MODEL" ] && MODEL=$(echo "$FULL" | grep -oP '"model":\s*"\K[^"]+' | tail -1)
  MODEL_CLEAN=$(echo "$MODEL" | sed 's|\x1b\[[0-9;]*m||g')
  OTOK=$(echo "$FULL" | grep -oP '"output":\s*\K[0-9]+' | head -1 || echo "0")
  CPER=$(cost_per_tok "$MODEL_CLEAN")
  COST=$(echo "scale=6; $OTOK * $CPER" | bc 2>/dev/null || echo "0")
  REASON=$(echo "$FULL" | grep -oP 'Reason: \K[^|]+' | head -1 | sed 's/ *$//' || echo "")

  E_OTOK[$i]="$OTOK"
  E_COST[$i]="$COST"
  E_MODEL[$i]="$MODEL_CLEAN"
  E_TIER[$i]="$TIER"
  E_TOTAL=$(echo "$E_TOTAL + $COST" | bc 2>/dev/null)

  SM=$(short_model "$MODEL_CLEAN")

  case "$TIER" in
    SIMPLE)  TC="\033[32m" ;;
    MEDIUM)  TC="\033[36m" ;;
    COMPLEX) TC="\033[35m" ;;
    THINKING) TC="\033[33m" ;;
    *)       TC="\033[2m" ;;
  esac

  printf "  ${TC}[energy-▼]\033[0m %-20s  ${TC}%-8s\033[0m \033[1m%-14s\033[0m  %5s tok  \033[2m\$%s\033[0m\n" \
    "${LABELS[$i]}" "$TIER" "$SM" "$OTOK" "$COST"
done

echo ""
printf "  \033[35mEnergy-aware total: \$%s\033[0m\n" "$E_TOTAL"
echo ""

# ═══ SUMMARY ═══
echo -e "\033[1m━━━ SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
echo ""
printf "  \033[1m%-20s  %-14s  %-8s  %-14s  %s\033[0m\n" "Task" "Baseline" "Cost" "Energy-Aware" "Tier"

for i in "${!TASKS[@]}"; do
  B_SM=$(short_model "${B_MODEL[$i]}")
  E_SM=$(short_model "${E_MODEL[$i]}")
  printf "  %-20s  %-14s  \$%-7s  %-14s  %s\n" \
    "${LABELS[$i]}" "$B_SM" "${B_COST[$i]}" "$E_SM" "${E_TIER[$i]}"
done

echo ""
printf "  Baseline total:     \033[36m\$%s\033[0m\n" "$B_TOTAL"
printf "  Energy-aware total: \033[35m\$%s\033[0m\n" "$E_TOTAL"

if [ "$(echo "$B_TOTAL > 0" | bc 2>/dev/null)" = "1" ] && [ "$(echo "$E_TOTAL > 0" | bc 2>/dev/null)" = "1" ]; then
  SAVINGS=$(echo "scale=1; ($B_TOTAL - $E_TOTAL) / $B_TOTAL * 100" | bc 2>/dev/null || echo "?")
  echo ""
  echo -e "  \033[1m\033[32m▼ Cost saved: ${SAVINGS}%\033[0m"
fi
echo ""

# Restore config
cp "${CONFIG}.bak" "$CONFIG"
rm -f "${CONFIG}.bak"
