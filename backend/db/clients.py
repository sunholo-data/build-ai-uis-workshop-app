"""Client domain → GCS bucket resolution.

Each client organisation maps to its own GCS bucket, keyed by email domain.
Firestore `clients/{domain}` stores the mapping. Falls back to the
DOCUMENTS_BUCKET env var for unmapped domains (dev, internal users).
"""

from __future__ import annotations

import os

from pydantic import BaseModel, ConfigDict

from db.firestore import get_document

_COLLECTION = "clients"


class ClientConfig(BaseModel):
    """Firestore document at `clients/{domain}`."""

    domain: str
    documents_bucket: str | None = None
    display_name: str = ""
    # v6.4.0 ONE-DEMO M1: per-tenant skill visibility filter. None = all skills
    # visible (existing default). Non-empty list = only these skill slugs are
    # surfaced to the user via /api/skills. Defence-in-depth even when the
    # deployment is single-tenant (admin domains accidentally landing here
    # don't see ONE-internal skills if any are marked that way later).
    enabled_skills: list[str] | None = None
    # Domain-derived group tags unioned into the JWT's `groupTags` claim at
    # request time. Lets a deployment grant the `ONE` tag to every
    # acme-energy.example user without an admin running `set_custom_user_claims`
    # per signup. Tagged-access skills (type=tagged) become reachable to the
    # whole domain. None/empty = no derived tags.
    derived_group_tags: list[str] | None = None
    # v6.5.0 AUTH-LANDING: the skill slug a signed-in user lands on when they
    # have no prior chat to resume. None = fall back to enabled_skills[0], then
    # to the marketplace. Per-client; routing behaviour is platform-wide.
    default_skill: str | None = None

    model_config = ConfigDict(populate_by_name=True)


def get_client_sync(domain: str) -> ClientConfig | None:
    """Return the ClientConfig for a domain, or None if not found."""
    data = get_document(_COLLECTION, domain)
    if data is None:
        return None
    return ClientConfig(domain=domain, **data)


def _user_domain(user) -> str:  # type: ignore[no-untyped-def]
    """Extract the email domain from a User object, falling back to email parse."""
    domain = getattr(user, "domain", None)
    if domain:
        return domain
    email = getattr(user, "email", "") or ""
    return email.split("@")[1] if "@" in email else ""


def resolve_documents_bucket(user) -> str:  # type: ignore[no-untyped-def]
    """Return the GCS bucket name for the user's email domain.

    Looks up `clients/{domain}` in Firestore. Falls back to the
    DOCUMENTS_BUCKET env var when no mapping exists or the mapping
    has no documents_bucket set.
    """
    domain = _user_domain(user)
    client = get_client_sync(domain) if domain else None
    if client and client.documents_bucket:
        return client.documents_bucket
    return os.environ.get("DOCUMENTS_BUCKET", "aitana-documents-bucket")


def resolve_enabled_skills(user) -> list[str] | None:  # type: ignore[no-untyped-def]
    """Return the tenant's enabled-skills filter, or None for "all skills".

    Looks up `clients/{domain}.enabled_skills`. None = unfiltered (existing
    behaviour for unmapped domains and tenants without the field set).
    Used by `/api/skills` to filter the response server-side.
    """
    domain = _user_domain(user)
    if not domain:
        return None
    client = get_client_sync(domain)
    if client is None:
        return None
    return client.enabled_skills


def resolve_default_skill(user) -> str | None:  # type: ignore[no-untyped-def]
    """Return the skill slug a signed-in user should land on with no prior
    chat (v6.5.0 AUTH-LANDING), or None to fall back to the marketplace.

    Resolution: `clients/{domain}.default_skill`, else the first entry of
    `enabled_skills`, else None. Routing is platform-wide; this value is the
    per-client knob that focuses it.
    """
    domain = _user_domain(user)
    if not domain:
        return None
    client = get_client_sync(domain)
    if client is None:
        return None
    if client.default_skill:
        return client.default_skill
    if client.enabled_skills:
        return client.enabled_skills[0]
    return None


def resolve_derived_group_tags(domain: str) -> frozenset[str]:
    """Return tags the deployment grants to every user from this email domain.

    Read from `clients/{domain}.derived_group_tags`. Empty frozenset when no
    mapping or the field is unset. Called once per authenticated request from
    `get_current_user` and unioned with the JWT's `groupTags` claim.
    """
    if not domain:
        return frozenset()
    client = get_client_sync(domain)
    if client is None or not client.derived_group_tags:
        return frozenset()
    return frozenset(client.derived_group_tags)


def resolve_channel_bucket() -> str:
    """Return the GCS bucket for files arriving via channel webhooks.

    Channel attachments don't carry the user's email domain in a way
    the upload path can rely on (a Discord user might have no email at
    all), so we use a single shared bucket per deployment. Defaults
    to the same value as `resolve_documents_bucket`'s fallback so the
    "user library" view shows channel uploads alongside web uploads.

    Forks that want per-channel buckets (e.g., one for Discord, one
    for email) set CHANNEL_DOCUMENTS_BUCKET to override.
    """
    return os.environ.get("CHANNEL_DOCUMENTS_BUCKET") or os.environ.get("DOCUMENTS_BUCKET", "aitana-documents-bucket")
