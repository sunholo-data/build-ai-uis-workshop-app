"use client";

import { BRANDING } from "@/lib/branding";

/**
 * Bot-side chat avatar.
 *
 * G34 (template-chat-surface-defaults.md): uses theme tokens
 * (`bg-primary/10` + `ring-primary/20`) instead of a hardcoded gradient,
 * so a fork's rebrand via `tailwind.config.ts` / `globals.css` re-themes
 * the avatar without touching this file.
 */
export function BrandAvatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BRANDING.logo.chatAvatar}
        alt={BRANDING.appName}
        className="h-5 w-5"
      />
    </div>
  );
}
