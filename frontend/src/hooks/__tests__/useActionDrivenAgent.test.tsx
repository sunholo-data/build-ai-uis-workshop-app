// ACTION-TRIGGER M2 — useActionDrivenAgent tests
//
// The hook's job: POST to surface-action-run, parse SSE, dispatch A2UI
// tool-call results into SurfaceRegistry, resolve on RUN_FINISHED,
// reject on RUN_ERROR, graceful no-throw on HTTP 4xx.
//
// We mock fetchWithAuth so we control the SSE stream chunk-by-chunk,
// and mock useSurfaceRegistry so we can spy on appendMessages /
// readA2uiSurfaceState. The real registry is covered by its own tests.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const fetchWithAuth = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: (...args: unknown[]) =>
    fetchWithAuth(...(args as [RequestInfo | URL, RequestInit?])),
}));

const appendMessagesSpy = vi.fn();
const readA2uiSurfaceStateStub = vi.fn();

vi.mock("@/providers/SurfaceRegistry", async () => {
  const actual =
    await vi.importActual<typeof import("@/providers/SurfaceRegistry")>(
      "@/providers/SurfaceRegistry",
    );
  return {
    ...actual,
    useSurfaceRegistry: () => ({
      register: vi.fn(),
      unregister: vi.fn(),
      getMount: vi.fn(),
      getPolicy: vi.fn(),
      appendMessages: appendMessagesSpy,
      readA2uiSurfaceState: readA2uiSurfaceStateStub,
      clearSurface: vi.fn(),
      clearByPersistence: vi.fn(),
      getState: vi.fn(),
    }),
  };
});

// Mock AGUIProvider so the regression test below can spy on HttpAgent
// construction without instantiating a real one.
const httpAgentCtor = vi.fn();
vi.mock("@ag-ui/client", async () => {
  const actual = await vi.importActual<typeof import("@ag-ui/client")>(
    "@ag-ui/client",
  );
  class SpiedHttpAgent extends actual.HttpAgent {
    constructor(cfg: ConstructorParameters<typeof actual.HttpAgent>[0]) {
      super(cfg);
      httpAgentCtor(cfg);
    }
  }
  return { ...actual, HttpAgent: SpiedHttpAgent };
});

