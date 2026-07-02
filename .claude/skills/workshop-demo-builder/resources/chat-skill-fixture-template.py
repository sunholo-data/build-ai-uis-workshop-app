# TEMPLATE — a new workshop CHAT skill (appears at /chat/@workshop-user/<slug>).
#
# A chat skill is a real platform skill: an agent the user chats with in the
# product. It lives as a dict returned by `_demo_skills(now)` in
#   backend/db/local_fixture.py
# Add your entry to that list (don't create a new file). Two shapes below —
# an A2UI skill and an MCP Apps skill. Copy the one you need, fill the slots.
#
# After adding it: restart `make dev-local`. The seeder only runs when the
# skills collection is EMPTY (`if not skills:`), and LOCAL_MODE's store is
# in-memory and resets on boot — so a fresh boot re-seeds with your new skill.
#
# Then open:  http://localhost:3456/chat/@workshop-user/<your-slug>
# The live agent turn needs a Gemini key — set GOOGLE_API_KEY (+ optionally
# GOOGLE_GENAI_USE_VERTEXAI=false) in backend/.env; `make dev-local` loads it.


# ── A2UI chat skill ────────────────────────────────────────────────────────
# Spreads `base` (owner, public access, model gemini-flash-lite-latest,
# tools: []). A2UI emission needs NO tool declared — send_a2ui_json_to_client
# is available to every skill (see demo-form-builder, which uses base's
# tools: []). The instructions must tell the agent the EXACT A2UI v0.9 tree to
# emit; the same contract + gotchas as a /dev seed apply (createSurface = only
# surfaceId + catalogId; root id "root"; updateDataModel = {surfaceId, path,
# value}; Text variant "caption" renders an illegal <caption> — use body/h1-h5).
MY_A2UI_CHAT_SKILL = {
    # **base,   ← in local_fixture.py, spread base first, then override:
    "skillId": "my-a2ui-skill",
    "slug": "my-a2ui-skill",  # → /chat/@workshop-user/my-a2ui-skill
    "displayName": "My A2UI Skill",
    "name": "my-a2ui-skill",
    "description": (
        "Workshop demo: emits A2UI declarative UI. Ask for X and it returns a "
        "renderable <thing> definition."
    ),
    "instructions": (
        "You render <thing> as A2UI for the user. When they ask, emit ONE "
        "send_a2ui_json_to_client tool call with an array of A2UI v0.9 "
        "messages: a createSurface (surfaceId + catalogId only), an "
        "updateComponents (root Column id 'root' + your Text/TextField/Button "
        "nodes), and an updateDataModel ({surfaceId, path:'/', value:{...}}). "
        "Bind fields with value/text {path:'/foo'}. Keep chat replies short."
    ),
    "initialMessage": "Tell me what to build and I'll render it right here.",
}


# ── MCP Apps chat skill ────────────────────────────────────────────────────
# Needs its OWN skillMetadata (not base's) so the MCP toolset is wired:
#   tools: ["mcp"]                         → triggers resolve_mcp_tools
#   toolConfigs.mcp.servers: ["<id>"]      → which mcp_servers/{id} doc to load
#   toolConfigs.mcp.allow_context_writes   → accept the widget's write-back
# The mcp_servers/{id} doc must be seeded in seed_local_fixture() (see the
# "local-demo" one pointing at http://127.0.0.1:3001/mcp). Reuse "local-demo"
# unless you stood up your own server.
MY_MCP_CHAT_SKILL = {
    "ownerId": "workshop-user",            # or: **base then override skillMetadata
    "ownerEmail": "workshop@local",
    "accessControl": {"type": "public"},
    "skillMetadata": {
        "author": "aitana",
        "version": "1.0",
        "model": "gemini-flash-lite-latest",
        "tools": ["mcp"],
        "toolConfigs": {
            "mcp": {
                "servers": ["local-demo"],
                "allow_context_writes": ["local-demo"],
            }
        },
        "subSkills": [],
    },
    "tags": ["workshop", "demo"],
    "featured": True,
    "usageCount": 0,
    # createdAt / updatedAt: set to `now` in local_fixture.py
    "skillId": "my-mcp-skill",
    "slug": "my-mcp-skill",                # → /chat/@workshop-user/my-mcp-skill
    "displayName": "My MCP App Skill",
    "name": "my-mcp-skill",
    "description": (
        "Workshop demo: renders an interactive MCP App widget inline in chat "
        "from the bundled local server."
    ),
    "instructions": (
        "When the user asks to see the demo/widget, call the <tool-name> MCP "
        "tool once — it mounts the widget in an iframe in the chat. Then tell "
        "them to interact with it; their actions stream back over the "
        "model-context channel. Keep replies under 3 sentences."
    ),
    "initialMessage": "Try: 'show me the widget' — I'll render it right here.",
}

# Requires (for the live widget): make dev-local (MCP server :3001 + sandbox
# :3457) AND a Gemini key so the agent can decide to call the tool.
