#!/usr/bin/env bash
# Shared preflight: make sure `uv` is installed AND reachable on PATH before
# any script tries to run `uv run …`.
#
# Why this exists: the backend uses uv (Astral's fast Python package manager)
# for every command. Astral's installer drops the binary in ~/.local/bin (or
# ~/.cargo/bin on older installs) and appends that dir to your shell profile —
# but your CURRENT shell won't pick it up until you restart it. So the classic
# workshop failure is: `make install` installs uv fine, then the very next
# `make dev` in the same terminal dies with "uv: command not found". Attendees
# read that as "the workshop is broken" when it's really just PATH.
#
# `require_uv` handles both cases with a friendly, actionable message:
#   - uv on PATH            → silent pass
#   - uv installed, off PATH → repair PATH for THIS run + tell them how to fix it
#   - uv not installed       → print install + PATH instructions, then exit 1
#
# Source it and call it:
#     source "$REPO_ROOT/scripts/lib/check-uv.sh"
#     require_uv

# Directories Astral's installer uses, in the order we should prefer them.
_UV_KNOWN_DIRS=("$HOME/.local/bin" "$HOME/.cargo/bin")

require_uv() {
    if command -v uv >/dev/null 2>&1; then
        return 0
    fi

    # Installed but not on this shell's PATH — recover for this run so the
    # workshop keeps moving, and tell them how to make it stick.
    local dir
    for dir in "${_UV_KNOWN_DIRS[@]}"; do
        if [ -x "$dir/uv" ]; then
            export PATH="$dir:$PATH"
            echo "────────────────────────────────────────────────────────────────"
            echo "ℹ  Found uv at $dir/uv, but it wasn't on your PATH."
            echo "   Added it for this run so you're unblocked. To fix it for good,"
            echo "   add this line to your shell profile (~/.zshrc or ~/.bashrc):"
            echo ""
            echo "       export PATH=\"$dir:\$PATH\""
            echo ""
            echo "   …then restart your terminal (or: source ~/.zshrc)."
            echo "────────────────────────────────────────────────────────────────"
            return 0
        fi
    done

    # Genuinely not installed. Print install + PATH guidance and stop.
    cat >&2 <<'EOF'
────────────────────────────────────────────────────────────────
✗  uv is not installed — the backend needs it for every command.

uv is the fast Python package manager this workshop uses in place of
pip + venv. Installing it takes about 10 seconds:

  macOS / Linux:
      curl -LsSf https://astral.sh/uv/install.sh | sh

  Windows (PowerShell):
      powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
      (Recommended: run this workshop in WSL2 — the make targets need a
       POSIX shell. Inside WSL, use the macOS / Linux command above.)

IMPORTANT — after installing, your CURRENT terminal won't see uv yet.
The installer adds it to your PATH, but only new shells pick that up.
Do ONE of these, then re-run your command:

  • Close this terminal and open a new one, OR
  • Load uv into this shell right now:
        source "$HOME/.local/bin/env"

Verify it worked:   uv --version
Full install guide: https://docs.astral.sh/uv/getting-started/installation/
────────────────────────────────────────────────────────────────
EOF
    exit 1
}
