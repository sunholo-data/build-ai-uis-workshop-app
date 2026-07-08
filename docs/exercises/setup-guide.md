# Setup Guide — onboarding as adaptive UI

**What it is:** the workshop's first-run helper. Instead of a README wall you scan for
your OS, the agent emits a small **A2UI** surface — an OS picker plus the exact `uv`
install command and next steps for the machine *you're* on. The UI adapts at runtime
because it's data the agent sends, not a page you read.

## The problem

Install docs are one-size-fits-all. Everyone reads the same block and mentally filters:

```md
<!-- ❌ README.md -->
Install uv:
  macOS/Linux:  curl -LsSf https://astral.sh/uv/install.sh | sh
  Windows:      powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
  (Windows note: use WSL2, the make targets need a POSIX shell …)
```

Three commands, three caveats, and the reader picks the right one under pressure at a
keyboard. The doc can't react to who's reading it.

## The protocol

The same guidance is an A2UI component tree the agent emits — a `ChoicePicker` for the
OS, a `Button`, and result lines **bound to a data model**:

```jsonc
"components": [
  { "id": "picker", "component": "ChoicePicker", "label": "Your OS",
    "variant": "mutuallyExclusive", "displayStyle": "chips",
    "options": [ {"label":"macOS","value":"macos"}, {"label":"Windows","value":"windows"} ],
    "value": { "path": "/os" } },
  { "id": "showBtn", "component": "Button", "child": "showBtnLabel",
    "action": { "event": { "name": "show-steps", "context": { "os": { "path": "/os" } } } } },
  { "id": "cmdLine", "component": "Text", "text": { "path": "/installCmd" } }
]
```

The click **is** the input: it fires an agent turn (`/surface-action-run`, Pattern 1)
that re-emits the surface with `/installCmd` set to the command for the chosen OS. Same
tree every time — only the **data model** changes. New OS = new data, zero React.

## Try it (no key)

The playground renders that surface offline, macOS pre-filled, so you can read the JSON
and see data binding without an agent or a key.

1. Open **http://localhost:3456/dev/setup-guide**. You'll see the setup card with the OS
   picker and the macOS `uv` command.
2. Open `frontend/src/app/dev/setup-guide/page.tsx` and find **`SEED_MESSAGES`**. The
   command you see comes from the **`updateDataModel`** message's `value`, not the
   component tree.
3. **Teachable edit:** in that `value`, swap the macOS row for Windows, save, and watch
   the shown command change — the component tree never moves:

   ```ts
   value: {
     os: ["windows"],
     osLabel: "Windows",
     installCmd: 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
     installNote: "Then close and reopen your terminal so uv is on your PATH.",
     extraNote: "Recommended: run this workshop in WSL2 (Ubuntu) — the make targets need a POSIX shell. Inside WSL, use the Linux command.",
   },
   ```

   That's A2UI data binding in one edit: the same `{ path: "/installCmd" }` text node now
   renders the Windows command.

## The one-liner (your teach-back)

> With A2UI the agent emits the UI as data, so onboarding adapts to the user at runtime —
> pick your OS, get *your* install command — instead of everyone reading the same static doc.

## Go further (optional, needs a key)

The live version is a **chat skill** at `/chat/@workshop-user/setup-guide` (seeded in
`backend/db/local_fixture.py` → `setup-guide`). Run `make dev-local` with a Gemini key in
`backend/.env`, open it, click an OS chip, and click **Show install steps** — the click
alone fires an agent turn that re-emits the surface with your OS's command. That's the
same Pattern 1 (click-driven, no chat composer) the click-counter demo uses, doing real
onboarding work.
