import type { ReactNode } from "react";

interface SidebarSectionProps {
  title: string;
  defaultOpen?: boolean;
  badge?: ReactNode;
  action?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Uniform collapsible sidebar section (v6.4.0 INTERNAL-SHELL M1).
 *
 * Headers are always visible so the user can reach every section regardless
 * of which others are expanded; each body is constrained so a single long
 * section can't push others off-screen.
 *
 * Uses native `<details>`/`<summary>` for accessibility — screen-reader
 * announces expand/collapse, keyboard Enter/Space toggles. No JS toggle
 * handler needed.
 *
 * Ported from gde-ap-agent app/chat/[...path]/page.tsx lines 462–493
 * (defined inline; generic component, no AP-specific dependencies).
 */
export function SidebarSection({
  title,
  defaultOpen = true,
  badge,
  action,
  bodyClassName,
  children,
}: SidebarSectionProps) {
  return (
    <details open={defaultOpen} className="group border-b border-border">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60 hover:text-muted-foreground">
        <SectionChevron />
        <span className="flex-1 truncate">{title}</span>
        {badge}
        {action}
      </summary>
      <div className={bodyClassName ?? "px-3 pb-3 pt-1"}>{children}</div>
    </details>
  );
}

function SectionChevron() {
  return (
    <svg
      className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
