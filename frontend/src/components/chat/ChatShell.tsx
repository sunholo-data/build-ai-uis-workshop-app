"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import type { DocTabData } from "@/components/doc-browser/DocTab";
import { DocListView } from "@/components/doc-browser/DocListView";
import { DocTabsBar } from "@/components/doc-browser/DocTabsBar";
import { UploadDropZone } from "@/components/doc-browser/UploadDropZone";
import type { ParsedDocument } from "@/hooks/useDocBrowser";
import type { User } from "@/lib/firebase";
import { useSkillAgent, type StreamError } from "@/hooks/useSkillAgent";
import { useSkillMeta } from "@/hooks/useSkillMeta";
import { useUserSkills } from "@/hooks/useUserSkills";
import { useSessionMessages } from "@/hooks/useSessionMessages";
import { useSessionDocuments } from "@/hooks/useSessionDocuments";
import { useStableThreadId } from "@/hooks/useStableThreadId";
import { fetchWithAuth } from "@/lib/apiClient";
import { importByReference, isImportError } from "@/lib/importByReference";
import {
  useResizableWorkspaceRatio,
  readStoredCollapsed,
  writeStoredCollapsed,
} from "@/hooks/useResizableWorkspaceRatio";
import { WorkbenchResizeHandle } from "@/components/chat/WorkbenchResizeHandle";
import { useBackendReady } from "@/hooks/useBackendReady";
import { computeIncludedDocIds } from "@/lib/docContext";
import { notifySessionsChanged, subscribeSessionsChangedDetailed } from "@/lib/sessionEvents";
import { useSkillSessions } from "@/hooks/useSkillSessions";
import { SkillSessionPanel } from "@/components/chat/SkillSessionPanel";
import DocumentHistoryPanel from "@/components/chat/DocumentHistoryPanel";
import { SidebarSection } from "@/components/chat/SidebarSection";
import { InContextBadge } from "@/components/chat/InContextBadge";
import { Workbench, type WorkbenchTab } from "@/components/chat/Workbench";
import { SkillExamplesPicker } from "@/components/chat/SkillExamplesPicker";
import { GCSFileBrowser } from "@/components/doc-browser/GCSFileBrowser";
import type { ExampleDocument } from "@/types/skill";
import { SkillsBar } from "@/components/navigation/SkillsBar";
import {
  SurfaceRegistryProvider,
  useClearSurfacesOnSessionChange,
  useSurfaceState,
} from "@/providers/SurfaceRegistry";
import { A2UISurfaceMount } from "@/components/protocols/A2UISurfaceMount";
import { DocumentPanel } from "@/components/document/DocumentPanel";
import { LatencyHUD } from "@/components/dev/LatencyHUD";

/**
 * MULTI-SURFACE-A2UI M3 — chat page surface mounts.
 *
 * The chat page wraps in <SurfaceRegistryProvider> and declares mounts for
 * the four named A2UI surfaces. Each mount is conditional on having content
 * — empty surfaces don't add visible DOM. Layout intent:
 *   - workspace : displaces or sits alongside the DocumentPanel (w-1/2 region)
 *   - sidebar   : appends to the bottom of the existing aside
 *   - modal     : fixed-position overlay at page root (M4 wires the
 *                 user-gesture guard; M3 just shows it when populated)
 */
function WorkspaceSurfaceRegion({ sessionId }: { sessionId: string | null }) {
  const state = useSurfaceState("workspace");
  if (!state?.surface) return null;
  // Workspace is a flex sibling of the chat panel. Each gets `flex-1
  // min-w-0` so they share the parent row proportionally and BOTH can
  // shrink below their natural content size when the viewport is narrow.
  // `max-w-xl` caps the workspace so it doesn't dominate on wide screens;
  // the chat is the primary interaction surface and shouldn't be squeezed
  // by small dashboard content. Cap is generous (576px) — forks with
  // larger dashboards override via SurfaceRegistry policy.
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r md:max-w-xl">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <A2UISurfaceMount
          surfaceId="workspace"
          className="h-full"
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}

function SidebarSurfaceRegion({ sessionId }: { sessionId: string | null }) {
  const state = useSurfaceState("sidebar");
  if (!state?.surface) return null;
  return (
    <div className="border-t px-2 py-2">
      <A2UISurfaceMount surfaceId="sidebar" sessionId={sessionId} />
    </div>
  );
}

function ModalSurfaceRegion({ sessionId }: { sessionId: string | null }) {
  const state = useSurfaceState("modal");
  if (!state?.surface) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="max-w-xl rounded-lg border bg-background p-4 shadow-xl">
        <A2UISurfaceMount surfaceId="modal" sessionId={sessionId} />
      </div>
    </div>
  );
}

