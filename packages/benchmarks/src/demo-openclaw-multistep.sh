#!/usr/bin/env bash
#
# Energy-Aware Multi-Step Coding Demo via OpenClaw
#
# Each build step is a separate openclaw agent call, so the discriminator
# routes each step to the cheapest adequate model:
#
#   Step 1 (interfaces)    -> likely SIMPLE  -> GPT-OSS 20B   ($0.16/M)
#   Step 2 (core impl)     -> likely MEDIUM  -> Devstral 24B  ($0.35/M)
#   Step 3 (edge cases)    -> likely MEDIUM  -> Devstral 24B  ($0.35/M)
#   Step 4 (consolidate)   -> likely MEDIUM  -> Devstral 24B  ($0.35/M)
#
# Without energy-aware routing, all steps would use the default model
# (typically the most expensive one configured).
#
# Usage:
#   cd ~/dev/openclaw
#   export NEURALWATT_API_KEY=...
#   bash ~/dev/energy-aware/packages/benchmarks/src/demo-openclaw-multistep.sh
#

set -euo pipefail

# Ensure nvm is loaded
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22 > /dev/null 2>&1

cd ~/dev/openclaw

SESSION="demo-multistep-$(date +%s)"

echo ""
echo "============================================================"
echo "  Energy-Aware Multi-Step Coding Demo"
echo "  Session: $SESSION"
echo "============================================================"
echo ""
echo "  Each step gets its own discriminator classification."
echo "  Simple tasks -> cheap models. Complex tasks -> capable models."
echo ""

# Step 1: Define interfaces (should route to SIMPLE)
echo "------------------------------------------------------------"
echo "  STEP 1: Define interfaces"
echo "------------------------------------------------------------"
pnpm openclaw agent --local --session-id "$SESSION" \
  --message "Define TypeScript interfaces for an LRU cache: LRUCacheOptions with a capacity field, and a generic LRUCache<K,V> class signature with get(key), set(key, value), has(key), delete(key), clear(), and a size property. Just the type definitions, no implementation." \
  2>&1 | grep -E '\[energy-aware\]|```|interface|class|export'
echo ""

# Step 2: Implement core class (should route to MEDIUM)
echo "------------------------------------------------------------"
echo "  STEP 2: Implement core class"
echo "------------------------------------------------------------"
pnpm openclaw agent --local --session-id "$SESSION" \
  --message "Implement the LRUCache<K,V> class using a Map for O(1) get and set. On get/set, delete and re-insert the key to maintain recency order. Evict the least recently used entry when capacity is exceeded. Include JSDoc comments." \
  2>&1 | grep -E '\[energy-aware\]|```|class LRU|get\(|set\('
echo ""

# Step 3: Add validation and edge cases (should route to MEDIUM)
echo "------------------------------------------------------------"
echo "  STEP 3: Add validation and edge cases"
echo "------------------------------------------------------------"
pnpm openclaw agent --local --session-id "$SESSION" \
  --message "Add input validation to the LRUCache constructor: throw descriptive errors for invalid capacity (must be positive integer). Add a peek(key) method that reads without updating recency, and a forEach callback method." \
  2>&1 | grep -E '\[energy-aware\]|```|throw|peek|forEach'
echo ""

# Step 4: Consolidate (should route to MEDIUM)
echo "------------------------------------------------------------"
echo "  STEP 4: Consolidate into final implementation"
echo "------------------------------------------------------------"
pnpm openclaw agent --local --session-id "$SESSION" \
  --message "Write the final complete TypeScript implementation combining everything from the previous steps into a single file. Export the LRUCacheOptions interface and LRUCache class. No imports except node standard lib. Output raw TypeScript only, no markdown." \
  2>&1 | grep -E '\[energy-aware\]|```|export'
echo ""

echo "============================================================"
echo "  Demo complete. Each step was routed independently."
echo "============================================================"
