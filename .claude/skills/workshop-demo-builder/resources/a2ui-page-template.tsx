// TEMPLATE — a new no-key A2UI /dev demo.
//
// Copy this to  frontend/src/app/dev/<your-name>/page.tsx  and:
//   1. rename SURFACE_ID / DEMO_ID below,
//   2. rewrite SEED_MESSAGES (the JSON UI is the whole point),
//   3. add a PLAYGROUNDS entry in frontend/src/app/dev/page.tsx (see bottom).
//
// This is the SEED-ONLY shape: it renders a hand-authored A2UI surface with no
// backend, no agent, no key — the /dev baseline. To make a click drive a real
// agent turn, see the fuller frontend/src/app/dev/a2ui/page.tsx (adds
// triggerOnAction + a session bootstrap; that path needs a key).

"use client";

import { useEffect, useRef } from "react";
import { basicCatalog } from "@a2ui/react/v0_9";
import { A2UISurfaceMount } from "@/components/protocols/A2UISurfaceMount";
import {
  SurfaceRegistryProvider,
  useSurfaceRegistry,
} from "@/providers/SurfaceRegistry";

const SURFACE_ID = "my-demo-main";
const DEMO_ID = "my-demo"; // used only for the seed dedupe id below

// ── The JSON UI. Three A2UI v0.9 messages. ────────────────────────────────
// GOTCHAS (learned the hard way — keep them):
//  • createSurface declares ONLY surfaceId + catalogId. Components put here are
//    silently dropped → the surface renders "[Loading root...]" forever.
//  • The root component id is "root" by convention (the renderer mounts "root").
//  • updateDataModel is { surfaceId, path, value } — NOT { surfaceId, data }.
//    A `data` blob is ignored and every binding resolves to nothing.
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
        // Container: lists its children by id.
        { id: "root", component: "Column", children: ["title", "greeting"] },
        // A literal Text.
        { id: "title", component: "Text", text: "My A2UI demo", variant: "h2" },
        // A data-BOUND Text: reads /greeting from the data model below.
        { id: "greeting", component: "Text", text: { path: "/greeting" } },
        // Add more nodes here — Button, Row, TextField, Image… (basicCatalog).
      ],
    },
  },
  {
    version: "v0.9",
    updateDataModel: {
      surfaceId: SURFACE_ID,
      path: "/",
      value: {
        // Everything a { path: "/foo" } binding reads lives here.
        greeting: "Rendered from JSON — zero React.",
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
    registry.appendMessages(SURFACE_ID, SEED_MESSAGES, `${DEMO_ID}-seed`);
  }, [registry]);
  return null;
}

export default function MyDemoPage() {
  useEffect(() => {
    // House style: narrate the demo to the console so attendees can follow.
    console.log(
      "%c/dev/%s%c — a hand-seeded A2UI surface. Edit SEED_MESSAGES and save to see it re-render.",
      "color:#e73c17;font-weight:700",
      DEMO_ID,
      "color:inherit",
    );
  }, []);

  return (
    <SurfaceRegistryProvider>
      <main className="mx-auto max-w-3xl space-y-8 p-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">My A2UI demo</h1>
          <p className="text-sm text-muted-foreground">
            A declarative UI drawn from JSON — no key, no backend. Edit{" "}
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

// ── Then register it in frontend/src/app/dev/page.tsx PLAYGROUNDS: ─────────
//
//   {
//     href: "/dev/my-demo",
//     title: "My A2UI demo",
//     blurb: "One-line description of what it shows.",
//     needs: "nothing — seeds render offline",
//   },
