"""Pydantic models for all entities.

These define the data contracts between backend components
and map directly to Firestore document schemas.

Skills follow the Agent Skills spec (agentskills.io/specification)
with Aitana platform metadata as a separate layer.
"""

from __future__ import annotations

import re
import time
import uuid

from pydantic import BaseModel, Field, field_validator

from db.models.access import AccessControl, AccessType
from db.models.buckets import BucketConfig, BucketFolderConfig

# Agent Skills spec: lowercase kebab-case, no leading/trailing/consecutive hyphens
_NAME_PATTERN = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")
_CONSECUTIVE_HYPHENS = re.compile(r"--")

# Slug: 3-60 chars, kebab-case, no leading/trailing hyphens.
_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")
# Words that would shadow Next.js routes or have reserved meaning in URLs.
RESERVED_SLUGS = frozenset({"new", "settings", "marketplace", "me", "api", "admin", "chat", "skill", "dev"})


# === Layer 1: Agent Skills Spec ===


class SkillMetadata(BaseModel):
    """Agent Skills spec metadata field — platform-specific config stored in SKILL.md frontmatter."""

    author: str = "aitana"
    version: str = "1.0"
    model: str = "gemini-2.5-flash"
    thinking_model: str | None = Field(default=None, alias="thinkingModel")
    tools: list[str] = []
    tool_configs: dict = Field(default_factory=dict, alias="toolConfigs")
    sub_skills: list[str] = Field(default_factory=list, alias="subSkills")

    model_config = {"populate_by_name": True}


# === Layer 2: Aitana Platform Metadata ===
# AccessControl now lives in db/models/access.py and is re-exported above so
# resource-access-control (1A.1b) can share the exact same schema.


class ProtocolConfig(BaseModel):
    enabled: bool = False


class Protocols(BaseModel):
    mcp: ProtocolConfig = ProtocolConfig()
    a2a: ProtocolConfig = ProtocolConfig()
    agui: ProtocolConfig = ProtocolConfig(enabled=True)
    a2ui: ProtocolConfig = ProtocolConfig()
    mcpApps: ProtocolConfig = ProtocolConfig()


# === v6.4.0 4.5 SKILL-ONBOARDING: per-skill welcome / onboarding affordances ===


class ExampleDocument(BaseModel):
    """One pre-loaded example document a skill offers in its WorkbenchPane
    Workspace tab when a chat is fresh. Click → existing doc-import-by-reference
    path (no upload). See docs/design/v6.4.0/skill-onboarding.md."""

    bucket: str
    object: str
    label: str
    thumbnail: str | None = None
    summary: str | None = None

    model_config = {"populate_by_name": True}


class BucketBrowserConfig(BaseModel):
    """Sidebar bucket-browser config — mounts a GCSFileBrowser in the
    sidebar as a 3rd SidebarSection when set. SA must have read access
    to the bucket (existing v6.3.0 client-tenant-management grants)."""

    bucket: str
    root_path: str = Field(default="", alias="rootPath")
    label: str = ""
    default_open: bool = Field(default=False, alias="defaultOpen")

    model_config = {"populate_by_name": True}


class WelcomeConfig(BaseModel):
    """Per-skill onboarding config — intro greeting, example documents,
    sidebar bucket browser. All fields optional and nullable; older skills
    without `welcome` round-trip unchanged. See
    docs/design/v6.4.0/skill-onboarding.md for the full schema and rationale."""

    intro_message: str | None = Field(default=None, alias="introMessage")
    example_documents: list[ExampleDocument] = Field(default_factory=list, alias="exampleDocuments")
    bucket_browser: BucketBrowserConfig | None = Field(default=None, alias="bucketBrowser")

    model_config = {"populate_by_name": True}


# === v6.4.0 SHELL-MODES: per-skill page-level shell shape ===


class ShellChat(BaseModel):
    """How the chat surface is presented within a shell. `column` is the
    classic ChatShell middle column; the drawer positions are used by the
    doc-compare / workbench-primary shells where chat is secondary."""

    position: str = "column"  # column | right-drawer | left-drawer | floating | hidden
    default_state: str = Field(default="open", alias="defaultState")  # open | minimised | hidden

    model_config = {"populate_by_name": True}

    @field_validator("position")
    @classmethod
    def _validate_position(cls, v: str) -> str:
        allowed = {"column", "right-drawer", "left-drawer", "floating", "hidden"}
        if v not in allowed:
            raise ValueError(f"chat.position must be one of {sorted(allowed)}")
        return v

    @field_validator("default_state")
    @classmethod
    def _validate_default_state(cls, v: str) -> str:
        allowed = {"open", "minimised", "hidden"}
        if v not in allowed:
            raise ValueError(f"chat.default_state must be one of {sorted(allowed)}")
        return v


class ShellWorkbenchTab(BaseModel):
    """A statically-declared workbench tab whose content is bound to a
    protocol-emitted surface. `content_source` is `a2ui:<surface>`,
    `mcp_app:<server>`, or `fixed:<component>` (the last is a v6.5 hook)."""

    id: str
    label: str
    content_source: str = Field(alias="contentSource")
    default_active: bool = Field(default=False, alias="defaultActive")

    model_config = {"populate_by_name": True}


