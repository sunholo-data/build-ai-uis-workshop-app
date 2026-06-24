"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/apiClient";
import type { WelcomeConfig } from "@/types/skill";

interface SkillMeta {
  displayName: string;
  ownerId: string | null;
  slug: string | null;
  /** MCP server IDs this skill is configured to use, sourced from
   * skillMetadata.toolConfigs.mcp.servers. Empty array if none. The chat
   * page passes this to MessageBubble so MCPAppToolCallRouter can decide
   * which tool calls have a UI surface. */
  mcpServerIds: readonly string[];
  /** Skill's initialMessage (legacy) — falls back when welcome.introMessage
   * unset. v6.4.0 4.5 SKILL-ONBOARDING M1 (the AI-greeting source). */
  initialMessage: string;
  /** v6.4.0 4.5 SKILL-ONBOARDING welcome block — intro_message + example
   * documents + sidebar bucket browser. Null when skill omits the block. */
  welcome: WelcomeConfig | null;
  loading: boolean;
}

interface SkillResponse {
  displayName?: string;
  display_name?: string;
  name?: string;
  ownerId?: string;
  owner_id?: string;
  slug?: string | null;
  skillMetadata?: { toolConfigs?: { mcp?: { servers?: unknown } } };
  skill_metadata?: { toolConfigs?: { mcp?: { servers?: unknown } } };
  initialMessage?: string;
  initial_message?: string;
  welcome?: WelcomeConfig | null;
}

function extractMcpServerIds(data: SkillResponse): readonly string[] {
  const meta = data.skillMetadata ?? data.skill_metadata;
  const servers = meta?.toolConfigs?.mcp?.servers;
  if (!Array.isArray(servers)) return [];
  return servers.filter((s): s is string => typeof s === "string");
}

export function useSkillMeta(skillId: string): SkillMeta {
  const [displayName, setDisplayName] = useState<string>(skillId.slice(0, 8));
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [mcpServerIds, setMcpServerIds] = useState<readonly string[]>([]);
  const [initialMessage, setInitialMessage] = useState<string>("");
  const [welcome, setWelcome] = useState<WelcomeConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth(`/api/proxy/api/skills/${skillId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SkillResponse;
        if (!cancelled) {
          const display = data.displayName || data.display_name || data.name || skillId.slice(0, 8);
          setDisplayName(display);
          setOwnerId(data.ownerId || data.owner_id || null);
          setSlug(data.slug ?? null);
          setMcpServerIds(extractMcpServerIds(data));
          setInitialMessage(data.initialMessage || data.initial_message || "");
          setWelcome(data.welcome ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
        // displayName stays as truncated UUID fallback; mcpServerIds stays empty
      });
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  return { displayName, ownerId, slug, mcpServerIds, initialMessage, welcome, loading };
}
