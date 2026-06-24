"""
Aitana Platform v6 — Root agent definition.

This is the ADK agent entry point. The ADK framework discovers this file
and creates the agent + app from it.

Individual skills create sub-agents; this root agent delegates to them.

Workshop W2a — ADK: The Foundation
  The entire agent is declared here: a name, a model, an instruction, and a
  tool list. No orchestration loop, no retry logic, no token counting. ADK
  handles all of that. Sub-agents are populated at runtime from Firestore
  skill configs via the factory in adk/agent.py (W2b).
"""

import os

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.genai import types

from adk.artifact_tools import retrieve_artifact
from adk.session import get_compaction_config
from config.gcp import resolve_gcp_project

# Fallback project keeps module import working on CI runners (no env vars,
# no ADC) — the resolver returns None there. Override via PLATFORM_DEFAULT_PROJECT
# in a downstream fork; default stays Aitana's dev project so existing
# dev/test/prod behaviour is unchanged.
_FALLBACK_PROJECT = os.environ.get("PLATFORM_DEFAULT_PROJECT", "aitana-multivac-dev")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", resolve_gcp_project() or _FALLBACK_PROJECT)
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "True")


# --- Root agent ---
# The root agent delegates to skill-specific sub-agents.
# In v6, each skill becomes a sub-agent created from its Firestore config.

root_agent = Agent(
    name="aitana",
    model=Gemini(
        model="gemini-2.5-flash",
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction=(
        "You are Aitana, a helpful AI assistant. "
        "You can help with document analysis, search, data extraction, and more. "
        "Use your available tools to assist the user."
    ),
    tools=[retrieve_artifact],  # Tools added dynamically from skill config
    sub_agents=[],  # Sub-agents added dynamically from skill config
)


# G46 M3: org-scoped bucket tools — conditionally attached to the root agent
# when A2A_AGENT_DOCUMENTS_BUCKET is set. Gives peer agents (and the
# orchestrator) the ability to discover + load documents from this deploy's
# bound GCS workspace. Both tools degrade gracefully (return [] / ok=False)
# when the env var is unset OR the SA lacks roles/storage.objectViewer, so
# wiring them unconditionally would also be safe — we gate on env so the
# agent's tool list doesn't grow for deploys that don't use the feature
# (keeps Gemini's tool-call decisions tighter).
if os.environ.get("A2A_AGENT_DOCUMENTS_BUCKET"):
    from tools.org_documents import list_org_documents, read_org_document

    root_agent.tools.extend([list_org_documents, read_org_document])


app = App(
    root_agent=root_agent,
    name="aitana_platform",
    events_compaction_config=get_compaction_config("gemini-2.5-flash"),
)
