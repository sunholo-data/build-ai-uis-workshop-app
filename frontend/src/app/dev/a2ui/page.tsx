// /dev/a2ui — A2UI × AG-UI playground.
//
// Despite the route name, this page is a two-protocol demo. A2UI is the
// declarative surface (what to render); AG-UI is the event stream (how the
// agent talks back). The whole point of Pattern 1 is the interaction between
// them: a click on an A2UI surface starts an AG-UI run, and the reply streams
// back as AG-UI events — one of which (a `send_a2ui_json_to_client` tool
// result) carries a fresh A2UI batch that re-renders the surface. A2UI rides
// on AG-UI. The wire log below tags every frame with which protocol it is.
//
// A standalone dev page that hosts hand-curated A2UI scenarios so we can
// exercise each rendering pattern without needing a real agent run. The
// page wires the SurfaceRegistryProvider itself (the global layout only
// provides AuthProvider), so each Pattern section can mount one or more
// `<A2UISurfaceMount>` components with whatever skill/session ids it
// needs.
//
// ── ACTION-TRIGGER M3.1 (sprint 1.21) ──
// The Pattern 1 — Click-Driven section mounts a single A2UI surface with
// `triggerOnAction={true}`. The hand-crafted A2UI message seeds a
// Button-with-counter shape that matches what the `demo-click-counter`
// LOCAL_MODE skill emits, so the visual look matches whether the page
// is opened against a live backend or in a vitest. Each click POSTs to
// `/api/skills/demo-click-counter/sessions/.../surface-action-run` — the
// agent re-emits an updated surface; no chat bubble appears.
//
// ── WIRE LOG (2026-07) ──
// Pattern 1 has no chat box, so from the user's chair a click either
// "just works" or silently does nothing — you can't see the request or
// the response. The wire log below makes the whole round trip visible:
//   • seed  — the hand-fed A2UI messages that build the button (they stand
//             in for the agent's first turn: createSurface / updateComponents
//             / updateDataModel);
//   • sent  — the click, as an A2UI client action, starting an AG-UI run;
//   • recv  — every AG-UI SSE frame the agent streams back, ending with the
//             re-emitted A2UI batch that re-renders the counter.
// Each row carries (a) a protocol tag (A2UI vs AG-UI) so the interaction
// reads at a glance, and (b) a plain-English "why this fires" line — not
// just the event name — because the event name alone (RUN_STARTED,
// TOOL_CALL_ARGS…) doesn't tell a newcomer what the agent is doing or why.
// The sent/recv frames come from `useActionDrivenAgent`'s optional `onWire`
// tap (forwarded through `A2UISurfaceMount`); the seed frames are logged
// here where the seed is fed in. Same log/chip treatment as
// /dev/mcp-apps/active.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { basicCatalog } from "@a2ui/react/v0_9";
import { A2UISurfaceMount } from "@/components/protocols/A2UISurfaceMount";
import type { WireEvent } from "@/hooks/useActionDrivenAgent";
import { fetchWithAuth } from "@/lib/apiClient";
import {
  SurfaceRegistryProvider,
  useSurfaceRegistry,
} from "@/providers/SurfaceRegistry";

// Shared contract (sprint 1.21 ACTION-TRIGGER M3 — pinned in the sprint
// plan, mirrored by the CLI subcommand and the smoke script).
const PATTERN1_SKILL_ID = "demo-click-counter";
const PATTERN1_SURFACE_ID = "counter-main";
const PATTERN1_SESSION_ID = "pattern1-fixture-001";

/**
 * Hand-crafted A2UI v0.9 payload that mirrors what the `demo-click-counter`
 * agent emits on its first turn. Pushed into the SurfaceRegistry directly
 * so the fixture page renders the Button even when no agent is running.
 *
 * Wire format reference: `backend/db/local_fixture.py` -> demo-click-counter
 * skill instructions. The two stay in lock-step deliberately: the click on
 * this rendered Button fires action `increment` whether it came from the
 * fixture seed or a live agent turn.
 */
