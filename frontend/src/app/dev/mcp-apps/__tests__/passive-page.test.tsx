// Vitest for /dev/mcp-apps/passive — the fixture-driven render harness.
// Locks that it (a) offers the server selector, (b) mounts the router once the
// (mocked) connection succeeds, and (c) surfaces a connection message instead
// of a silent blank box when the connect fails.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the router so we don't mount a real <AppRenderer> (needs a live iframe
// + sandbox proxy on another origin).
vi.mock("@/components/protocols/MCPAppToolCallRouter", () => ({
  MCPAppToolCallRouter: () => <div data-testid="stub-router" />,
}));

// Stub the dev MCP client — real connects aren't possible in jsdom.
const mockConnect = vi.fn(() => Promise.resolve());
vi.mock("@/lib/mcpClient", () => ({
  createDevDirectMcpClient: () => ({
    connect: () => mockConnect(),
    close: () => Promise.resolve(),
  }),
}));

import McpAppsPassivePage from "../passive/page";

beforeEach(() => {
  mockConnect.mockReset();
  mockConnect.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/dev/mcp-apps/passive", () => {
  it("renders the heading + server selector; mounts the router once connected", async () => {
    render(<McpAppsPassivePage />);
    expect(screen.getByText(/MCP Apps passive smoke/i)).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Local demo widget/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Live AIPLA sims/i }),
    ).not.toBeChecked();
    expect(await screen.findByTestId("stub-router")).toBeInTheDocument();
  });

  it("selecting AIPLA switches the active selection", async () => {
    render(<McpAppsPassivePage />);
    const aipla = screen.getByRole("radio", { name: /Live AIPLA sims/i });
    fireEvent.click(aipla);
    expect(aipla).toBeChecked();
    await screen.findByTestId("stub-router");
  });

  it("shows a connection message (not a blank box) when the connect fails", async () => {
    mockConnect.mockReset();
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
    render(<McpAppsPassivePage />);
    expect(await screen.findByText(/Could not connect to/i)).toBeInTheDocument();
    // The run-hint is shown so the user knows how to start the server.
    expect(screen.getByText(/mcp-local-demo\.log/i)).toBeInTheDocument();
    expect(screen.queryByTestId("stub-router")).not.toBeInTheDocument();
  });
});
