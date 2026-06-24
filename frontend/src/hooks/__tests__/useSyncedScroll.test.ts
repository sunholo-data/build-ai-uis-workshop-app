import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useSyncedScroll } from "@/hooks/useSyncedScroll";

/** Build a fake element with a controllable scrollTop/Height shape. */
function fakeScrollEl(opts: { scrollHeight?: number; clientHeight?: number } = {}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: opts.scrollHeight ?? 1000,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: opts.clientHeight ?? 100,
  });
  el.scrollTop = 0;
  return el;
}

describe("useSyncedScroll", () => {
  it("returns left/right refs and a scrollToFraction handle", () => {
    const { result } = renderHook(() => useSyncedScroll());
    expect(result.current.leftRef).toBeDefined();
    expect(result.current.rightRef).toBeDefined();
    expect(typeof result.current.scrollToFraction).toBe("function");
  });

  it("scrollToFraction moves both panes to the proportional position", () => {
    const left = fakeScrollEl({ scrollHeight: 1000, clientHeight: 100 });
    const right = fakeScrollEl({ scrollHeight: 2000, clientHeight: 200 });
    const { result } = renderHook(() => useSyncedScroll());
    (result.current.leftRef as React.MutableRefObject<HTMLElement | null>).current = left;
    (result.current.rightRef as React.MutableRefObject<HTMLElement | null>).current = right;

    act(() => result.current.scrollToFraction(0.5));

    // left scrollable range = 1000 - 100 = 900; 0.5 → 450
    // right scrollable range = 2000 - 200 = 1800; 0.5 → 900
    expect(left.scrollTop).toBeCloseTo(450);
    expect(right.scrollTop).toBeCloseTo(900);
  });

  it("clamps scrollToFraction inputs into [0, 1]", () => {
    const left = fakeScrollEl();
    const right = fakeScrollEl();
    const { result } = renderHook(() => useSyncedScroll());
    (result.current.leftRef as React.MutableRefObject<HTMLElement | null>).current = left;
    (result.current.rightRef as React.MutableRefObject<HTMLElement | null>).current = right;

    act(() => result.current.scrollToFraction(2.5));
    expect(left.scrollTop).toBe(900); // == max
    act(() => result.current.scrollToFraction(-0.5));
    expect(left.scrollTop).toBe(0);
  });
});