const PATTERN1_SEED_MESSAGES: Record<string, unknown>[] = [
  {
    // v0.9 `createSurface` declares ONLY surfaceId + catalogId — the SDK's
    // MessageProcessor ingests components exclusively via `updateComponents`
    // (see @a2ui/web_core message-processor: createSurface never reads a
    // `components` field). Emitting components inline here silently drops them,
    // so the surface renders "[Loading root...]" forever. The root component id
    // is "root" by convention (A2uiSurface renders DeferredChild id="root").
    version: "v0.9",
    createSurface: {
      surfaceId: PATTERN1_SURFACE_ID,
      catalogId: basicCatalog.id,
    },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: PATTERN1_SURFACE_ID,
      components: [
        {
          id: "root",
          component: "Column",
          children: ["title", "display", "btn"],
        },
        {
          id: "title",
          component: "Text",
          text: "Click Counter",
          variant: "h2",
        },
        {
          id: "display",
          component: "Text",
          text: { path: "/counterDisplay" },
        },
        {
          id: "btn",
          component: "Button",
          child: "btn-label",
          action: {
            event: {
              name: "increment",
              context: {},
            },
          },
        },
        {
          id: "btn-label",
          component: "Text",
          text: "Click me",
        },
      ],
    },
  },
  {
    // v0.9 `updateDataModel` sets ONE path to a value: { surfaceId, path, value }.
    // (Not { surfaceId, data: {...} } — the processor reads payload.path/value,
    // so a `data` blob is silently ignored and bindings resolve to nothing.)
    version: "v0.9",
    updateDataModel: {
      surfaceId: PATTERN1_SURFACE_ID,
      path: "/",
      value: {
        counter: 0,
        counterDisplay: "Clicks: 0",
      },
    },
  },
];

// ─── Wire log ─────────────────────────────────────────────────────────────

/** seed = hand-fed A2UI; sent = client→server; recv = server→client. */
type WireKind = "seed" | "sent" | "recv";

interface WireLogEntry {
  id: number;
  ts: number;
  kind: WireKind;
  /** Short protocol label (message/event name). */
  label: string;
  /** Full frame for the expandable JSON view. */
  payload: unknown;
}

// Per-kind chip: an arrow for direction + a colour, so each frame maps to
// one leg of the round trip at a glance. Mirrors /dev/mcp-apps/active.
const KIND_META: Record<
  WireKind,
  { chip: string; arrow: string; cls: string; title: string }
> = {
  seed: {
    chip: "seed",
    arrow: "•",
    cls: "border-border bg-muted text-muted-foreground",
    title: "Hand-fed A2UI — stands in for the agent's first turn",
  },
  sent: {
    chip: "sent",
    arrow: "↑",
    cls: "border-blue-300 bg-blue-100 text-blue-700",
    title: "Client → server (your click)",
  },
  recv: {
    chip: "recv",
    arrow: "↓",
    cls: "border-emerald-300 bg-emerald-50 text-emerald-700",
    title: "Server → client (the agent's response stream)",
  },
};

// The two protocols on the wire. A2UI = the declarative surface (what to
// render); AG-UI = the event stream (how the agent talks back). The pill
// makes the interaction legible: A2UI (click) → AG-UI (event stream) → A2UI
// (new surface), with the last A2UI batch riding *inside* an AG-UI event.
type Protocol = "A2UI" | "AG-UI";
const PROTOCOL_META: Record<Protocol, { cls: string; title: string }> = {
  A2UI: {
    cls: "border-violet-300 bg-violet-100 text-violet-700",
    title: "A2UI — the declarative surface (what to render)",
  },
  "AG-UI": {
    cls: "border-amber-300 bg-amber-100 text-amber-700",
    title: "AG-UI — the agent event stream (how the agent talks back)",
  },
};

// Label of the derived frame the hook emits when it unwraps the A2UI batch
// from a send_a2ui_json_to_client tool result. Kept in sync with
// useActionDrivenAgent by matching on the "A2UI messages" suffix below.
const DERIVED_A2UI_LABEL_MARKER = "A2UI messages";

