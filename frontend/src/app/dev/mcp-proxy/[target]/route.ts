// /dev/mcp-proxy/[target] — dev-only, same-origin proxy to a remote MCP server.
//
// Why this exists: a browser MCP client (StreamableHTTP transport) can't talk
// directly to a remote MCP endpoint that doesn't send CORS headers. The live
// AIPLA sims server (…/api/mcp) answers the CORS preflight with `405` and no
// `Access-Control-*` headers, so a direct fetch from http://localhost:3456 is
// blocked by the browser — even though the *same* server works fine in ChatGPT
// (that's a server-side connector; no browser, no CORS). See the CORS note in
// slides/outline.md and protocol-gotchas #16/#17.
//
// This route forwards MCP JSON-RPC traffic SERVER-SIDE (no CORS in play) to a
// tight ALLOWLIST of known upstreams, streaming SSE responses through
// untouched (same passthrough trick as api/proxy/[...path]). It is
// deliberately NOT a general open proxy: `target` must match a key in
// UPSTREAMS below, so it can only ever reach the hardcoded demo endpoints.
//
// Consumed by /dev/mcp-apps/active's server selector. Production chat does NOT
// use this — that path goes through /api/proxy/mcp/{server_id} to the backend.

import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Allowlist: target key → upstream MCP URL. Adding an entry is the ONLY way to
// make a new upstream reachable through this proxy (keeps it from becoming an
// SSRF-shaped open relay).
const UPSTREAMS: Record<string, string> = {
  // Live AIPLA physics sims — show_boldkast / show_kinebot / show_led_planck,
  // each with a ui:// resource. Same no-auth URL as the ChatGPT connector demo.
  aipla: "https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app/api/mcp",
};

// Forward only the headers MCP's Streamable HTTP transport actually needs.
// An allowlist (not a blocklist) so we never leak the browser's Origin /
// Referer / Cookie to the upstream.
const FORWARDED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];

// Statuses that MUST be constructed with a null body (per the Fetch spec) —
// the Response constructor throws otherwise.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

// Response headers safe/useful to echo back to the same-origin client.
const FORWARDED_RESPONSE_HEADERS = ["content-type", "mcp-session-id"];

function pickRequestHeaders(headers: Headers): Headers {
  const out = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

function pickResponseHeaders(headers: Headers): Headers {
  const out = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ target: string }> },
): Promise<NextResponse> {
  const { target } = await ctx.params;
  const upstream = UPSTREAMS[target];
  if (!upstream) {
    return NextResponse.json(
      {
        error: "unknown_upstream",
        message: `No MCP upstream registered for target "${target}". Known: ${Object.keys(UPSTREAMS).join(", ")}`,
      },
      { status: 404 },
    );
  }

  // Preserve any query string the transport appended.
  const url = `${upstream}${req.nextUrl.search}`;

  const init: RequestInit = {
    method: req.method,
    headers: pickRequestHeaders(req.headers),
    cache: "no-store",
    // Required when forwarding a streaming body in Node's fetch.
    // @ts-expect-error — `duplex` is valid on Node's fetch but not the DOM lib types.
    duplex: "half",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
  }

  try {
    const res = await fetch(url, init);
    const contentType = res.headers.get("content-type") ?? "";
    // SSE passthrough — stream the body directly; buffering it would collapse
    // the event stream into one delayed response and hang the MCP handshake.
    if (contentType.includes("text/event-stream")) {
      return new NextResponse(res.body, {
        status: res.status,
        headers: pickResponseHeaders(res.headers),
      });
    }
    if (NULL_BODY_STATUSES.has(res.status)) {
      return new NextResponse(null, {
        status: res.status,
        headers: pickResponseHeaders(res.headers),
      });
    }
    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      status: res.status,
      headers: pickResponseHeaders(res.headers),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "upstream_unreachable", message: String(err) },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
