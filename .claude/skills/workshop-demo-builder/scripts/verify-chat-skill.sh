#!/usr/bin/env bash
# verify-chat-skill.sh — confirm a workshop CHAT skill seeds and is served,
# without driving a browser. Curls the by-slug skills API with the LOCAL_MODE
# stub token and checks the skill resolves.
#
# Usage:  .claude/skills/workshop-demo-builder/scripts/verify-chat-skill.sh <slug> [owner] [backend-url]
#   slug         the skill's slug, e.g. demo-travel-planner
#   owner        owner handle (default: workshop-user)
#   backend-url  default: http://localhost:1956
#
# Exit 0 = the skill resolves (seeded + served). Exit 1 = not found / not seeded
# (did you restart `make dev-local` after editing local_fixture.py?). Exit 2 =
# backend unreachable.
#
# This proves the skill EXISTS and is served. It does NOT run an agent turn, so
# it can't prove the emitted A2UI parses — for that, open
# http://localhost:<frontend>/chat/@<owner>/<slug> with a Gemini key and chat.
set -euo pipefail

SLUG="${1:?usage: verify-chat-skill.sh <slug> [owner] [backend-url]}"
OWNER="${2:-workshop-user}"
BACKEND="${3:-http://localhost:1956}"
STUB_TOKEN="local-mode-stub-token"   # backend/auth/local_mode_stub.py :: STUB_TOKEN
URL="$BACKEND/api/skills/by-slug/$OWNER/$SLUG"

# Backend up?
if ! curl -sf -o /dev/null "$BACKEND/openapi.json" 2>/dev/null; then
  echo "✗ backend unreachable at $BACKEND — is 'make dev-local' running?" >&2
  exit 2
fi

CODE=$(curl -s -o /tmp/vcs-body.json -w "%{http_code}" \
  -H "Authorization: Bearer $STUB_TOKEN" "$URL")

if [ "$CODE" = "200" ]; then
  GOT_SLUG=$(python3 -c "import json;print(json.load(open('/tmp/vcs-body.json')).get('slug',''))" 2>/dev/null || echo "")
  NAME=$(python3 -c "import json;print(json.load(open('/tmp/vcs-body.json')).get('displayName',''))" 2>/dev/null || echo "")
  if [ "$GOT_SLUG" = "$SLUG" ]; then
    echo "✓ '$SLUG' ($NAME) is seeded and served."
    echo "  open: /chat/@$OWNER/$SLUG   (chat needs a Gemini key for the live turn)"
    exit 0
  fi
  echo "✗ resolved, but slug mismatch (got '$GOT_SLUG')." >&2
  exit 1
elif [ "$CODE" = "404" ]; then
  echo "✗ '$SLUG' not found (404). Did you add it to _demo_skills() AND restart" >&2
  echo "  'make dev-local'? The seeder only runs on a fresh (empty) in-memory store." >&2
  exit 1
else
  echo "✗ unexpected HTTP $CODE from $URL" >&2
  cat /tmp/vcs-body.json >&2 2>/dev/null || true
  exit 1
fi
