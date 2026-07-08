// /dev/setup-guide — no-key sibling of the "Workshop Setup Guide" chat skill.
//
// The live version is a chat skill at /chat/@workshop-user/setup-guide
// (backend/db/local_fixture.py → "setup-guide"): you pick your OS on the
// ChoicePicker, click "Show install steps", and an agent turn re-emits the
// surface with the right `uv` install command for that OS. That needs a
// Gemini key.
//
// THIS page is the offline teaching artifact: it hand-seeds the SAME A2UI
// surface (macOS pre-filled) so you can read the JSON UI with no backend, no
// agent, no key. The ChoicePicker + Button render but don't drive a turn here
// (no session / triggerOnAction) — that wiring is what the chat skill adds.
// Teachable edit: swap the /osLabel + /installCmd values in SEED_MESSAGES to
// the Windows row (see the comment) and watch the shown command change — that's
// A2UI data binding in one edit.

"use client";

import { useEffect, useRef } from "react";
import { basicCatalog } from "@a2ui/react/v0_9";
import { A2UISurfaceMount } from "@/components/protocols/A2UISurfaceMount";
import {
  SurfaceRegistryProvider,
  useSurfaceRegistry,
} from "@/providers/SurfaceRegistry";

const SURFACE_ID = "setup-main";
const DEMO_ID = "setup-guide";

// ── The JSON UI. Three A2UI v0.9 messages — identical to what the setup-guide
// agent emits, so the fixture and the live skill render the same surface.
// GOTCHAS (keep them):
//  • createSurface declares ONLY surfaceId + catalogId. Components put here are
//    silently dropped → the surface renders "[Loading root...]" forever.
//  • The root component id is "root" (the renderer mounts "root").
//  • updateDataModel is { surfaceId, path, value } — NOT { surfaceId, data }.
//  • Text `variant`: only h1–h5 and body are safe. "caption" renders a literal
//    <caption> element → hydration error inside the Column.
const SEED_MESSAGES: Record<string, unknown>[] = [
  {
    version: "v0.9",
    createSurface: { surfaceId: SURFACE_ID, catalogId: basicCatalog.id },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        {
          id: "root",
          component: "Column",
          children: [
            "title",
            "intro",
            "picker",
            "showBtn",
            "div1",
            "osLine",
            "cmdLabel",
            "cmdLine",
            "noteLine",
            "extraLine",
            "div2",
            "nextHead",
            "step2",
            "step3",
            "step4",
            "step5",
          ],
        },
        {
          id: "title",
          component: "Text",
          text: "Install uv — Workshop Setup",
          variant: "h2",
        },
        {
          id: "intro",
          component: "Text",
          text: "uv is the fast Python package manager the backend uses. Pick your OS, then click Show install steps.",
        },
        // Real A2UI inputs from basicCatalog — ChoicePicker (single-select
        // chips) + a primary Button. Live in the chat skill; decorative here.
        {
          id: "picker",
          component: "ChoicePicker",
          label: "Your OS",
          variant: "mutuallyExclusive",
          displayStyle: "chips",
          options: [
            { label: "macOS", value: "macos" },
            { label: "Linux", value: "linux" },
            { label: "Windows", value: "windows" },
          ],
          value: { path: "/os" },
        },
        {
          id: "showBtn",
          component: "Button",
          variant: "primary",
          child: "showBtnLabel",
          action: { event: { name: "show-steps", context: { os: { path: "/os" } } } },
        },
        { id: "showBtnLabel", component: "Text", text: "Show install steps" },
        { id: "div1", component: "Divider" },
        // Result block — data-bound, so swapping the data model below changes
        // the shown command without touching the component tree.
        { id: "osLine", component: "Text", text: { path: "/osLabel" }, variant: "h3" },
        {
          id: "cmdLabel",
          component: "Text",
          text: "1 · Install uv — run this in your terminal:",
        },
        { id: "cmdLine", component: "Text", text: { path: "/installCmd" } },
        { id: "noteLine", component: "Text", text: { path: "/installNote" } },
        { id: "extraLine", component: "Text", text: { path: "/extraNote" } },
        { id: "div2", component: "Divider" },
        { id: "nextHead", component: "Text", text: "Then finish setup:", variant: "h3" },
        {
          id: "step2",
          component: "Text",
          text: "2 · Install dependencies — cd backend && make install (installs uv too if it's missing), then cd ../frontend && npm install",
        },
        {
          id: "step3",
          component: "Text",
          text: "3 · Add a free Gemini key — get one at https://aistudio.google.com/apikey, then: echo 'GEMINI_API_KEY=your-key' > backend/.env",
        },
        { id: "step4", component: "Text", text: "4 · Start the app — make dev-local" },
        {
          id: "step5",
          component: "Text",
          text: "5 · Open http://localhost:3456 — the yellow LOCAL_MODE banner means it's working.",
        },
      ],
    },
  },
  {
    version: "v0.9",
    updateDataModel: {
      surfaceId: SURFACE_ID,
      path: "/",
      // macOS pre-filled. TEACHABLE EDIT — swap to the Windows row to see the
      // shown command change (that's data binding, no tree edit):
      //   os: ["windows"], osLabel: "Windows",
      //   installCmd: 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
      //   installNote: "Then close and reopen your terminal so uv is on your PATH.",
      //   extraNote: "Recommended: run this workshop in WSL2 (Ubuntu) — the make targets need a POSIX shell. Inside WSL, use the Linux command.",
      value: {
        os: ["macos"],
        osLabel: "macOS",
        installCmd: "curl -LsSf https://astral.sh/uv/install.sh | sh",
        installNote:
          "Then restart your terminal (or run: source ~/.zshrc) so uv is on your PATH.",
        extraNote: "",
      },
    },
  },
];

// One-shot seeder: pushes the messages into the registry on mount. Idempotent
// (the dedupe id guards React Strict Mode's double-effect).
function Seeder() {
  const registry = useSurfaceRegistry();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    registry.appendMessages(SURFACE_ID, SEED_MESSAGES, `${DEMO_ID}-seed`);
  }, [registry]);
  return null;
}

export default function SetupGuideDevPage() {
  useEffect(() => {
    console.log(
      "%c/dev/setup-guide%c — a hand-seeded A2UI setup card (macOS). Edit the updateDataModel value in SEED_MESSAGES (try the Windows row) and save to see the shown install command change. Live, clickable version: /chat/@workshop-user/setup-guide.",
      "color:#e73c17;font-weight:700",
      "color:inherit",
    );
  }, []);

  return (
    <SurfaceRegistryProvider>
      <main className="mx-auto max-w-3xl space-y-8 p-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Workshop Setup Guide (A2UI)</h1>
          <p className="text-sm text-muted-foreground">
            The install-uv onboarding card, drawn from JSON — no key, no
            backend. The OS picker and button render from the catalog but are
            inert here; in the live chat skill (
            <code>/chat/@workshop-user/setup-guide</code>) a click fires an
            agent turn that swaps in the commands for your OS. Edit{" "}
            <code>SEED_MESSAGES</code> and save to change what renders.
          </p>
        </header>
        <Seeder />
        <div className="rounded border p-3">
          <A2UISurfaceMount surfaceId={SURFACE_ID} />
        </div>
      </main>
    </SurfaceRegistryProvider>
  );
}
