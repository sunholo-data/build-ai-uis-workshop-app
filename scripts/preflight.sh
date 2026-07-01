#!/usr/bin/env bash
# ── Workshop pre-flight smoke test ──────────────────────────────────────────
# Run this the MORNING OF the workshop, after `make dev-local`, to confirm every
# demo actually works before attendees arrive. It exercises the failure classes
# that unit tests miss (and that bit us the day before): real LLM quota/key
# issues, real multi-turn A2UI rendering, and session lifecycle.
#
#   make preflight            # or:  bash scripts/preflight.sh
#
# Exit 0 = all green. Non-zero = fix before you present.
#   2 = servers down (run make dev-local)
#   1 = a demo failed (see the line — RESOURCE_EXHAUSTED means KEY/QUOTA, not code)
set -uo pipefail

BACKEND="${PREFLIGHT_BACKEND:-http://localhost:1956}"
FRONTEND="${PREFLIGHT_FRONTEND:-http://localhost:3456}"
AUTH="Authorization: Bearer local-mode-stub-token"
SKILLS=(demo-researcher demo-form-builder demo-map-explorer demo-workspace \
        demo-workspace-interactive demo-click-counter workshop-helper)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export FRONTEND_DIR="${FRONTEND_DIR:-$SCRIPT_DIR/../frontend}"

red() { printf "\033[31m%s\033[0m\n" "$1"; }
grn() { printf "\033[32m%s\033[0m\n" "$1"; }
ylw() { printf "\033[33m%s\033[0m\n" "$1"; }
fail=0

echo "── pre-flight: workshop demos ──────────────────────────────"

# 1. servers reachable
if ! curl -sf -o /dev/null --max-time 5 "$BACKEND/health"; then
  red "✗ backend unreachable at $BACKEND — run: make dev-local"; exit 2; fi
if ! curl -sf -o /dev/null --max-time 8 "$FRONTEND/"; then
  red "✗ frontend unreachable at $FRONTEND — run: make dev-local"; exit 2; fi
grn "✓ servers up ($BACKEND · $FRONTEND)"

# 2. stream sweep — each demo must reach RUN_FINISHED with no RUN_ERROR.
#    This is the check that catches the "nothing works" 429/quota class.
echo "── streaming each demo (real LLM calls, ~1–2 min) ──"
for S in "${SKILLS[@]}"; do
  OUT=$(curl -s --max-time 45 -N -X POST "$BACKEND/api/skill/$S/stream" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"message":"hello, do your thing"}' 2>&1)
  if printf '%s' "$OUT" | grep -q 'RESOURCE_EXHAUSTED'; then
    red "  ✗ $S — RESOURCE_EXHAUSTED → KEY/QUOTA issue (check billing/quota; NOT a code bug)"; fail=1
  elif printf '%s' "$OUT" | grep -q 'RUN_ERROR'; then
    red "  ✗ $S — RUN_ERROR (see backend log: scripts/logs.sh)"; fail=1
  elif printf '%s' "$OUT" | grep -q 'RUN_FINISHED'; then
    grn "  ✓ $S"
  else
    ylw "  ⚠ $S — no RUN_FINISHED in 45s (slow or looping)"; fail=1
  fi
done

# 3. optional browser render check — catches frontend-only A2UI bugs that the
#    stream sweep can't (e.g. "Surface already exists"). Skips cleanly if
#    playwright isn't installed.
echo "── A2UI render check (browser) ──"
if command -v node >/dev/null 2>&1; then
  node "$SCRIPT_DIR/preflight-render.mjs"; rc=$?
  case $rc in
    0) grn "  ✓ A2UI renders, updates, and does NOT loop (click-counter, form-builder)";;
    3) ylw "  ~ skipped — playwright not found. Install once: (cd frontend && npm i -D playwright && npx playwright install chromium)";;
    *) red "  ✗ A2UI render/loop check FAILED — do not present until fixed"; fail=1;;
  esac
else
  ylw "  ~ skipped — node not found"
fi

echo "────────────────────────────────────────────────────────────"
if [ "$fail" -eq 0 ]; then
  grn "PRE-FLIGHT PASSED — demos are good to go."
else
  red "PRE-FLIGHT FAILED — fix the ✗ lines above before presenting."
  echo "Manual fallback — open each and confirm a reply/surface renders:"
  echo "  $FRONTEND/chat/@workshop-user/demo-form-builder   (form should render)"
  echo "  $FRONTEND/dev/a2ui                                 (click → counter increments)"
fi
exit "$fail"