/**
 * MULTI-SURFACE-A2UI M4 — wires the session-id transition to surface
 * lifecycle policy. When the user starts/switches sessions, session-scoped
 * surfaces (workspace, sidebar by default) clear automatically. The hook
 * is idempotent on the same sessionId so it won't fire on render.
 */
function SurfaceSessionLifecycle({ sessionId }: { sessionId: string | null }) {
  useClearSurfacesOnSessionChange(sessionId);
  return null;
}

/**
 * v6.4.0 ITERATION 2026-06-09: Workbench right pane wrapper.
 * Lives INSIDE SurfaceRegistryProvider scope so `useSurfaceState` works.
 * Renders 2 tabs (Workspace + Document) with EmptyTab fallbacks.
 */
function WorkbenchPane({
  activeTabId,
  sessionId,
  userUid,
  workbenchTabId,
  onWorkbenchTabChange,
  onSelectSession,
  onNewSession,
  welcomeExamples,
  isFreshChat,
  onPickExample,
  workbenchClassName,
  onContentChange,
}: {
  activeTabId: string | null;
  sessionId: string | null;
  userUid: string;
  workbenchTabId: string;
  onWorkbenchTabChange: (id: string) => void;
  onSelectSession: (sid: string) => void;
  onNewSession: () => void;
  /** v6.4.0 4.5 SKILL-ONBOARDING M2 — skill.welcome.exampleDocuments,
   * passed through from ChatShell which resolves it via useSkillMeta. */
  welcomeExamples: ExampleDocument[];
  /** True when chat has no messages + no resumed session. The picker
   * replaces the EmptyTab fallback in this state and ONLY this state. */
  isFreshChat: boolean;
  /** Click handler — parent fires the synthetic intent message. */
  onPickExample: (example: ExampleDocument) => void;
  /** Override the Workbench's default 4-breakpoint width scale. Pass ""
   * to let the parent control the width (used when WorkbenchPane sits
   * inside the resizable chat-row introduced 2026-06-11). */
  workbenchClassName?: string;
  /** 2026-06-11 auto-fold: WorkbenchPane reports whether it has any
   * meaningful content to render (workspace surface ⊕ open doc tab ⊕
   * fresh-chat examples). Parent uses this to hide the resize handle
   * and let chat take the full row when there's nothing in the
   * workbench worth showing. Lives here because the
   * useSurfaceState("workspace") check has to run inside the
   * SurfaceRegistryProvider, which only wraps the JSX subtree. */
  onContentChange?: (hasContent: boolean) => void;
}) {
  const workspaceSurface = useSurfaceState("workspace");
  // v6.4.0 4.5 SKILL-ONBOARDING M2: Workspace-tab content resolves in this
  // priority order:
  //   1) A2UI surface emitted by the agent (existing — wins immediately)
  //   2) SkillExamplesPicker when fresh + examples set (onboarding affordance)
  //   3) EmptyTab fallback (existing legacy behaviour)
  const showPicker =
    !workspaceSurface?.surface && isFreshChat && welcomeExamples.length > 0;

  // 2026-06-11: badge the Workspace tab when an A2UI surface arrives
  // while the user is on a different tab. Avoids the forced-switch UX
  // (which interrupts whatever the user is reading in the Document tab)
  // while still drawing attention to new agent output. Cleared on click.
  const [workspaceBadged, setWorkspaceBadged] = useState(false);
  const prevSurfacePresentRef = useRef(false);
  useEffect(() => {
    const surfacePresent = Boolean(workspaceSurface?.surface);
    if (
      surfacePresent &&
      !prevSurfacePresentRef.current &&
      workbenchTabId !== "workspace"
    ) {
      setWorkspaceBadged(true);
    }
    prevSurfacePresentRef.current = surfacePresent;
  }, [workspaceSurface, workbenchTabId]);
  useEffect(() => {
    if (workbenchTabId === "workspace") setWorkspaceBadged(false);
  }, [workbenchTabId]);

  // 2026-06-11 auto-fold: report to the parent whether anything worth
  // rendering lives in the workbench. When false the parent hides the
  // resize handle and lets chat take the full row.
  const hasContent =
    Boolean(workspaceSurface?.surface) || activeTabId !== null || showPicker;
  useEffect(() => {
    onContentChange?.(hasContent);
  }, [hasContent, onContentChange]);
  if (!hasContent) return null;
  const tabs: WorkbenchTab[] = [
    {
      id: "workspace",
      eyebrow: "Assistant",
      label: "Workspace",
      badged: workspaceBadged,
      content: workspaceSurface?.surface ? (
        <div className="h-full p-3">
          <A2UISurfaceMount
            surfaceId="workspace"
            className="h-full"
            sessionId={sessionId}
          />
        </div>
      ) : showPicker ? (
        <SkillExamplesPicker
          examples={welcomeExamples}
          onPickExample={onPickExample}
        />
      ) : null,
      emptyBody:
        "The assistant's structured outputs — clause cards, comparisons, charts — appear here as it works on your question.",
    },
    {
      id: "document",
      label: "Document",
      content: activeTabId ? (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <DocumentPanel docId={activeTabId} />
          </div>
          <DocumentHistoryPanel
            documentId={activeTabId}
            activeSessionId={sessionId}
            currentUserUid={userUid}
            onSelectSession={onSelectSession}
            onNewSession={onNewSession}
            onDeleteActive={onNewSession}
          />
        </div>
      ) : null,
      emptyBody:
        "Click a document in the sidebar to read it here alongside the conversation.",
    },
  ];
  return (
    <Workbench
      tabs={tabs}
      activeTabId={workbenchTabId}
      onActiveTabChange={onWorkbenchTabChange}
      className={workbenchClassName}
    />
  );
}

