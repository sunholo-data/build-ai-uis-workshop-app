// /dev — index of the dev playgrounds.
//
// A demo-day launchpad: every /dev/* surface in one place so you can jump
// straight to the right playground mid-workshop instead of remembering the
// exact path. Grouped by what they show — the protocol playgrounds (the live
// demo surfaces for AG-UI / A2UI / MCP Apps) and the component fixtures
// (hard-coded data, no backend). Sister to /dev/mcp-apps (its own sub-index).
//
// The /dev/mcp-proxy/[target] route is intentionally not listed — it's the
// same-origin sandbox proxy API the MCP Apps pages call, not a page you open.

import Link from "next/link";

export const metadata = {
  title: "Aitana dev — playground index",
};

interface DevRoute {
  href: string;
  title: string;
  blurb: string;
  needs?: string;
}

const PLAYGROUNDS: DevRoute[] = [
  {
    href: "/dev/a2ui",
    title: "A2UI × AG-UI playground",
    blurb:
      "Pattern 1, click-driven: a click on an A2UI surface starts an AG-UI run and the reply re-renders the surface. Wire log tags every frame A2UI vs AG-UI with a plain-English 'why this fires' line.",
    needs: "backend for the live run; seeds render offline",
  },
  {
    href: "/dev/mcp-apps",
    title: "MCP Apps — smoke routes",
    blurb:
      "Sub-index for the MCPAppToolCallRouter + AppRenderer + separate-origin sandbox proxy. Splits into passive (fixture render only) and active (full iframe → host bridge with synthetic-notification buttons).",
    needs: "sandbox proxy on :3457; map-server on :3001 for live widgets",
  },
];

const FIXTURES: DevRoute[] = [
  {
    href: "/dev/rich-media",
    title: "Rich media rendering",
    blurb:
      "All three chat-render paths on hard-coded messages: fenced ```svg → sanitized SVGBlock, ![alt](url) → InlineImage (lazy + lightbox), and [text](*.pdf) → PDFCard.",
    needs: "nothing — fixtures are bundled",
  },
  {
    href: "/dev/file-browser",
    title: "File browser components",
    blurb:
      "The doc-browser pieces on dummy data: folder accordion with mixed parse-status docs + search, open-tabs bar, upload drop zone, and parse-progress bars.",
    needs: "nothing — no backend, no Firestore",
  },
];

function RouteList({ routes }: { routes: DevRoute[] }) {
  return (
    <ul className="space-y-3">
      {routes.map((r) => (
        <li key={r.href} className="rounded border p-4">
          <Link
            className="font-mono text-sm font-medium text-primary underline"
            href={r.href}
          >
            {r.href}
          </Link>
          <p className="mt-1 text-sm font-medium text-foreground">{r.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{r.blurb}</p>
          {r.needs && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">Needs:</span> {r.needs}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function DevIndex() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Dev playgrounds</h1>
        <p className="text-sm text-muted-foreground">
          Standalone surfaces for building and demoing the protocol stack
          without the full chat → backend roundtrip. Each renders in isolation
          with its own fixtures or a live server selector.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Protocol playgrounds</h2>
        <p className="text-sm text-muted-foreground">
          The live demo surfaces — AG-UI, A2UI, and MCP Apps interacting on the
          wire.
        </p>
        <RouteList routes={PLAYGROUNDS} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Component fixtures</h2>
        <p className="text-sm text-muted-foreground">
          Individual UI components on hard-coded data — no backend needed.
        </p>
        <RouteList routes={FIXTURES} />
      </section>
    </main>
  );
}
