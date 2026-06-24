// M2 — A2UISurfaceMount tests
// The mount is the *layout primitive* that declares a named surface in the
// React tree. It binds its inner div ref into the SurfaceRegistry on mount
// and unregisters on unmount.
//
// ACTION-TRIGGER M2 (sprint 1.21) added two trailing test groups:
//   - `triggerOnAction={false}` (default): existing surface-action POST path
//   - `triggerOnAction={true}`: routes through useActionDrivenAgent instead

import { act, render, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A2UISurfaceMount } from "@/components/protocols/A2UISurfaceMount";
import {
  SurfaceRegistryProvider,
  useSurfaceRegistry,
} from "@/providers/SurfaceRegistry";

function wrap(children: ReactNode) {
  return <SurfaceRegistryProvider>{children}</SurfaceRegistryProvider>;
}

describe("A2UISurfaceMount", () => {
  it("renders a div with data-surface attribute", () => {
    const { container } = render(
      wrap(<A2UISurfaceMount surfaceId="workspace" />),
    );
    const el = container.querySelector('[data-surface="workspace"]');
    expect(el).toBeTruthy();
    expect(el?.tagName).toBe("DIV");
  });

  it("forwards className to the underlying div", () => {
    const { container } = render(
      wrap(
        <A2UISurfaceMount surfaceId="workspace" className="w-1/2 bg-muted" />,
      ),
    );
    const el = container.querySelector('[data-surface="workspace"]');
    expect(el?.className).toBe("w-1/2 bg-muted");
  });

  it("registers itself with the SurfaceRegistry on mount; unregisters on unmount", () => {
    let registryHandle: ReturnType<typeof useSurfaceRegistry> | null = null;
    function Capture() {
      registryHandle = useSurfaceRegistry();
      return null;
    }

    const { unmount } = render(
      wrap(
        <>
          <Capture />
          <A2UISurfaceMount surfaceId="workspace" />
        </>,
      ),
    );

    // useLayoutEffect runs synchronously before paint — by the time render()
    // returns the registration is in place.
    expect(registryHandle).not.toBeNull();
    const mountRef = registryHandle!.getMount("workspace");
    expect(mountRef).not.toBeNull();
    expect(mountRef?.current).toBeInstanceOf(HTMLDivElement);
    expect(mountRef?.current?.getAttribute("data-surface")).toBe("workspace");

    unmount();
    // Unmount path runs the registry.unregister cleanup; can't query the
    // captured handle (provider gone), but render output is gone too.
  });

  it("returns null from getMount after the mount unmounts", () => {
    let registryHandle: ReturnType<typeof useSurfaceRegistry> | null = null;
    function Capture() {
      registryHandle = useSurfaceRegistry();
      return null;
    }

    // Render with a parent provider so the registry survives the child unmount
    const { rerender } = render(
      wrap(
        <>
          <Capture />
          <A2UISurfaceMount surfaceId="workspace" />
        </>,
      ),
    );

    expect(registryHandle!.getMount("workspace")).not.toBeNull();

    rerender(
      wrap(
        <>
          <Capture />
          {/* A2UISurfaceMount removed */}
        </>,
      ),
    );

    expect(registryHandle!.getMount("workspace")).toBeNull();
  });

  it("propagates a policy override to the registry (e.g., persistence=indefinite)", () => {
    let registryHandle: ReturnType<typeof useSurfaceRegistry> | null = null;
    function Capture() {
      registryHandle = useSurfaceRegistry();
      return null;
    }
    render(
      wrap(
        <>
          <Capture />
          <A2UISurfaceMount
            surfaceId="sidebar"
            policy={{ persistence: "indefinite" }}
          />
        </>,
      ),
    );
    expect(registryHandle!.getPolicy("sidebar").persistence).toBe("indefinite");
    // Other fields keep their defaults
    expect(registryHandle!.getPolicy("sidebar").requiresUserGesture).toBe(false);
  });

  it("logs an error and refuses if two A2UISurfaceMounts share the same surfaceId", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let registryHandle: ReturnType<typeof useSurfaceRegistry> | null = null;
    function Capture() {
      registryHandle = useSurfaceRegistry();
      return null;
    }
    render(
      wrap(
        <>
          <Capture />
          <A2UISurfaceMount surfaceId="workspace" />
          <A2UISurfaceMount surfaceId="workspace" />
        </>,
      ),
    );

    // First mount wins; second logs an error but doesn't crash
    expect(registryHandle!.getMount("workspace")).not.toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ─── ACTION-TRIGGER M2: triggerOnAction prop branches ─────────────────────

// fetchWithAuth is module-level mocked so both the default `surface-action`
// POST path and the bundled `surface-action-run` (via useActionDrivenAgent)
// can be observed with the same spy. The hook itself is unit-tested in
// `src/hooks/__tests__/useActionDrivenAgent.test.tsx`; here we only assert
// the routing decision the mount makes based on `triggerOnAction`.
const fetchWithAuthSpy = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: (...args: unknown[]) =>
    fetchWithAuthSpy(...(args as [RequestInfo | URL, RequestInit?])),
}));

const triggerActionSpy = vi.fn();
vi.mock("@/hooks/useActionDrivenAgent", () => ({
  useActionDrivenAgent: () => ({ triggerAction: triggerActionSpy }),
}));