/**
 * Which protocol a frame belongs to. Seed + sent are A2UI-shaped (the
 * surface build and the client action). Received frames are AG-UI events —
 * except the derived batch, which is the A2UI payload carried inside an
 * AG-UI tool-call result.
 */
function protocolFor(kind: WireKind, label: string): Protocol {
  if (kind !== "recv") return "A2UI";
  return label.includes(DERIVED_A2UI_LABEL_MARKER) ? "A2UI" : "AG-UI";
}

/**
 * Plain-English "why this frame fires" — the event name alone (RUN_STARTED,
 * TOOL_CALL_ARGS…) doesn't tell a newcomer what the agent is doing. Keyed by
 * AG-UI event type / A2UI op; falls back to a generic line for anything not
 * enumerated so an unfamiliar event never renders bare.
 */
const AGUI_EVENT_WHY: Record<string, string> = {
  RUN_STARTED: "The agent turn has begun — one fires at the start of every run.",
  RUN_FINISHED:
    "The turn is complete; nothing more will stream. The surface is now up to date and the hook resolves here.",
  RUN_ERROR: "The turn failed server-side — this frame carries the error message.",
  STEP_STARTED: "An internal agent step began.",
  STEP_FINISHED: "An internal agent step finished.",
  TEXT_MESSAGE_START:
    "The agent started streaming assistant text. Pattern 1 has no chat bubble, so this page ignores it.",
  TEXT_MESSAGE_CONTENT:
    "A chunk of streamed assistant text (ignored here — there's no chat bubble on this page).",
  TEXT_MESSAGE_END: "The assistant text is finished (ignored here).",
  TOOL_CALL_START:
    "The agent decided to call a tool and named it — here it's send_a2ui_json_to_client, the tool that emits A2UI.",
  TOOL_CALL_ARGS:
    "A delta-encoded chunk of that tool call's JSON arguments, streamed as the model writes them.",
  TOOL_CALL_END: "The tool call's arguments are complete; the tool is about to run.",
  TOOL_CALL_RESULT:
    "The tool ran and returned. For the A2UI tool, that return value is the new surface batch (see the next row).",
  STATE_SNAPSHOT:
    "A full snapshot of the agent's shared state (e.g. the counter value persisted in the session).",
  STATE_DELTA: "A patch to the agent's shared state since the previous frame.",
  MESSAGES_SNAPSHOT: "A full snapshot of the conversation's messages.",
};

const A2UI_OP_WHY: Record<string, string> = {
  createSurface:
    "Declares an empty A2UI surface (id + component catalog). Components and data arrive in follow-up messages.",
  updateComponents:
    "Sends the component tree — the Column, Text labels and Button that make up the counter.",
  updateDataModel:
    "Sets the surface data the Text bindings read (counter, and the “Clicks: N” label).",
  deleteSurface: "Tears the surface down.",
};

/** The "why this fires" line for a single wire frame. Never returns empty. */
function explainFrame(kind: WireKind, label: string): string {
  if (kind === "seed") return A2UI_OP_WHY[label] ?? "An A2UI surface message.";
  if (kind === "sent")
    return "Your click, as an A2UI client action. It starts an AG-UI run on the agent — no chat message is sent.";
  if (label.includes(DERIVED_A2UI_LABEL_MARKER))
    return "The A2UI batch, unwrapped from the tool result — the frame that actually re-renders the counter. This is A2UI carried inside an AG-UI event.";
  return AGUI_EVENT_WHY[label] ?? "An AG-UI event.";
}

/** Label a raw A2UI v0.9 message by its single operation key, for the log. */
function labelA2uiMessage(message: Record<string, unknown>): string {
  for (const key of [
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
  ]) {
    if (key in message) return key;
  }
  return "a2ui";
}

/**
 * The round-trip inspector. Append-only, newest at the bottom, each frame
 * expandable to its raw JSON. Rendered below the surface so a click and its
 * consequences read top-to-bottom.
 */
