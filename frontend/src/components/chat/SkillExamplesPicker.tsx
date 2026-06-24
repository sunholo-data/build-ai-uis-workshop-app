"use client";

import type { ExampleDocument } from "@/types/skill";

interface SkillExamplesPickerProps {
  examples: ExampleDocument[];
  /** Called when the user clicks a card. Parent decides what to do — typically
   * fires a synthetic chat message asking the agent to load the example via
   * its existing bucket tools (list_documents / get_document_content). */
  onPickExample: (example: ExampleDocument) => void;
  /** Click handler for the "Or upload your own" secondary link. Parent opens
   * the existing UploadDropZone or scrolls to it. */
  onUploadOwn?: () => void;
}

/**
 * SkillExamplesPicker (v6.4.0 4.5 SKILL-ONBOARDING M2).
 *
 * Card grid mounted in the WorkbenchPane Workspace tab when a chat is fresh
 * AND the active skill declares `welcome.example_documents`. Replaces the
 * EmptyTab fallback for skills that ship onboarding affordances; falls
 * through to EmptyTab when no examples set.
 *
 * Click → parent fires a chat message that asks the agent to load the
 * example via its bucket tools. No new backend endpoint required for v1;
 * the proper import-by-reference path can land later (4.5 M4 / v6.5).
 *
 * Q1 locked 2026-06-09: generic doc-icon fallback when example.thumbnail
 * is null. Auto-rendered thumbnails defer to v6.5.
 */
export function SkillExamplesPicker({
  examples,
  onPickExample,
  onUploadOwn,
}: SkillExamplesPickerProps) {
  if (examples.length === 0) return null;
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Try with an example
        </p>
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          Pick a document to get started
        </h3>
        <p className="text-sm text-muted-foreground">
          Each card below is a representative document the assistant can walk
          you through. You can also upload your own at any time.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {examples.map((example) => (
          <li key={`${example.bucket}/${example.object}`}>
            <button
              type="button"
              onClick={() => onPickExample(example)}
              className="group flex h-full w-full flex-col gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ExampleThumbnail example={example} />
              <div className="space-y-1">
                <p className="text-sm font-semibold leading-tight text-foreground group-hover:text-primary">
                  {example.label}
                </p>
                {example.summary && (
                  <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                    {example.summary}
                  </p>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {onUploadOwn && (
        <div className="border-t border-border pt-4">
          <button
            type="button"
            onClick={onUploadOwn}
            className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary"
          >
            Or upload your own document ↑
          </button>
        </div>
      )}
    </div>
  );
}

function ExampleThumbnail({ example }: { example: ExampleDocument }) {
  if (example.thumbnail) {
    return (
      <div className="relative aspect-[3/4] overflow-hidden rounded-md border border-border bg-muted/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={example.thumbnail}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  // Q1 locked: generic doc-icon fallback when no thumbnail.
  return (
    <div className="flex aspect-[3/4] items-center justify-center rounded-md border border-dashed border-border bg-muted/30">
      <DocIcon className="h-10 w-10 text-muted-foreground" />
    </div>
  );
}

function DocIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="M8 13h8M8 16h8M8 19h5" />
    </svg>
  );
}
