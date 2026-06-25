#!/usr/bin/env bash
# Codespaces / devcontainer setup for the "Build AI UIs Beyond Chat" workshop.
# Runs once on container creation: installs make + uv, then the backend and
# frontend dependencies, so the attendee just adds a Gemini key and runs the app.
set -euo pipefail

echo "==> Installing make…"
sudo apt-get update -qq
sudo apt-get install -y -qq make

echo "==> Installing uv (Python package manager)…"
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
# Put uv on the default PATH for every shell (login, non-login, and `make dev-local`)
# so we don't depend on profile sourcing or devcontainer PATH substitution.
sudo ln -sf "$HOME/.local/bin/uv" /usr/local/bin/uv
sudo ln -sf "$HOME/.local/bin/uvx" /usr/local/bin/uvx

echo "==> Backend dependencies (uv sync)…"
( cd backend && uv sync )

echo "==> Frontend dependencies (npm install)…"
( cd frontend && npm install )

cat <<'NEXT'

────────────────────────────────────────────────────────────
✅ Setup complete.

Two steps to run the app:

  1. Add your free Gemini key (https://aistudio.google.com/apikey):
       echo "GEMINI_API_KEY=your-key-here" > backend/.env

  2. Start it:
       make dev-local

Port 3456 will auto-open — you should see the yellow LOCAL_MODE banner.
Send a message; the reply streams back via AG-UI.
────────────────────────────────────────────────────────────
NEXT
