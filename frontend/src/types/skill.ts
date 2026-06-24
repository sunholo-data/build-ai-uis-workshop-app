/**
 * Skill types — mirrors backend/db/models.py SkillConfig.
 *
 * Layer 1: Agent Skills spec fields (name, description, instructions, skillMetadata)
 * Layer 2: Aitana platform metadata (skillId, displayName, accessControl, etc.)
 *
 * Generated from: backend SkillConfig.model_json_schema(by_alias=True)
 * Source of truth: backend/db/models.py
 */

export interface SkillMetadata {
  author: string;
  version: string;
  model: string;
  thinkingModel?: string | null;
  tools: string[];
  toolConfigs: Record<string, Record<string, unknown>>;
  subSkills: string[];
}

export interface AccessControl {
  type: "private" | "public" | "domain" | "specific";
  domain?: string | null;
  emails?: string[] | null;
}

export interface ProtocolConfig {
  enabled: boolean;
}

export interface Protocols {
  mcp: ProtocolConfig;
  a2a: ProtocolConfig;
  agui: ProtocolConfig;
  a2ui: ProtocolConfig;
  mcpApps: ProtocolConfig;
}

export interface Skill {
  // Layer 1: Agent Skills spec
  name: string;
  description: string;
  instructions: string;
  skillMetadata: SkillMetadata;
  references: Record<string, string>;
  assets: Record<string, string>;

  // Layer 2: Aitana platform metadata
  skillId: string;
  slug?: string | null;
  displayName: string;
  avatar: string;
  ownerEmail: string;
  ownerId: string;
  accessControl: AccessControl;
  protocols: Protocols;
  initialMessage: string;
  tags: string[];
  featured: boolean;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
  v5AssistantId?: string | null;
  // v6.4.0 4.5 SKILL-ONBOARDING — per-skill onboarding affordances
  // (intro_message, example_documents, sidebar bucket browser).
  // Optional / nullable; legacy skills omit this. See
  // docs/design/v6.4.0/skill-onboarding.md.
  welcome?: WelcomeConfig | null;
  // v6.4.0 SHELL-MODES — per-skill page-level shell shape. Optional /
  // nullable; null/missing → chat-primary (ChatShell). See
  // docs/design/v6.4.0/skill-driven-shell-modes.md.
  shell?: SkillShell | null;
}

// === v6.4.0 4.5 SKILL-ONBOARDING types ============================

export interface ExampleDocument {
  bucket: string;
  object: string;
  label: string;
  thumbnail?: string | null;
  summary?: string | null;
}

export interface BucketBrowserConfig {
  bucket: string;
  rootPath?: string;
  label?: string;
  defaultOpen?: boolean;
}

export interface WelcomeConfig {
  introMessage?: string | null;
  exampleDocuments?: ExampleDocument[];
  bucketBrowser?: BucketBrowserConfig | null;
}

// === v6.4.0 SHELL-MODES types =====================================

export type ShellMode = "chat-primary" | "doc-compare" | "workbench-primary" | "custom";

export type ShellChatPosition = "column" | "right-drawer" | "left-drawer" | "floating" | "hidden";

export type ShellChatState = "open" | "minimised" | "hidden";

export interface ShellChat {
  position?: ShellChatPosition;
  defaultState?: ShellChatState;
}

export interface ShellWorkbenchTab {
  id: string;
  label: string;
  contentSource: string; // "a2ui:<surface>" | "mcp_app:<server>" | "fixed:<component>"
  defaultActive?: boolean;
}

export interface ShellWorkbench {
  defaultTab?: string | null;
  tabs?: ShellWorkbenchTab[];
}

export interface SkillShell {
  mode: ShellMode;
  chat?: ShellChat;
  workbench?: ShellWorkbench | null;
}
