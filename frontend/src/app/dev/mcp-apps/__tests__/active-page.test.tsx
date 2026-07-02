// Vitest for /dev/mcp-apps/active — exercises the synthetic-notification
// button panel + adapter integration without a real iframe. Locks the
// contract that:
//  (a) known notification shapes flow through the adapter to the log
//  (b) unknown shapes log "null (adapter ignored)" rather than crashing
//  (c) the server selector picks which MCP server the iframe connects to,
//      and connection failures surface a message (not a blank box)

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the router so the test doesn't try to mount a real <AppRenderer>
// (which needs a live iframe + sandbox proxy on a different origin).
vi.mock("@/components/protocols/MCPAppToolCallRouter", () => ({
  MCPAppToolCallRouter: () => <div data-testid="stub-router" />,
}));

// Stub the dev MCP client: connecting to a real server isn't possible in
// jsdom. `mockConnect` (name must start with "mock" for vi.mock hoisting) lets
// individual tests force a connect success/failure. Default: resolve.
const mockConnect = vi.fn(() => Promise.resolve());
vi.mock("@/lib/mcpClient", () => ({
  createDevDirectMcpClient: () => ({
    connect: () => mockConnect(),
    close: () => Promise.resolve(),
  }),
}));

import McpAppsActivePage from "../active/page";

beforeEach(() => {
  mockConnect.mockReset();
  mockConnect.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/dev/mcp-apps/active", () => {
  it("renders the synthetic-notification button panel + iframe stub + empty log", async () => {
    render(<McpAppsActivePage />);
    expect(screen.getByText(/MCP Apps active smoke/i)).toBeInTheDocument();
    // Router mounts once the (mocked) connection resolves.
    expect(await screen.findByTestId("stub-router")).toBeInTheDocument();
    expect(screen.getByText(/fire: location-selected \(Munich\)/i)).toBeInTheDocument();
    expect(screen.getByText(/No messages yet/i)).toBeInTheDocument();
  });

  it("renders the server selector with both options; local map-server selected by default", async () => {
    render(<McpAppsActivePage />);
    const local = screen.getByRole("radio", { name: /Local demo widget/i });
    const aipla = screen.getByRole("radio", { name: /Live AIPLA sims/i });
    expect(local).toBeChecked();
    expect(aipla).not.toBeChecked();
    // Let the (mocked) connection settle inside act so no stray state update
    // lands after the test body.
    await screen.findByTestId("stub-router");
  });

  it("selecting the AIPLA server switches the active selection", async () => {
    render(<McpAppsActivePage />);
    const aipla = screen.getByRole("radio", { name: /Live AIPLA sims/i });
    fireEvent.click(aipla);
    expect(aipla).toBeChecked();
    expect(screen.getByRole("radio", { name: /Local demo widget/i })).not.toBeChecked();
    // Flush the reconnect triggered by switching servers.
    await screen.findByTestId("stub-router");
  });

  it("shows a connection message (not a blank box) when the server connect fails", async () => {
    mockConnect.mockReset();
    mockConnect.mockRejectedValue(new Error("CORS blocked"));
    render(<McpAppsActivePage />);
    expect(await screen.findByText(/Could not connect to/i)).toBeInTheDocument();
    expect(screen.getByText(/CORS blocked/i)).toBeInTheDocument();
    // No iframe mounted on a failed connection.
    expect(screen.queryByTestId("stub-router")).not.toBeInTheDocument();
  });

  it("sniffs a ui/update-model-context notification off the sandbox wire and logs it (the boldkast channel)", async () => {
    render(<McpAppsActivePage />);
    await screen.findByTestId("stub-router");

    // Simulate what the sandbox relays to the host window when boldkast pushes
    // a slider change: a JSON-RPC *notification* (no id) from the sandbox origin.
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:3457",
          data: {
            jsonrpc: "2.0",
            method: "ui/update-model-context",
            params: { structuredContent: { marker: "v0", value: 42 } },
          },
        }),
      );
    });

    expect(screen.getByText(/"marker":"v0"/)).toBeInTheDocument();
  });

  it("ignores request-shaped wire frames (has id) — those are handled by the router callbacks, not the sniffer", async () => {
    render(<McpAppsActivePage />);
    await screen.findByTestId("stub-router");

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:3457",
          data: {
            jsonrpc: "2.0",
            id: 7,
            method: "ui/update-model-context",
            params: { structuredContent: { marker: "should-not-log" } },
          },
        }),
      );
    });

    expect(screen.queryByText(/should-not-log/)).not.toBeInTheDocument();
    expect(screen.getByText(/No messages yet/i)).toBeInTheDocument();
  });

  it("location-selected button → adapter translates → 'Tell me more about Munich' in log", async () => {
    render(<McpAppsActivePage />);
    await screen.findByTestId("stub-router");
    fireEvent.click(screen.getByText(/fire: location-selected \(Munich\)/i));
    // Scope to the log list — the legend also shows "Tell me more about Munich"
    // as its worked example, so a bare getByText would match two nodes.
    const logList = screen.getByRole("list");
    expect(
      within(logList).getByText(/Tell me more about Munich/i),
    ).toBeInTheDocument();
  });

  it("route-selected button → adapter translates the from/to pair", async () => {
    render(<McpAppsActivePage />);
    await screen.findByTestId("stub-router");
    fireEvent.click(screen.getByText(/fire: route-selected/i));
    expect(
      screen.getByText(/Tell me about the route from Munich to Paris/i),
    ).toBeInTheDocument();
  });

  it("unknown-shape button → adapter returns null → log shows 'null (adapter ignored)'", async () => {
    render(<McpAppsActivePage />);
    await screen.findByTestId("stub-router");
    fireEvent.click(screen.getByText(/fire: unknown-shape/i));
    expect(screen.getByText(/null \(adapter ignored\)/i)).toBeInTheDocument();
  });

  it("malformed payload button → adapter returns null without throwing", async () => {
    render(<McpAppsActivePage />);
    await screen.findByTestId("stub-router");
    // Should not throw. Asserting via getByText also implicitly asserts no
    // unhandled error tore down the tree.
    fireEvent.click(screen.getByText(/fire: malformed/i));
    expect(screen.getByText(/null \(adapter ignored\)/i)).toBeInTheDocument();
  });

  it("clear log button empties the log", async () => {
    render(<McpAppsActivePage />);
    await screen.findByTestId("stub-router");
    fireEvent.click(screen.getByText(/fire: location-selected \(Munich\)/i));
    expect(screen.queryByText(/No messages yet/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/clear log/i));
    expect(screen.getByText(/No messages yet/i)).toBeInTheDocument();
  });
});
