"use client";

import { useCallback, useEffect, useRef } from "react";

// useSyncedScroll — keep two scrollable elements in sync (v6.4.0 ONE-DEMO M3).
//
// The SideBySideDocViewer uses this so scrolling either contract pane
// drives the other. Synced by proportional scroll position
// (scrollTop / (scrollHeight - clientHeight)), which works even when the
// two contracts have different total heights — the reviewer is reading
// the SAME relative position in each, not the same absolute pixel offset.
//
// Uses a `syncingRef` lock so writing to the partner doesn't recursively
// trigger our own listener (the partner's scroll event would otherwise
// bounce back and overwrite the user's intended position).

export interface SyncedScrollHandles {
  leftRef: React.RefObject<HTMLElement | null>;
  rightRef: React.RefObject<HTMLElement | null>;
  /** Programmatically scroll BOTH panes to a target fraction (0..1). */
  scrollToFraction: (fraction: number) => void;
}

export function useSyncedScroll(): SyncedScrollHandles {
  const leftRef = useRef<HTMLElement | null>(null);
  const rightRef = useRef<HTMLElement | null>(null);
  const syncingRef = useRef(false);

  const sync = useCallback((from: HTMLElement, to: HTMLElement) => {
    if (syncingRef.current) return;
    const fromMax = Math.max(1, from.scrollHeight - from.clientHeight);
    const toMax = Math.max(1, to.scrollHeight - to.clientHeight);
    const fraction = from.scrollTop / fromMax;
    syncingRef.current = true;
    to.scrollTop = fraction * toMax;
    // Release on the next animation frame — the partner's scroll event
    // fires synchronously here, so the lock must outlive this callstack.
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, []);

  useEffect(() => {
    const leftEl = leftRef.current;
    const rightEl = rightRef.current;
    if (!leftEl || !rightEl) return;

    function onLeftScroll() {
      if (rightEl && leftEl) sync(leftEl, rightEl);
    }
    function onRightScroll() {
      if (leftEl && rightEl) sync(rightEl, leftEl);
    }

    leftEl.addEventListener("scroll", onLeftScroll, { passive: true });
    rightEl.addEventListener("scroll", onRightScroll, { passive: true });
    return () => {
      leftEl.removeEventListener("scroll", onLeftScroll);
      rightEl.removeEventListener("scroll", onRightScroll);
    };
  }, [sync]);

  const scrollToFraction = useCallback((fraction: number) => {
    const clamped = Math.max(0, Math.min(1, fraction));
    const leftEl = leftRef.current;
    const rightEl = rightRef.current;
    if (leftEl) {
      const max = Math.max(0, leftEl.scrollHeight - leftEl.clientHeight);
      syncingRef.current = true;
      leftEl.scrollTop = clamped * max;
    }
    if (rightEl) {
      const max = Math.max(0, rightEl.scrollHeight - rightEl.clientHeight);
      rightEl.scrollTop = clamped * max;
    }
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, []);

  return { leftRef, rightRef, scrollToFraction };
}
