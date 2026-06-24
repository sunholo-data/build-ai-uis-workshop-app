"""Admin routes for client/tenant management.

Manages `clients/{domain}` Firestore records — the per-client GCS bucket
mapping read by db/clients.py on every document upload. Gated on the
`aitana-admin` Firebase group tag (human-caller JWT, not the SA-allowlist
guard used by the seed endpoint in admin/auth.py).
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException  # Depends used inside Annotated[]
from pydantic import BaseModel

from auth import User, get_current_user
from db.clients import ClientConfig
from db.firestore import delete_document, get_document, query_documents, set_document

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/clients", tags=["admin-clients"])

_COLLECTION = "clients"


def _require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if "aitana-admin" not in user.group_tags:
        raise HTTPException(status_code=403, detail="aitana-admin group required")
    return user


_Admin = Annotated[User, Depends(_require_admin)]


# ---------------------------------------------------------------------------
# Non-admin: the caller's own resolved client config (v6.5.0 AUTH-LANDING)
# ---------------------------------------------------------------------------

me_router = APIRouter(prefix="/api/clients", tags=["clients"])


class ClientMeResponse(BaseModel):
    """The caller's resolved client config — the subset the frontend needs to
    decide the authenticated landing target. Deliberately omits
    `documents_bucket` (internal) so this non-admin endpoint leaks nothing
    sensitive."""

    domain: str
    display_name: str = ""
    enabled_skills: list[str] | None = None
    default_skill: str | None = None


@me_router.get("/me", response_model=ClientMeResponse)
def get_my_client(user: Annotated[User, Depends(get_current_user)]) -> ClientMeResponse:
    """Resolve the caller's tenant config from their email domain. `default_skill`
    applies the enabled_skills[0] fallback so the frontend gets the effective
    primary skill. Returns empty defaults for unmapped domains."""
    from db.clients import _user_domain, get_client_sync, resolve_default_skill

    domain = _user_domain(user)
    client = get_client_sync(domain) if domain else None
    return ClientMeResponse(
        domain=domain,
        display_name=client.display_name if client else "",
        enabled_skills=client.enabled_skills if client else None,
        default_skill=resolve_default_skill(user),
    )


class ClientConfigUpdate(BaseModel):
    documents_bucket: str | None = None
    display_name: str = ""
    # v6.4.0 ONE-DEMO M1: per-tenant skill visibility filter (additive nullable).
    # None = unchanged for the upsert merge. Non-empty list = filter active.
    # Empty list intentionally collapses to None — "no skills enabled" wouldn't
    # be a useful tenant state; clear via null instead.
    enabled_skills: list[str] | None = None
    # Domain-derived group tags merged into the JWT's groupTags claim at
    # request time (see auth.firebase_auth._apply_derived_group_tags). Same
    # null-vs-empty-list semantics as enabled_skills.
    derived_group_tags: list[str] | None = None
    # v6.5.0 AUTH-LANDING: skill slug a signed-in user lands on with no prior
    # chat. None leaves it unchanged on merge (same as the other fields).
    default_skill: str | None = None


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ClientConfig])
def list_clients(admin: _Admin) -> list[ClientConfig]:
    docs = query_documents(_COLLECTION)
    configs = []
    for d in docs:
        domain = d.pop("__id", "")
        d.pop("domain", None)
        configs.append(ClientConfig(domain=domain, **d))
    log.info("admin.clients: list by uid=%s count=%d", admin.uid, len(configs))
    return configs


# ---------------------------------------------------------------------------
# Get one
# ---------------------------------------------------------------------------


@router.get("/{domain}", response_model=ClientConfig)
def get_client(domain: str, admin: _Admin) -> ClientConfig:
    data = get_document(_COLLECTION, domain)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Client {domain!r} not found")
    data.pop("domain", None)
    return ClientConfig(domain=domain, **data)


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------


@router.put("/{domain}", response_model=ClientConfig)
def upsert_client(
    domain: str,
    body: ClientConfigUpdate,
    admin: _Admin,
) -> ClientConfig:
    # exclude_unset → a partial PUT only writes the fields the caller actually
    # sent, so `set --default-skill X` can't null out enabled_skills /
    # derived_group_tags / documents_bucket on the merge. Clearing a field is
    # still possible by sending it explicitly as null.
    data = body.model_dump(exclude_unset=True)
    # An empty enabled_skills list is semantically equivalent to None (no
    # filter). The CLI's `--enabled-skills ""` flow already maps "" → None,
    # but defend in depth in case the API is called directly.
    if data.get("enabled_skills") == []:
        data["enabled_skills"] = None
    if data.get("derived_group_tags") == []:
        data["derived_group_tags"] = None
    set_document(_COLLECTION, domain, data, merge=True)
    log.info(
        "admin.clients: upsert domain=%s by uid=%s enabled_skills_count=%s derived_tags_count=%s",
        domain,
        admin.uid,
        len(data.get("enabled_skills") or []),
        len(data.get("derived_group_tags") or []),
    )
    return ClientConfig(domain=domain, **data)


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


@router.delete("/{domain}", response_model=ClientConfig)
def delete_client(domain: str, admin: _Admin) -> ClientConfig:
    data = get_document(_COLLECTION, domain)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Client {domain!r} not found")
    delete_document(_COLLECTION, domain)
    log.info("admin.clients: delete domain=%s by uid=%s", domain, admin.uid)
    data.pop("domain", None)
    return ClientConfig(domain=domain, **data)