beforeEach(() => {
  fetchWithAuthSpy.mockReset();
  fetchWithAuthSpy.mockResolvedValue(
    new Response(null, { status: 204 }) as Response,
  );
  triggerActionSpy.mockReset();
  triggerActionSpy.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

// Drive a real A2UI surface into the registry so `state.surface.onAction`
// has a SurfaceModel to subscribe to. The mount's effect needs a real
// SurfaceModel — not a mock — because the SurfaceRegistry's API constructs
// it through the v0.9 MessageProcessor.
//
// `basicCatalog.id` is the upstream URL ("https://a2ui.org/.../basic_catalog.json")
// — using a different string here would trip the SDK's "Catalog not found"
// guard. We re-export the id at the top of this block to keep tests
// future-proof against version bumps.
import { basicCatalog } from "@a2ui/react/v0_9";
const BASIC_CATALOG_ID = basicCatalog.id;

function pushSurface(
  registry: ReturnType<typeof useSurfaceRegistry>,
  surfaceId: string,
) {
  registry.appendMessages(
    surfaceId,
    [
      {
        version: "v0.9",
        createSurface: { surfaceId, catalogId: BASIC_CATALOG_ID },
      },
    ],
    `tc-${surfaceId}-${Math.random()}`,
  );
}

describe("A2UISurfaceMount — triggerOnAction prop (ACTION-TRIGGER M2)", () => {
  it("default (triggerOnAction omitted): clicks POST to the plain /surface-action endpoint — current behaviour preserved", async () => {
    let registryHandle: ReturnType<typeof useSurfaceRegistry> | null = null;
    function Capture() {
      registryHandle = useSurfaceRegistry();
      return null;
    }
    render(
      wrap(
        <>
          <Capture />
          <A2UISurfaceMount surfaceId="workspace" sessionId="sess-1" />
        </>,
      ),
    );
    act(() => {
      pushSurface(registryHandle!, "workspace");
    });

    const surface = registryHandle!.getState("workspace")?.surface;
    expect(surface).toBeTruthy();

    await act(async () => {
      await surface!.dispatchAction({ event: { name: "click" } }, "btn-1");
    });

    await waitFor(() => {
      expect(fetchWithAuthSpy).toHaveBeenCalledOnce();
    });
    const [url, init] = fetchWithAuthSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/api/sessions/sess-1/surface-action");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.surfaceId).toBe("workspace");
    expect(body.action.name).toBe("click");

    // triggerAction never invoked on the default branch.
    expect(triggerActionSpy).not.toHaveBeenCalled();
  });

  it("triggerOnAction={false} explicit: same as omitted — current behaviour preserved", async () => {
    let registryHandle: ReturnType<typeof useSurfaceRegistry> | null = null;
    function Capture() {
      registryHandle = useSurfaceRegistry();
      return null;
    }
    render(
      wrap(
        <>
          <Capture />
          <A2UISurfaceMount
            surfaceId="workspace"
            sessionId="sess-1"
            triggerOnAction={false}
          />
        </>,
      ),
    );
    act(() => pushSurface(registryHandle!, "workspace"));
    const surface = registryHandle!.getState("workspace")?.surface!;
    await act(async () => {
      await surface.dispatchAction({ event: { name: "click" } }, "btn-1");
    });

    await waitFor(() => {
      expect(fetchWithAuthSpy).toHaveBeenCalledOnce();
    });
    expect(triggerActionSpy).not.toHaveBeenCalled();
  });

  it("triggerOnAction={true}: clicks route through useActionDrivenAgent.triggerAction — no direct POST to plain surface-action endpoint", async () => {
    let registryHandle: ReturnType<typeof useSurfaceRegistry> | null = null;
    function Capture() {
      registryHandle = useSurfaceRegistry();
      return null;
    }
    render(
      wrap(
        <>
          <Capture />
          <A2UISurfaceMount
            surfaceId="workspace"
            sessionId="sess-1"
            skillId="skill-x"
            triggerOnAction={true}
          />
        </>,
      ),
    );
    act(() => pushSurface(registryHandle!, "workspace"));
    const surface = registryHandle!.getState("workspace")?.surface!;
    await act(async () => {
      await surface.dispatchAction(
        { event: { name: "increment", context: { delta: 1 } } },
        "btn-1",
      );
    });

    await waitFor(() => {
      expect(triggerActionSpy).toHaveBeenCalledOnce();
    });
    const [calledSurfaceId, calledAction] = triggerActionSpy.mock.calls[0];
    expect(calledSurfaceId).toBe("workspace");
    expect(calledAction).toMatchObject({
      name: "increment",
      sourceComponentId: "btn-1",
      context: { delta: 1 },
    });

    // No plain surface-action POST when bundled endpoint is used.
    expect(fetchWithAuthSpy).not.toHaveBeenCalled();
  });

  it("triggerOnAction={true} but skillId missing: drops silently in dev — surface stays put, no POST, no triggerAction call", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let registryHandle: ReturnType<typeof useSurfaceRegistry> | null = null;
    function Capture() {
      registryHandle = useSurfaceRegistry();
      return null;
    }
    render(
      wrap(
        <>
          <Capture />
          <A2UISurfaceMount
            surfaceId="workspace"
            sessionId="sess-1"
            triggerOnAction={true}
          />
        </>,
      ),
    );
    act(() => pushSurface(registryHandle!, "workspace"));
    const surface = registryHandle!.getState("workspace")?.surface!;
    await act(async () => {
      await surface.dispatchAction({ event: { name: "click" } }, "btn-1");
    });

    expect(triggerActionSpy).not.toHaveBeenCalled();
    expect(fetchWithAuthSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