function WireLog({
  entries,
  onClear,
}: {
  entries: WireLogEntry[];
  onClear: () => void;
}) {
  return (
    <section className="space-y-2" data-testid="a2ui-wire-log">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Wire log — A2UI × AG-UI</h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
          >
            clear
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Every frame in and out of the surface, tagged with its protocol. The
        button is <span className="font-medium">seeded</span> with three A2UI
        messages; clicking it <span className="font-medium">sends</span> an
        A2UI action to <code>surface-action-run</code>, which starts an{" "}
        <span className="font-medium">AG-UI run</span>; the response{" "}
        <span className="font-medium">streams back</span> as AG-UI events,
        ending with a fresh A2UI batch that re-renders the counter. Each row
        says <em>why</em> it fired; click it to expand the raw JSON.
      </p>
      {/* Two-protocol legend — the interaction is the whole point. */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1 rounded border p-2">
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${PROTOCOL_META["A2UI"].cls}`}
          >
            A2UI
          </span>
          <p className="text-[11px] text-muted-foreground">
            The declarative <strong>surface</strong> — what to render. The seed,
            your click (a client action), and the re-emitted batch are all A2UI.
          </p>
        </div>
        <div className="space-y-1 rounded border p-2">
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${PROTOCOL_META["AG-UI"].cls}`}
          >
            AG-UI
          </span>
          <p className="text-[11px] text-muted-foreground">
            The agent <strong>event stream</strong> — how the agent talks back
            (RUN_*, TOOL_CALL_*). The new A2UI surface rides <em>inside</em> one
            of these events, so <strong>A2UI runs on AG-UI</strong>.
          </p>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          Nothing yet — click the button above to fire an action and watch the
          round trip.
        </p>
      ) : (
        <ol className="space-y-2 rounded border bg-muted/30 p-3 font-mono text-xs">
          {entries.map((entry) => {
            const meta = KIND_META[entry.kind];
            const protocol = protocolFor(entry.kind, entry.label);
            const protoMeta = PROTOCOL_META[protocol];
            return (
              <li
                key={entry.id}
                data-testid="a2ui-wire-entry"
                data-wire-kind={entry.kind}
                data-wire-protocol={protocol}
                className="border-l-2 border-primary pl-2"
              >
                <details>
                  <summary className="cursor-pointer list-none">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}
                        title={meta.title}
                      >
                        {meta.arrow} {meta.chip}
                      </span>
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${protoMeta.cls}`}
                        title={protoMeta.title}
                      >
                        {protocol}
                      </span>
                      <span className="min-w-0 break-words">
                        <span className="text-muted-foreground">
                          [{new Date(entry.ts).toLocaleTimeString()}]{" "}
                        </span>
                        <span className="text-primary">{entry.label}</span>
                      </span>
                    </span>
                    {/* Why it fired — always visible, no expand needed. */}
                    <span className="mt-0.5 block pl-1 text-[11px] font-sans not-italic text-muted-foreground">
                      {explainFrame(entry.kind, entry.label)}
                    </span>
                  </summary>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-[11px] text-foreground">
                    {JSON.stringify(entry.payload, null, 2)}
                  </pre>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * One-shot effect: when the surface registry first mounts, seed the
 * Pattern 1 surface so the fixture page is visually complete on first
 * paint, and log each seeded A2UI message to the wire log. The registry
 * `appendMessages` is idempotent (consumedToolCallIds guard) so React 19
 * Strict Mode double-effects are absorbed; the log side is guarded by a
 * ref so the seed frames aren't duplicated.
 */
function Pattern1Seeder({
  onSeed,
}: {
  onSeed: (label: string, payload: unknown) => void;
}) {
  const registry = useSurfaceRegistry();
  const loggedRef = useRef(false);
  useEffect(() => {
    registry.appendMessages(
      PATTERN1_SURFACE_ID,
      PATTERN1_SEED_MESSAGES,
      "pattern1-seed-001",
    );
    if (loggedRef.current) return;
    loggedRef.current = true;
    for (const message of PATTERN1_SEED_MESSAGES) {
      onSeed(labelA2uiMessage(message), message);
    }
  }, [registry, onSeed]);
  return null;
}

function Pattern1Section({ onWire }: { onWire: (event: WireEvent) => void }) {
  // Local state so manual page-driven smoke tests can see whether the
  // backend is reachable — the `useActionDrivenAgent` hook resolves
  // cleanly on 4xx, so without surfacing something the click looks like
  // a no-op.
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    // Reset hint when surface re-renders so the next click can update it.
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 4000);
    return () => clearTimeout(t);
  }, [hint]);

  // Pre-create the ADK session so the click-driven surface-action-run has a
  // session to write to + run against. The chat path bootstraps automatically
  // (ChatShell); a fixture that fires actions without ever chatting must do it
  // explicitly, else the first click 404s ("Session not found"). Idempotent.
  useEffect(() => {
    void fetchWithAuth(
      `/api/proxy/api/sessions/${PATTERN1_SESSION_ID}/bootstrap`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill_id: PATTERN1_SKILL_ID }),
      },
    ).catch(() => {});
  }, []);

  return (
    <section className="space-y-3" data-testid="pattern1-section">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Pattern 1 — Click-Driven AI UI</h2>
        <p className="text-sm text-muted-foreground">
          An A2UI surface that fires an AG-UI agent turn on click — no chat
          composer. Watch the wire log below to see the A2UI action go out and
          the AG-UI events (and a new A2UI surface) stream back.
        </p>
      </header>
      <div className="rounded border p-3">
        <A2UISurfaceMount
          surfaceId={PATTERN1_SURFACE_ID}
          skillId={PATTERN1_SKILL_ID}
          sessionId={PATTERN1_SESSION_ID}
          triggerOnAction={true}
          onWire={onWire}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Action body POSTs to{" "}
        <code>
          /api/skills/{PATTERN1_SKILL_ID}/sessions/{PATTERN1_SESSION_ID}
          /surface-action-run
        </code>
        . The agent re-emits an updated A2UI surface; no chat bubble
        appears.
      </p>
      {hint && (
        <p
          className="text-xs text-amber-700"
          role="status"
          data-testid="pattern1-hint"
        >
          {hint}
        </p>
      )}
    </section>
  );
}

export default function A2uiDevPage() {
  const [wire, setWire] = useState<WireLogEntry[]>([]);
  const nextIdRef = useRef(0);

  const pushWire = useCallback(
    (kind: WireKind, label: string, payload: unknown) => {
      setWire((prev) => [
        ...prev,
        { id: nextIdRef.current++, ts: Date.now(), kind, label, payload },
      ]);
    },
    [],
  );

  // Seeder logs the hand-fed A2UI messages; the surface mount's onWire tap
  // maps each sent/received frame straight onto the same log.
  const onSeed = useCallback(
    (label: string, payload: unknown) => pushWire("seed", label, payload),
    [pushWire],
  );
  const onWire = useCallback(
    (event: WireEvent) => pushWire(event.dir, event.label, event.payload),
    [pushWire],
  );
  const clearWire = useCallback(() => setWire([]), []);

  return (
    <SurfaceRegistryProvider>
      <main className="mx-auto max-w-3xl space-y-8 p-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">
            A2UI × AG-UI playground
          </h1>
          <p className="text-sm text-muted-foreground">
            A hand-seeded A2UI surface plus the live AG-UI event stream it
            drives — a two-protocol demo. Interact with the surface and read the
            wire log to see A2UI (the surface) and AG-UI (the agent&apos;s
            events) work together, no chat and no backend spelunking required.
          </p>
        </header>
        <Pattern1Seeder onSeed={onSeed} />
        <Pattern1Section onWire={onWire} />
        <WireLog entries={wire} onClear={clearWire} />
      </main>
    </SurfaceRegistryProvider>
  );
}
