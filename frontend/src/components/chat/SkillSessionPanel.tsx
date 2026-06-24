"use client";

import type { ChatSessionSummary } from "@/hooks/useSkillSessions";

interface SkillSessionPanelProps {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  isLoading: boolean;
  onSelectSession: (sessionId: string) => void;
  /** Owner-only delete affordance. When provided, a trash icon appears on
   * the user's own session rows; click invokes ``onDelete(session_id)``.
   * Parent owns confirm + DELETE + refetch. Mirrors the per-document
   * panel's pattern from sprint 1.17. */
  onDelete?: (sessionId: string) => void;
}

function SessionSkeleton() {
  // Compact: 7px rows mirror the new single-line session item height.
  return (
    <div className="space-y-1 p-1" aria-label="Loading sessions">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-7 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

function relativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  } catch {
    return "";
  }
}

export function SkillSessionPanel({
  sessions,
  activeSessionId,
  isLoading,
  onSelectSession,
  onDelete,
}: SkillSessionPanelProps) {
  if (isLoading) {
    return <SessionSkeleton />;
  }

  if (sessions.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">No previous sessions</div>
    );
  }

  return (
    <nav aria-label="Session history" className="flex flex-col p-1">
      {sessions.map((s) => {
        const isActive = s.session_id === activeSessionId;
        const title = s.title ?? `Session ${s.session_id.slice(0, 8)}`;
        return (
          <div
            key={s.session_id}
            className={[
              "group flex w-full items-center gap-1 rounded px-1 transition-colors",
              "hover:bg-accent hover:text-accent-foreground",
              isActive ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => onSelectSession(s.session_id)}
              className="flex min-w-0 flex-1 items-baseline justify-between gap-2 px-1.5 py-1 text-left"
              aria-current={isActive ? "true" : undefined}
              title={title}
            >
              <span className="line-clamp-1 min-w-0 flex-1 text-xs">{title}</span>
              <span className="shrink-0 text-[10px] opacity-60">
                {relativeTime(s.last_message_at)}
              </span>
            </button>
            {onDelete && s.is_owner && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.session_id);
                }}
                aria-label={`Delete ${title}`}
                title="Delete"
                className="shrink-0 rounded p-1 text-gray-400 opacity-0 hover:bg-red-100 hover:text-red-600 group-hover:opacity-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M3 4h10M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4M7 4V3a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