vi.mock("@/lib/firebase", () => ({
  subscribeToIdToken: (cb: (t: string | null) => void) => {
    queueMicrotask(() => cb("test-token"));
    return () => {};
  },
  getIdToken: async () => "test-token",
  signInWithGoogle: async () => {},
  signOut: async () => {},
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import { useActionDrivenAgent } from "@/hooks/useActionDrivenAgent";
import { AGUIProvider, useAGUIAgent } from "@/providers/AGUIProvider";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a `Response` whose `body` is a ReadableStream yielding `chunks`
 * as `text/event-stream` frames. Each chunk is a complete `data: ...\n\n`
 * SSE frame (string) — passed through verbatim.
 */
function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

/** Encode an AG-UI event JSON object as one SSE frame. */
function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ─── beforeEach ─────────────────────────────────────────────────────────────

beforeEach(() => {
  fetchWithAuth.mockReset();
  appendMessagesSpy.mockReset();
  readA2uiSurfaceStateStub.mockReset();
  readA2uiSurfaceStateStub.mockReturnValue({});
  httpAgentCtor.mockReset();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useActionDrivenAgent", () => {
  it("POSTs to the correct URL with {surfaceId, action, forwardedProps.a2ui_surface_state} payload", async () => {
    const snapshot = {
      workspace: { catalogId: "basic", dataModel: { counter: 0 } },
    };
    readA2uiSurfaceStateStub.mockReturnValue(snapshot);
    fetchWithAuth.mockResolvedValueOnce(
      sseResponse([
        frame({ type: "RUN_STARTED", threadId: "s-1", runId: "r-1" }),
        frame({ type: "RUN_FINISHED", threadId: "s-1", runId: "r-1" }),
      ]),
    );

    const { result } = renderHook(() =>
      useActionDrivenAgent({ skillId: "skill-x", sessionId: "sess-1" }),
    );

    await result.current.triggerAction("workspace", {
      name: "increment",
      sourceComponentId: "btn-1",
      context: { foo: "bar" },
    });

    expect(fetchWithAuth).toHaveBeenCalledOnce();
    const [url, init] = fetchWithAuth.mock.calls[0];
    expect(url).toBe(
      "/api/proxy/api/skills/skill-x/sessions/sess-1/surface-action-run",
    );
    expect(init?.method).toBe("POST");
    expect(
      (init?.headers as Record<string, string>)["Content-Type"],
    ).toBe("application/json");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      surfaceId: "workspace",
      action: {
        name: "increment",
        sourceComponentId: "btn-1",
        context: { foo: "bar" },
      },
      forwardedProps: { a2ui_surface_state: snapshot },
    });
  });

  it("URL-encodes skillId and sessionId so weird ids don't break routing", async () => {
    fetchWithAuth.mockResolvedValueOnce(
      sseResponse([frame({ type: "RUN_FINISHED" })]),
    );

    const { result } = renderHook(() =>
      useActionDrivenAgent({
        skillId: "weird/skill id",
        sessionId: "sess with space",
      }),
    );
    await result.current.triggerAction("workspace", { name: "click" });

    const [url] = fetchWithAuth.mock.calls[0];
    expect(url).toBe(
      "/api/proxy/api/skills/weird%2Fskill%20id/sessions/sess%20with%20space/surface-action-run",
    );
  });

  it("happy path: parses SSE, dispatches send_a2ui_json_to_client tool-call results into SurfaceRegistry, resolves on RUN_FINISHED", async () => {
    const a2uiMessages = [
      {
        version: "v0.9",
        createSurface: { surfaceId: "workspace", catalogId: "basic" },
      },
      {
        version: "v0.9",
        updateComponents: { surfaceId: "workspace", components: [] },
      },
    ];
    const envelope = JSON.stringify({
      validated_a2ui_json: a2uiMessages,
      surface_id: "workspace",
    });

    fetchWithAuth.mockResolvedValueOnce(
      sseResponse([
        frame({ type: "RUN_STARTED", threadId: "s", runId: "r" }),
        frame({
          type: "TOOL_CALL_START",
          toolCallId: "tc-1",
          toolCallName: "send_a2ui_json_to_client",
        }),
        frame({ type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: "{}" }),
        frame({ type: "TOOL_CALL_END", toolCallId: "tc-1" }),
        frame({
          type: "TOOL_CALL_RESULT",
          messageId: "m-1",
          toolCallId: "tc-1",
          content: envelope,
        }),
        frame({ type: "RUN_FINISHED", threadId: "s", runId: "r" }),
      ]),
    );

    const { result } = renderHook(() =>
      useActionDrivenAgent({ skillId: "skill-x", sessionId: "sess-1" }),
    );

    await expect(
      result.current.triggerAction("workspace", { name: "increment" }),
    ).resolves.toBeUndefined();

    expect(appendMessagesSpy).toHaveBeenCalledOnce();
    expect(appendMessagesSpy).toHaveBeenCalledWith(
      "workspace",
      a2uiMessages,
      "tc-1",
    );
  });

  it("skips non-A2UI tool call results — only send_a2ui_json_to_client dispatches into the registry", async () => {
    fetchWithAuth.mockResolvedValueOnce(
      sseResponse([
        frame({
          type: "TOOL_CALL_START",
          toolCallId: "tc-search",
          toolCallName: "search_documents",
        }),
        frame({
          type: "TOOL_CALL_RESULT",
          messageId: "m-1",
          toolCallId: "tc-search",
          content: JSON.stringify({ hits: [] }),
        }),
        frame({ type: "RUN_FINISHED" }),
      ]),
    );

    const { result } = renderHook(() =>
      useActionDrivenAgent({ skillId: "skill-x", sessionId: "sess-1" }),
    );
    await result.current.triggerAction("workspace", { name: "click" });
    expect(appendMessagesSpy).not.toHaveBeenCalled();
  });

  it("graceful 403 fallback: skill not opted into action-triggered runs → console.warn, no throw, surface untouched", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "not opted in" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { result } = renderHook(() =>
      useActionDrivenAgent({ skillId: "skill-x", sessionId: "sess-1" }),
    );

    await expect(
      result.current.triggerAction("workspace", { name: "click" }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    expect(appendMessagesSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("rejects on RUN_ERROR with the server-provided message", async () => {
    fetchWithAuth.mockResolvedValueOnce(
      sseResponse([
        frame({ type: "RUN_STARTED" }),
        frame({ type: "RUN_ERROR", message: "tool blew up" }),
      ]),
    );

    const { result } = renderHook(() =>
      useActionDrivenAgent({ skillId: "skill-x", sessionId: "sess-1" }),
    );

    await expect(
      result.current.triggerAction("workspace", { name: "click" }),
    ).rejects.toThrow(/tool blew up/);
  });

  it("G41 dedup: RUN_ERROR followed by RUN_FINISHED still rejects exactly once and does not double-resolve", async () => {
    // Server's G41 dedup wrapper should never emit both, but the hook
    // must defend against the variant where a duplicate slips through —
    // first terminal wins, second is ignored.
    fetchWithAuth.mockResolvedValueOnce(
      sseResponse([
        frame({ type: "RUN_STARTED" }),
        frame({ type: "RUN_ERROR", message: "first" }),
        frame({ type: "RUN_FINISHED" }),
      ]),
    );

    const { result } = renderHook(() =>
      useActionDrivenAgent({ skillId: "skill-x", sessionId: "sess-1" }),
    );

    await expect(
      result.current.triggerAction("workspace", { name: "click" }),
    ).rejects.toThrow(/first/);
  });

  it("G41 dedup: RUN_FINISHED followed by RUN_ERROR resolves cleanly (first terminal wins)", async () => {
    fetchWithAuth.mockResolvedValueOnce(
      sseResponse([
        frame({ type: "RUN_STARTED" }),
        frame({ type: "RUN_FINISHED" }),
        frame({ type: "RUN_ERROR", message: "should be ignored" }),
      ]),
    );

    const { result } = renderHook(() =>
      useActionDrivenAgent({ skillId: "skill-x", sessionId: "sess-1" }),
    );

    await expect(
      result.current.triggerAction("workspace", { name: "click" }),
    ).resolves.toBeUndefined();
  });

  it("network error → console.warn, resolves cleanly (surface stays put)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchWithAuth.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const { result } = renderHook(() =>
      useActionDrivenAgent({ skillId: "skill-x", sessionId: "sess-1" }),
    );

    await expect(
      result.current.triggerAction("workspace", { name: "click" }),
    ).resolves.toBeUndefined();
    expect(appendMessagesSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("omits a2ui_surface_state-fallback: empty snapshot still serializes (forwardedProps.a2ui_surface_state = {})", async () => {
    readA2uiSurfaceStateStub.mockReturnValue({});
    fetchWithAuth.mockResolvedValueOnce(
      sseResponse([frame({ type: "RUN_FINISHED" })]),
    );

    const { result } = renderHook(() =>
      useActionDrivenAgent({ skillId: "skill-x", sessionId: "sess-1" }),
    );
    await result.current.triggerAction("workspace", { name: "click" });

    const body = JSON.parse(fetchWithAuth.mock.calls[0][1].body);
    expect(body.forwardedProps).toEqual({ a2ui_surface_state: {} });
  });

  it("handles SSE frames split across read() chunks (buffer reassembly)", async () => {
    // Simulate a server flushing a frame in two write() calls. The
    // reader's `\n\n` split must reassemble across the chunk boundary.
    const part1 = `data: ${JSON.stringify({ type: "RUN_STARTED" })}\n`;
    const part2 = `\ndata: ${JSON.stringify({ type: "RUN_FINISHED" })}\n\n`;

    fetchWithAuth.mockResolvedValueOnce(sseResponse([part1, part2]));

    const { result } = renderHook(() =>
      useActionDrivenAgent({ skillId: "skill-x", sessionId: "sess-1" }),
    );
    await expect(
      result.current.triggerAction("workspace", { name: "click" }),
    ).resolves.toBeUndefined();
  });
});

// ─── M2.3 regression — HttpAgent stability across action-triggered runs ──

describe("useActionDrivenAgent — D1-style regression (chat-history-deep-fixes H1)", () => {
  it("does NOT rebuild the AGUIProvider's HttpAgent when an action-triggered run completes (same session_id throughout)", async () => {
    // Pattern mirrors providers/__tests__/AGUIProvider.test.tsx:111
    // ("rebuilds the HttpAgent when sessionId changes from undefined to a
    // server-assigned value"). The contract here is the inverse: if the
    // sessionId stays the same across a `triggerAction()` call, no new
    // HttpAgent is constructed — the action-triggered run shares the
    // same backing session and must NOT cause the chat path's agent to
    // be torn down (which would discard in-flight chat state).
    fetchWithAuth.mockResolvedValueOnce(
      sseResponse([
        frame({ type: "RUN_STARTED" }),
        frame({ type: "RUN_FINISHED" }),
      ]),
    );

    function Harness() {
      // Capture the agent so we know the AGUIProvider mounted. The agent
      // identity itself isn't load-bearing for this test — we just need
      // a real provider in the tree to count HttpAgent constructions.
      useAGUIAgent();
      return null;
    }

    const { result } = renderHook(
      () =>
        useActionDrivenAgent({
          skillId: "skill-x",
          sessionId: "sess-stable-1",
        }),
      {
        wrapper: ({ children }) => (
          <AGUIProvider skillId="skill-x" sessionId="sess-stable-1">
            <Harness />
            {children}
          </AGUIProvider>
        ),
      },
    );

    await waitFor(() => {
      expect(httpAgentCtor.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    const ctorCallsBefore = httpAgentCtor.mock.calls.length;

    await result.current.triggerAction("workspace", { name: "click" });

    // Contract: the HttpAgent is owned by AGUIProvider and is keyed by
    // (skillId, sessionId). useActionDrivenAgent does not touch the
    // AGUIProvider's HttpAgent at all — it builds its own fetch+SSE
    // pipeline. So no extra constructor call should fire.
    expect(httpAgentCtor.mock.calls.length).toBe(ctorCallsBefore);
  });
});

