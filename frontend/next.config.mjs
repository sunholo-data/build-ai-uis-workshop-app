/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // StrictMode double-invokes mount/effects in dev. @mcp-ui/client's AppFrame
  // isn't strict-safe: the double-mount races its one-shot `sandbox-proxy-ready`
  // handshake, producing "Timed out waiting for sandbox proxy iframe to be
  // ready" and leaving the MCP-App iframe stuck at its 600px default (the
  // size-auto-resize handler only attaches after proxy-ready). Disabling it
  // makes dev behave like prod (single mount) — prod never double-invokes, so
  // this is a dev-tooling tradeoff, not a behaviour change for shipped code.
  reactStrictMode: false,
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
  },
  serverRuntimeConfig: {
    MAILGUN_WEBHOOK_SECRET: process.env.MAILGUN_WEBHOOK_SECRET,
  },
  // G45 / Sprint A2A-INVOKE — Friction 25: Next.js's catch-all 404s every
  // `/a2a/*` request before FastAPI ever sees it. Forward them to the
  // backend sidecar so peers can POST JSON-RPC to the A2A invocation
  // surface mounted at /a2a (see backend/protocols/a2a_invocation.py).
  async rewrites() {
    const backend = process.env.BACKEND_URL || 'http://127.0.0.1:1956'
    return [
      { source: '/a2a',        destination: `${backend}/a2a/` },
      { source: '/a2a/:path*', destination: `${backend}/a2a/:path*` },
    ]
  },
}

export default nextConfig