function StreamErrorBanner({
  error,
  onRetry,
  onDismiss,
}: {
  error: StreamError;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  // Rate-limit / quota renders amber ("wait & retry") to visually distinguish a
  // key/quota issue from a red "the demo is broken" error.
  const amber = error.kind === "rate_limited";
  const boxTone = amber
    ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
    : "border-destructive/40 bg-destructive/10 text-destructive";
  const btnTone = amber
    ? "border-amber-500/40 hover:bg-amber-500/20"
    : "border-destructive/40 hover:bg-destructive/20";
  return (
    <div className={`inline-block max-w-[80%] space-y-2 rounded-md border px-3 py-2 text-sm ${boxTone}`}>
      <p>{error.message}</p>
      <div className="flex gap-2">
        {error.retryable && (
          <button
            type="button"
            onClick={onRetry}
            className={`rounded border px-2 py-0.5 text-xs ${btnTone}`}
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-destructive/20 px-2 py-0.5 text-xs text-destructive/70 hover:bg-destructive/10"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function ChatShell({
  skillId,
  pathPrefix,
  user,
}: {
  skillId: string;
  pathPrefix: string;
  user: User;
}) {
  const {
    sessionId: agentSessionId,
    messages,
    toolCalls,
    thinkingContent,
    isThinking,
    stageLabel,
    sendMessage,
    isLoading,
    error,
    clearError,
    stop,
  } = useSkillAgent();
  const {
    displayName,
    mcpServerIds,
    welcome: skillWelcome,
    initialMessage: skillInitialMessage,
    loading: skillMetaLoading,
  } = useSkillMeta(skillId);

  // 2026-06-11 cold-start UX: surface a "Connecting…" banner + disable
  // the input until BOTH the skill metadata is loaded AND the backend
  // sidecar is reachable. Without this, users land on a freshly-rolled-
  // out revision, see a familiar-looking chat shell, type a question,
  // and hit a timeout / RUN_ERROR before the agent path is warm. The
  // backend probe lives in useBackendReady (polls /api/proxy/health
  // with backoff until 200).
  const { ready: backendReady } = useBackendReady();
  const chatReady = !skillMetaLoading && backendReady;
  // v6.4.0 4.5 SKILL-ONBOARDING M3: source the intro from welcome.introMessage
  // first, fallback to legacy initialMessage. Empty/null → no intro bubble.
  const skillIntroMessage =
    (skillWelcome?.introMessage && skillWelcome.introMessage.trim()) ||
    (skillInitialMessage && skillInitialMessage.trim()) ||
    null;
  const { skills: userSkills, isLoading: skillsLoading } = useUserSkills(user.uid);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  // 2026-06-11 polish: sidebar default-collapsed + per-tab persistence.
  // Most demo sessions don't need the sessions/docs list visible at all;
  // start hidden so chat takes the full row. User can re-open via the
  // DocTabsBar toggle button (top-left of the chat header). Persisted
  // globally (not per-skill) in sessionStorage — sidebar visibility is
  // a workspace-wide preference, not a per-skill one.
  const [showDocBrowser, setShowDocBrowser] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem("aitana.sidebar.open");
    if (stored === "1") setShowDocBrowser(true);
  }, []);
  const toggleDocBrowser = useCallback(() => {
    setShowDocBrowser((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("aitana.sidebar.open", next ? "1" : "0");
      }
      return next;
    });
  }, []);
  const [openTabs, setOpenTabs] = useState<DocTabData[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // v6.4.0 ITERATION 2026-06-09: Workbench is the right pane that holds
  // the document + workspace surfaces. Default starts on "workspace" so
  // the agent's outputs land in the visible tab as the user chats;
  // auto-switches to "document" when the user opens a doc from sidebar.
  const [workbenchTabId, setWorkbenchTabId] = useState<string>("workspace");
  const lastUserMessageRef = useRef<string>("");

  // 2026-06-11 polish: chat↔workbench split ratio, drag-resizable +
  // sessionStorage-persisted per-skill. The handle component lives in
  // components/chat/WorkbenchResizeHandle.tsx. RATIO_MAX=1.0 hides the
  // chat entirely (workspace full-bleed); RATIO_MIN=0.3 caps the
  // workbench at 30% of the row.
  const { ratio: workspaceRatio, setRatio: setWorkspaceRatio } =
    useResizableWorkspaceRatio(skillId);

  // 2026-06-11 auto-fold: WorkbenchPane reports whether it has content
  // (workspace surface ⊕ open doc tab ⊕ fresh-chat examples). When
  // false, hide the resize handle and let chat flex-1 across the row.
  // Default true so the first paint isn't a layout flash on skills that
  // do have content — the callback will flip to false within one render
  // if there's truly nothing.
  const [workbenchHasContent, setWorkbenchHasContent] = useState(true);

  // 2026-06-11 user-driven collapse: distinct from auto-fold. Even when
  // the workbench HAS content (a doc tab open, an A2UI surface mounted),
  // the user can click a button to hide it. Persisted per-skill so the
  // preference survives navigation within a tab. Collapsed → render a
  // thin vertical strip with an expand chevron so the user always sees
  // a way back.
  const [workbenchCollapsed, setWorkbenchCollapsed] = useState(false);
  useEffect(() => {
    setWorkbenchCollapsed(readStoredCollapsed(skillId));
  }, [skillId]);
  const toggleWorkbenchCollapsed = useCallback(() => {
    setWorkbenchCollapsed((v) => {
      const next = !v;
      writeStoredCollapsed(skillId, next);
      return next;
    });
  }, [skillId]);

  // Combined "is the workbench currently visible" — visible when there's
  // content AND the user hasn't collapsed it. When collapsed, the thin
  // expand strip renders instead.
  const workbenchVisible = workbenchHasContent && !workbenchCollapsed;

  // Session routing: read ?session= from URL, allow programmatic navigation
  const sessionId = searchParams.get("session");
  const { initialMessages, historyError, sessionGone } = useSessionMessages(sessionId);
  const { tabs: sessionDocTabs } = useSessionDocuments(sessionId);
  const { sessions, isLoading: sessionsLoading } = useSkillSessions(skillId);

  // Tracks whether the user reached this chat by clicking a conversation
  // thread (resume) vs starting a fresh chat. Backend uses this flag to
  // decide whether to eagerly inline document content into the LLM
  // request (resume → yes, fresh → standard tool-discovery flow).
  // Initial value: ?session= was already in the URL on mount = resume.
  // Updated by handleSelectSession (true) and handleNewSession (false);
  // intentionally NOT set by the URL-writeback effect that runs after a
  // fresh chat's first message — that's not a resume.
  const [enteredViaResume, setEnteredViaResume] = useState<boolean>(
    () => sessionId !== null,
  );

  // v6.4.0 INTERNAL-SHELL M1: auto-collapse sidebar on first user message of
  // a fresh chat so the chat + workbench own the screen during a run.
  // Fires exactly once per session-start (isFreshChat true → false). Skipped
  // on resume; manual reopens stick.
  const isFreshChat = messages.length === 0 && sessionId === null;
  const prevFreshChatRef = useRef(isFreshChat);
  useEffect(() => {
    if (prevFreshChatRef.current && !isFreshChat && !enteredViaResume) {
      setShowDocBrowser(false);
    }
    prevFreshChatRef.current = isFreshChat;
  }, [isFreshChat, enteredViaResume]);

  // Auto-switch Workbench to Document tab when the user opens a doc.
  useEffect(() => {
    if (activeTabId) setWorkbenchTabId("document");
  }, [activeTabId]);

  // When the URL points at an existing session and we've resolved its
  // documentIds, mount those tabs (with `included: true`) so the user lands
  // on the same workspace they had during the original conversation. Only
  // fires once per session-load — `lastSyncedSessionId` ref guards against
  // wiping subsequent tab edits the user makes inside the same session.
  const lastSyncedSessionId = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId) {
      // Cleared back to a fresh chat — drop the ref so revisiting the same
      // session later still hydrates its tabs.
      lastSyncedSessionId.current = null;
      return;
    }
    if (sessionDocTabs === null) return;
    if (lastSyncedSessionId.current === sessionId) return;
    lastSyncedSessionId.current = sessionId;
    setOpenTabs(sessionDocTabs);
    setActiveTabId(sessionDocTabs[0]?.id ?? null);
  }, [sessionId, sessionDocTabs]);

  const navigateToSession = useCallback(
    (sid: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("session", sid);
      router.replace(`${pathPrefix}?${params.toString()}`);
    },
    [router, pathPrefix, searchParams],
  );

  // Pin the URL to the agent's session id once a fresh chat has produced its
  // first user message. Without this the ChatSessionIndex row exists in
  // Firestore but the URL never reflects it, so a refresh starts a new chat
  // and the existing session looks "lost". Skip when the URL already has a
  // session — the resume path is already pointing at the right id.
  useEffect(() => {
    if (!sessionId && agentSessionId && messages.length > 0) {
      navigateToSession(agentSessionId);
    }
  }, [sessionId, agentSessionId, messages.length, navigateToSession]);

  // Fire-and-forget bootstrap: pre-create the ChatSessionIndex + ADK session
  // before the first agent turn so iframe context pushes (ui/update-model-context)
  // that arrive immediately after mount don't 404. Idempotent on the backend —
  // resumed sessions already have an index and the call is a no-op.
  const bootstrappedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!agentSessionId || bootstrappedRef.current === agentSessionId) return;
    bootstrappedRef.current = agentSessionId;
    void fetchWithAuth(`/api/proxy/api/sessions/${agentSessionId}/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill_id: skillId }),
    }).catch(() => {
      // bootstrap is best-effort; silently swallow errors so the chat isn't broken
    });
  }, [agentSessionId, skillId]);

  const userInitial = (user.displayName ?? user.email ?? "U").charAt(0).toUpperCase();
  const userDisplayName = user.displayName ?? user.email ?? "You";

  // Documents currently included in agent context. Every open tab defaults to
  // included; users uncheck the box on a tab to exclude it without closing it.
  // Derivation extracted to lib/docContext.ts so the multi-doc contract is
  // unit-testable independently of the chat-page render tree
  // (multi-doc-context-fix.md / 1.22 D2).
  const includedDocIds = computeIncludedDocIds(openTabs);

  async function handleSend() {
    const text = draft.trim();
    if (!text || isLoading || error) return;
    lastUserMessageRef.current = text;
    setDraft("");
    await sendMessage(text, {
      documentIds: includedDocIds,
      resumedSession: enteredViaResume,
    });
  }

  const handleRetry = useCallback(() => {
    const text = lastUserMessageRef.current;
    if (!text) { clearError(); return; }
    clearError();
    void sendMessage(text, {
      documentIds: includedDocIds,
      resumedSession: enteredViaResume,
    });
  }, [clearError, sendMessage, includedDocIds, enteredViaResume]);

  const handleAction = useCallback(
    (event: { actionName: string; context: Record<string, unknown> }) => {
      void sendMessage(
        `[a2ui:${event.actionName}] ${JSON.stringify(event.context)}`,
        { documentIds: includedDocIds, resumedSession: enteredViaResume },
      );
    },
    [sendMessage, includedDocIds, enteredViaResume],
  );

  // Wraps navigateToSession with the resume signal so we differentiate
  // explicit thread clicks from the URL writeback that happens after a
  // fresh chat's first message.
  const handleSelectSession = useCallback(
    (sid: string) => {
      setEnteredViaResume(true);
      navigateToSession(sid);
    },
    [navigateToSession],
  );

  const handleNewSession = useCallback(() => {
    setEnteredViaResume(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("session");
    const qs = params.toString();
    router.replace(qs ? `${pathPrefix}?${qs}` : pathPrefix);
  }, [router, pathPrefix, searchParams]);

  // Defensive auto-clear: when ANY mutation site reports a deletion via the
  // sessions-changed bus and that id matches the URL session we're showing,
  // navigate to a fresh chat even if the originating handler missed the
  // active-session check (e.g. stale closure props on a detached panel).
  // See docs/design/v6.1.0/implemented/session-delete-ui.md.
  useEffect(() => {
    return subscribeSessionsChangedDetailed((detail) => {
      if (detail.deletedSessionId && detail.deletedSessionId === sessionId) {
        handleNewSession();
      }
    });
  }, [sessionId, handleNewSession]);

  // Stranded-session-prevention (1.23) Option 1: GET /messages returned 404,
  // meaning ?session=X points at a session the backend no longer has. Drop
  // ?session= from the URL so useStableThreadId mints a fresh UUID before
  // the next outbound POST. One-shot — handleNewSession clears sessionId,
  // which resets sessionGone via the hook on the next effect cycle.
  useEffect(() => {
    if (sessionGone && sessionId) {
      handleNewSession();
    }
  }, [sessionGone, sessionId, handleNewSession]);

  const handleDeleteSkillSession = useCallback(
    async (sid: string) => {
      // Mirrors DocumentHistoryPanel.handleDelete: confirm + DELETE +
      // dispatch sessions-changed (which both useSkillSessions and any
      // mounted useDocumentSessions listen for, so both panels reconcile)
      // + clear URL if the deleted session is active.
      if (
        !window.confirm(
          "Delete this conversation? This can't be undone from the UI.",
        )
      ) {
        return;
      }
      try {
        const res = await fetchWithAuth(
          `/api/proxy/api/sessions/${encodeURIComponent(sid)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        notifySessionsChanged({ deletedSessionId: sid });
        if (sid === sessionId) {
          handleNewSession();
        }
      } catch {
        // Backend rejected. Reconcile via the same bus.
        notifySessionsChanged();
      }
    },
    [sessionId, handleNewSession],
  );

  const handleDocClick = useCallback((doc: ParsedDocument) => {
    setOpenTabs((prev) => {
      if (prev.find((t) => t.id === doc.id)) return prev;
      return [
        ...prev,
        { id: doc.id, filename: doc.originalFilename, format: doc.sourceFormat, included: true },
      ];
    });
    setActiveTabId(doc.id);
    // 2026-06-11: always pull the workbench to the Document tab on a
    // doc-click. Same rationale as the DocTabsBar onSelect wrapper —
    // covers the case where activeTabId is already this doc (no state
    // change → activeTabId-change useEffect doesn't fire).
    setWorkbenchTabId("document");
  }, []);

  // DOC-IMPORT-REF M3: shared handler for the picker + GCSFileBrowser. POSTs
  // to /api/documents/import-by-reference (via the lib helper), then mounts
  // the returned doc in the workbench via handleDocClick — same path uploads
  // take. Replaces the 4.5 synthetic-chat-message hack that delegated to
  // the agent's bucket tools (which returned raw bytes, not parsed blocks).
  const handleImportByReference = useCallback(
    async (bucket: string, objectName: string): Promise<void> => {
      const result = await importByReference(bucket, objectName, skillId);
      if (isImportError(result)) {
        console.error(`import-by-reference failed: ${result.message}`);
        return;
      }
      handleDocClick(result.doc);
    },
    [skillId, handleDocClick],
  );

  const handleTabClose = useCallback((id: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) setActiveTabId(next[next.length - 1]?.id ?? null);
      return next;
    });
  }, [activeTabId]);

  const handleTabToggleInclude = useCallback((id: string) => {
    setOpenTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, included: !t.included } : t)),
    );
  }, []);

  const inputDisabled = isLoading || error !== null || !chatReady;

  // Esc cancels an in-flight run — perceived-snappiness affordance from
  // ttft-instrumentation.md M2. Bound at document level because the
  // text input is disabled while isLoading (no keydown fires there).
  // No-op when no run is in flight; lets browser handle Esc otherwise.
  useEffect(() => {
    if (!isLoading) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stop();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isLoading, stop]);

  return (
    <SurfaceRegistryProvider>
    <SurfaceSessionLifecycle sessionId={sessionId} />
    <main className="flex h-screen flex-col">
      <SkillsBar
        skills={userSkills}
        activeSkillId={skillId}
        isLoading={skillsLoading}
        onCreateClick={() => router.push("/skills/new")}
      />

      <DocTabsBar
        tabs={openTabs}
        // 2026-06-11: explicitly switch the workbench to the Document
        // tab on every doc-tab click. The activeTabId-change useEffect
        // below already covers the case where the activeTabId actually
        // CHANGES (click doc A → click doc B), but if the user clicks
        // the already-active doc in the tab strip — e.g. after manually
        // switching to the Workspace tab — React skips the setState
        // and the effect never fires. Doing it explicitly here makes
        // the click reliably bring the user to the doc preview no
        // matter the prior workbench tab state.
        activeTabId={activeTabId}
        showBrowser={showDocBrowser}
        onSelect={(id) => {
          setActiveTabId(id);
          setWorkbenchTabId("document");
        }}
        onClose={handleTabClose}
        onToggleInclude={handleTabToggleInclude}
        onToggleBrowser={toggleDocBrowser}
      />

      <div className="flex min-h-0 flex-1" data-workspace-row>
        {showDocBrowser && (
          <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r bg-muted/30">
            {/* v6.4.0 INTERNAL-SHELL M1: two collapsible sections
                (Sessions + Documents). DocumentHistoryPanel stays in the
                doc-panel column (doc-scoped to activeTabId); History
                section in the sidebar would either duplicate that
                behaviour or change the UX. Kept out per sprint scoping. */}
            <SidebarSection title="Past conversations" defaultOpen={true}>
              <div className="max-h-40 overflow-y-auto">
                <SkillSessionPanel
                  sessions={sessions}
                  activeSessionId={sessionId}
                  isLoading={sessionsLoading}
                  onSelectSession={handleSelectSession}
                  onDelete={(sid) => void handleDeleteSkillSession(sid)}
                />
              </div>
            </SidebarSection>
            <SidebarSection
              title="Your files"
              defaultOpen={true}
              bodyClassName=""
            >
              <DocListView uid={user.uid} onDocClick={handleDocClick} />
              <div className="border-t">
                <UploadDropZone skillId={skillId} />
              </div>
            </SidebarSection>
            {/* v6.4.0 4.5 SKILL-ONBOARDING M4 — 3rd sidebar section for
                skills that declare welcome.bucket_browser. Lets the user
                browse a curated library (e.g. ONE's PPA library) without
                uploading. Click a file → fires synthetic chat message
                asking the agent to load it via its bucket tools. */}
            {skillWelcome?.bucketBrowser && (
              <SidebarSection
                title={skillWelcome.bucketBrowser.label || "Library"}
                defaultOpen={skillWelcome.bucketBrowser.defaultOpen ?? false}
              >
                <GCSFileBrowser
                  bucket={skillWelcome.bucketBrowser.bucket}
                  rootPath={skillWelcome.bucketBrowser.rootPath ?? ""}
                  onPick={(bucket, objectName, _label) => {
                    void handleImportByReference(bucket, objectName);
                  }}
                />
              </SidebarSection>
            )}

            {/* MULTI-SURFACE-A2UI M3: sidebar surface mount — only visible
                when agent populates the surface. Sits below the doc list +
                upload zone so it doesn't disturb the existing sidebar UX. */}
            <SidebarSurfaceRegion sessionId={sessionId ?? agentSessionId} />
          </aside>
        )}

        {/* v6.4.0 ITERATION 2026-06-09: Chat is the middle column,
            Workbench is the right pane. Replaces the prior conditional
            ladder where DocumentPanel took the middle slot when a doc
            was open (chat pushed right) and WorkspaceSurfaceRegion took
            it when the agent emitted a surface. Now the right pane is
            ALWAYS the Workbench with Document + Workspace tabs.

            2026-06-11 polish: chat width tracks (1 - workspaceRatio) so
            the WorkbenchResizeHandle below can drag chat ↔ workbench
            live, with per-skill sessionStorage persistence. */}
        <div
          className={
            workbenchVisible ? "flex min-w-0 flex-col" : "flex min-w-0 flex-1 flex-col"
          }
          style={
            workbenchVisible
              ? { flexBasis: `${(1 - workspaceRatio) * 100}%`, flexGrow: 0, flexShrink: 1 }
              : undefined
          }
        >
          <ChatMessageList
            messages={messages}
            introMessage={
              // Only show on truly-fresh chat — skip on resume.
              !enteredViaResume ? skillIntroMessage : null
            }
            skillDisplayName={displayName}
            // initialMessages are the persisted history fetched by
            // useSessionMessages(sessionId). They're only relevant when the
            // user RESUMED an existing session — in that case the live
            // `messages` array is empty until the first new turn, so the
            // history fills the gap. When the URL is written back mid-chat
            // (fresh chat → server assigns sessionId → URL update), the
            // history fetch returns the same messages that are ALREADY in
            // live `messages` — duplicating every bubble. `enteredViaResume`
            // distinguishes the two cases.
            initialMessages={enteredViaResume ? initialMessages : undefined}
            historyError={historyError}
            toolCalls={toolCalls}
            thinkingContent={thinkingContent}
            isThinking={isThinking}
            isLoading={isLoading}
            error={error}
            skillId={displayName}
            userInitial={userInitial}
            userDisplayName={userDisplayName}
            userPhotoURL={user.photoURL}
            stageLabel={stageLabel}
            onAction={handleAction}
            mcpServerIds={mcpServerIds}
            sessionId={sessionId ?? agentSessionId}
            onChatMessage={(text) => {
              // MCP App iframe → notification adapter → synthetic chat
              // turn. Goes out as a normal sendMessage (with the same
              // doc-context + resume flags as a typed message).
              void sendMessage(text, {
                documentIds: includedDocIds,
                resumedSession: enteredViaResume,
              });
            }}
            errorBanner={
              error ? (
                <StreamErrorBanner
                  error={error}
                  onRetry={handleRetry}
                  onDismiss={clearError}
                />
              ) : undefined
            }
          />

          <footer className="border-t p-3">
            {/* 2026-06-11 cold-start UX: surface a "Connecting…" banner
                whenever the agent isn't safe to talk to yet — skill
                metadata still loading OR backend cold-start in flight.
                Disables the input via inputDisabled at the same time. */}
            {!chatReady && (
              <div
                className="mb-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                role="status"
                aria-live="polite"
              >
                <svg
                  className="h-3 w-3 animate-spin shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeOpacity="0.25"
                  />
                  <path
                    d="M12 2 a10 10 0 0 1 10 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
                <span>
                  {skillMetaLoading
                    ? "Loading skill…"
                    : "Connecting to assistant… you can start typing in a moment."}
                </span>
              </div>
            )}
            {/* v6.4.0 INTERNAL-SHELL M3: in-context caption — disambiguates
                multi-doc state so the user always knows which files the
                agent will see on the next turn. Renders nothing when no
                docs are included. */}
            <InContextBadge openTabs={openTabs} includedDocIds={includedDocIds} />
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={chatReady ? "Message…" : "Connecting…"}
                className="flex-1 rounded-md border px-3 py-2 text-sm"
                disabled={inputDisabled}
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={stop}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                  disabled={!draft.trim() || inputDisabled}
                >
                  Send
                </button>
              )}
            </form>
          </footer>
        </div>

        {/* 2026-06-11 polish: drag handle between chat and workbench.
            Drag, ←/→ (5%), Home/End (jump to min/max), Enter (50%);
            snaps at 30/50/70/100. Per-skill ratio in sessionStorage.
            Only rendered when the workbench is visible (content + not
            user-collapsed) — otherwise chat takes the full row. */}
        {workbenchVisible && (
          <WorkbenchResizeHandle ratio={workspaceRatio} onChange={setWorkspaceRatio} />
        )}

        {/* 2026-06-11 user-driven collapse: when content exists but the
            user has explicitly hidden the workbench, render a thin
            vertical strip on the right edge with a chevron the user
            can click to bring the workbench back. Without this strip
            a collapsed workbench would look like the auto-folded case
            and the user couldn't tell where to click to restore it. */}
        {workbenchHasContent && workbenchCollapsed && (
          <button
            type="button"
            onClick={toggleWorkbenchCollapsed}
            className="group flex h-full w-6 shrink-0 flex-col items-center justify-center border-l bg-muted/40 transition-colors hover:bg-muted"
            aria-label="Expand workbench"
            title="Expand workbench"
          >
            <svg
              className="h-3 w-3 text-muted-foreground group-hover:text-foreground"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="8 2 4 6 8 10" />
            </svg>
            <span className="mt-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl] [transform:rotate(180deg)]">
              Workbench
            </span>
          </button>
        )}

        {/* v6.4.0 ITERATION 2026-06-09: Workbench right pane — always
            visible. WorkbenchPane is a child component so its
            useSurfaceState hook runs INSIDE the SurfaceRegistryProvider
            scope (the provider wraps ChatShell's JSX above).

            v6.4.0 4.5 SKILL-ONBOARDING M2 — also receives the active
            skill's welcome.exampleDocuments + isFreshChat so the
            Workspace tab can render SkillExamplesPicker instead of the
            EmptyTab fallback when the skill ships onboarding examples.

            2026-06-11: wrapped in a div whose flex-basis tracks
            workspaceRatio so the WorkbenchResizeHandle above can drive
            the live split. workbenchClassName="" overrides the default
            md:w-[520px]…2xl:w-[760px] breakpoint scale inside Workbench
            since width is now parent-driven. */}
        <div
          className="relative flex min-w-0 flex-col"
          style={
            workbenchVisible
              ? { flexBasis: `${workspaceRatio * 100}%`, flexGrow: 0, flexShrink: 1 }
              : { flexBasis: 0, flexGrow: 0, flexShrink: 0 }
          }
        >
        {/* 2026-06-11 explicit collapse: small chevron in the top-right
            corner of the workbench. Sits absolute so it overlays the
            Workbench's own tab strip without disturbing the layout. */}
        {workbenchVisible && (
          <button
            type="button"
            onClick={toggleWorkbenchCollapsed}
            className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Collapse workbench"
            title="Collapse workbench"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="4 2 8 6 4 10" />
            </svg>
          </button>
        )}
        <WorkbenchPane
          workbenchClassName=""
          onContentChange={setWorkbenchHasContent}
          activeTabId={activeTabId}
          sessionId={sessionId ?? agentSessionId}
          userUid={user.uid}
          workbenchTabId={workbenchTabId}
          onWorkbenchTabChange={setWorkbenchTabId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          welcomeExamples={skillWelcome?.exampleDocuments ?? []}
          isFreshChat={isFreshChat}
          onPickExample={(example) => {
            // DOC-IMPORT-REF M3: POST to /api/documents/import-by-reference
            // and mount the parsed doc in the workbench via handleDocClick.
            // Replaces the 4.5 synthetic-chat-message hack that bypassed
            // AILANG Parse and made the LLM stare at raw bytes.
            void handleImportByReference(example.bucket, example.object);
          }}
        />
        </div>
      </div>
      <LatencyHUD />
      {/* MULTI-SURFACE-A2UI M3: modal surface mount — fixed-position
          overlay at page root. Only visible when populated; M4 will wire
          the user-gesture guard so the agent can't pop one unprompted. */}
      <ModalSurfaceRegion sessionId={sessionId ?? agentSessionId} />
    </main>
    </SurfaceRegistryProvider>
  );
}
