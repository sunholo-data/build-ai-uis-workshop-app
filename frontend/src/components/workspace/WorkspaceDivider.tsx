"use client";

// Standalone WorkspaceDivider — used in compositions outside WorkspaceShell
// that still want the same drag-resize affordance (v6.4.0 ONE-DEMO M3,
// ported inline from fork-visual-demo-pullback 4.1 M1).
//
// In M3 the SideBySideDocViewer composes its OWN split-pane internally
// using this divider directly (the WorkspaceShell already split the page
// once into chat + workbench; the viewer splits the workbench in two).

interface WorkspaceDividerProps {
  currentFraction: number;
  onFractionChange: (fraction: number) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  minFraction?: number;
  maxFraction?: number;
}

export function WorkspaceDivider({
  currentFraction,
  onFractionChange,
  containerRef,
  minFraction = 0.2,
  maxFraction = 0.8,
}: WorkspaceDividerProps) {
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const containerRect = containerEl.getBoundingClientRect();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    function onMove(moveEvent: PointerEvent) {
      const offsetX = moveEvent.clientX - containerRect.left;
      const raw = offsetX / containerRect.width;
      const clamped = Math.max(minFraction, Math.min(maxFraction, raw));
      onFractionChange(clamped);
    }
    function onUp(upEvent: PointerEvent) {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    }

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  return (
    <div
      data-testid="workspace-divider"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={minFraction}
      aria-valuemax={maxFraction}
      aria-valuenow={currentFraction}
      onPointerDown={onPointerDown}
      className="group flex h-full cursor-col-resize items-center justify-center bg-gray-100 hover:bg-gray-200"
    >
      <div className="h-8 w-0.5 rounded bg-gray-300 group-hover:bg-gray-400" />
    </div>
  );
}
