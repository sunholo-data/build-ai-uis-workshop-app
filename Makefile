.PHONY: dev dev-local preflight proxy-check logs help

# Launch backend (port 1956) + frontend (port 3000) for local development.
# Logs stream to stdout; Ctrl-C stops both.
dev:
	@chmod +x scripts/dev.sh
	@scripts/dev.sh

# Launch backend + frontend in LOCAL_MODE (no GCP creds needed for Firestore
# / Vertex Sessions / Cloud Trace; in-memory Firestore auto-seeds the demo
# skills incl. "Workspace Demo" for the MULTI-SURFACE-A2UI demo).
# Model auth still required — set GOOGLE_API_KEY in backend/.env.
# See WORKSHOP.md for the full tier-1 quickstart.
dev-local:
	@chmod +x scripts/dev-local.sh
	@scripts/dev-local.sh

# Smoke-test the frontend→backend proxy bridge locally.
# Starts both servers, probes /api/proxy/health, then exits.
proxy-check:
	@chmod +x scripts/try-proxy-local.sh
	@scripts/try-proxy-local.sh

logs:
	@scripts/logs.sh

# Morning-of pre-flight: with `make dev-local` already running, confirm every
# demo actually works before attendees arrive. Streams each demo (catches the
# 429/quota "nothing works" class) and, if playwright is installed, drives a
# real browser through the A2UI paths incl. a form-submit LOOP check. Exit 0 =
# good to present. Run: make preflight
preflight:
	@chmod +x scripts/preflight.sh
	@scripts/preflight.sh

help:
	@echo "make dev                — start backend (1956) + frontend (3456) — cloud mode (real GCP/Vertex)"
	@echo "make dev-local          — start backend + frontend in LOCAL_MODE (no GCP creds, in-memory Firestore)"
	@echo "make preflight          — morning-of check that every demo works (run with dev-local already up)"
	@echo "make proxy-check        — smoke-test the proxy bridge (CI helper)"
	@echo "make logs               — stream backend logs (OTEL noise filtered out)"