class ShellWorkbench(BaseModel):
    """Optional workbench config for workbench-primary shells. Tabs may also
    be derived from A2UI surface emissions at runtime when none are declared."""

    default_tab: str | None = Field(default=None, alias="defaultTab")
    tabs: list[ShellWorkbenchTab] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class SkillShell(BaseModel):
    """Page-level shell shape a skill declares in SKILL.md frontmatter. When a
    skill leaves `shell` null, the platform renders the chat-primary ChatShell
    (the post-4.3 layout). `custom` is accepted but resolves to ChatShell in
    v1; a registry hook is a v6.5 follow-up. See
    docs/design/v6.4.0/skill-driven-shell-modes.md."""

    mode: str = "chat-primary"  # chat-primary | doc-compare | workbench-primary | custom
    chat: ShellChat = Field(default_factory=ShellChat)
    workbench: ShellWorkbench | None = None

    model_config = {"populate_by_name": True}

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, v: str) -> str:
        allowed = {"chat-primary", "doc-compare", "workbench-primary", "custom"}
        if v not in allowed:
            raise ValueError(f"shell.mode must be one of {sorted(allowed)}")
        return v


# === Combined Skill Document ===


class SkillConfig(BaseModel):
    """Firestore document model for a skill.

    Layer 1 (Agent Skills spec): name, description, instructions,
    skill_metadata, references, assets.

    Layer 2 (Aitana metadata): skill_id, display_name, avatar,
    owner_email, access_control, protocols, tags, etc.
    """

    # --- Agent Skills spec fields (Layer 1) ---
    name: str
    description: str = ""
    instructions: str = ""
    skill_metadata: SkillMetadata = Field(default_factory=SkillMetadata, alias="skillMetadata")
    references: dict[str, str] = Field(default_factory=dict)
    assets: dict[str, str] = Field(default_factory=dict)

    # --- Aitana platform metadata (Layer 2) ---
    skill_id: str = Field(default_factory=lambda: str(uuid.uuid4()), alias="skillId")
    slug: str | None = None
    display_name: str = Field(default="", alias="displayName")
    avatar: str = ""
    owner_email: str = Field(default="", alias="ownerEmail")
    owner_id: str = Field(default="", alias="ownerId")
    access_control: AccessControl = Field(default_factory=AccessControl, alias="accessControl")
    protocols: Protocols = Field(default_factory=Protocols)
    initial_message: str = Field(default="", alias="initialMessage")
    tags: list[str] = Field(default_factory=list)
    featured: bool = False
    usage_count: int = Field(default=0, alias="usageCount")
    created_at: float = Field(default_factory=time.time, alias="createdAt")
    updated_at: float = Field(default_factory=time.time, alias="updatedAt")
    v5_assistant_id: str | None = Field(default=None, alias="v5AssistantId")
    # v6.4.0 4.5 SKILL-ONBOARDING: per-skill onboarding affordances.
    # Optional / nullable / additive — legacy skills round-trip unchanged.
    welcome: WelcomeConfig | None = None
    # v6.4.0 SHELL-MODES: per-skill page-level shell shape. None = chat-primary
    # (existing ChatShell). Optional / nullable / additive.
    shell: SkillShell | None = None

    model_config = {"populate_by_name": True}

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not v or len(v) > 64:
            raise ValueError("name must be 1-64 characters")
        if not _NAME_PATTERN.match(v) or _CONSECUTIVE_HYPHENS.search(v):
            raise ValueError(
                "name must be lowercase kebab-case (a-z, 0-9, hyphens), no leading, trailing, or consecutive hyphens"
            )
        return v

    @field_validator("description")
    @classmethod
    def _validate_description(cls, v: str) -> str:
        if not v:
            raise ValueError("description must not be empty (1-1024 characters)")
        if len(v) > 1024:
            raise ValueError("description must be at most 1024 characters")
        return v

    @field_validator("instructions")
    @classmethod
    def _validate_instructions(cls, v: str) -> str:
        if len(v) > 10_000:
            raise ValueError("instructions must be at most 10,000 characters")
        return v

    @field_validator("slug")
    @classmethod
    def _validate_slug(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not _SLUG_PATTERN.match(v):
            raise ValueError(
                "slug must be 3-60 chars, lowercase kebab-case (a-z, 0-9, hyphens), no leading or trailing hyphens"
            )
        if v in RESERVED_SLUGS:
            raise ValueError(f"slug '{v}' is reserved")
        return v

    @field_validator("tags")
    @classmethod
    def _validate_tags(cls, v: list[str]) -> list[str]:
        if len(v) > 10:
            raise ValueError("maximum 10 tags")
        for tag in v:
            if len(tag) > 50:
                raise ValueError(f"tag '{tag[:20]}...' exceeds 50 characters")
        return v


# === Other entities ===


class Message(BaseModel):
    message_id: str = Field(alias="messageId")
    role: str  # "user" | "assistant" | "system"
    content: str
    timestamp: float
    metadata: dict = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class UserProfile(BaseModel):
    user_id: str = Field(alias="userId")
    email: str
    display_name: str = Field(default="", alias="displayName")
    created_at: float = Field(default=0, alias="createdAt")
    last_active: float = Field(default=0, alias="lastActive")
    rag_corpus_name: str | None = Field(default=None, alias="ragCorpusName")

    model_config = {"populate_by_name": True}


# === Document models (see db/models/document.py) ===

from db.models.document import (  # noqa: E402
    Block,
    BlockType,
    DocMetadata,
    DocSummary,
    DocumentStatus,
    EditedBlock,
    ParsedDocument,
)

__all__ = [
    "AccessControl",
    "AccessType",
    "Block",
    "BlockType",
    "BucketConfig",
    "BucketFolderConfig",
    "DocMetadata",
    "DocSummary",
    "DocumentStatus",
    "EditedBlock",
    "Message",
    "ParsedDocument",
    "ProtocolConfig",
    "Protocols",
    "SkillConfig",
    "SkillMetadata",
    "UserProfile",
]
