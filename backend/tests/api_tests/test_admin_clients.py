"""API tests for /api/admin/clients — CRUD routes.

All Firestore calls are mocked. Tests exercise:
  - admin guard (aitana-admin group tag required)
  - list / get / upsert / delete happy paths
  - 404 on missing domain
  - 403 for non-admin on every route
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, get_current_user

_ADMIN = User(
    uid="admin-uid",
    email="mark@aitanalabs.com",
    domain="aitanalabs.com",
    group_tags=frozenset({"aitana-admin"}),
)
_NON_ADMIN = User(
    uid="user-uid",
    email="user@example.com",
    domain="example.com",
    group_tags=frozenset(),
)


def _make_app() -> FastAPI:
    from admin.clients import router

    app = FastAPI()
    app.include_router(router)
    return app


def _install_user(app: FastAPI, user: User) -> FastAPI:
    async def _override(request: Request) -> User:
        return user

    app.dependency_overrides[get_current_user] = _override
    return app


@pytest.fixture()
def admin_client() -> TestClient:
    return TestClient(_install_user(_make_app(), _ADMIN))


@pytest.fixture()
def nonadmin_client() -> TestClient:
    return TestClient(_install_user(_make_app(), _NON_ADMIN))


# ---------------------------------------------------------------------------
# LIST
# ---------------------------------------------------------------------------


def test_list_clients_admin_returns_200(admin_client: TestClient) -> None:
    docs = [
        {"__id": "acme-energy.example", "documents_bucket": "one-docs", "display_name": "Acme Energy"},
        {"__id": "acme.com", "documents_bucket": None, "display_name": ""},
    ]
    with patch("admin.clients.query_documents", return_value=docs):
        resp = admin_client.get("/api/admin/clients")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["domain"] == "acme-energy.example"
    assert data[0]["documents_bucket"] == "one-docs"
    assert data[1]["domain"] == "acme.com"


def test_list_clients_non_admin_returns_403(nonadmin_client: TestClient) -> None:
    with patch("admin.clients.query_documents", return_value=[]):
        resp = nonadmin_client.get("/api/admin/clients")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET one
# ---------------------------------------------------------------------------


def test_get_client_known_domain_returns_200(admin_client: TestClient) -> None:
    doc = {"documents_bucket": "one-docs", "display_name": "Acme Energy"}
    with patch("admin.clients.get_document", return_value=doc):
        resp = admin_client.get("/api/admin/clients/acme-energy.example")
    assert resp.status_code == 200
    body = resp.json()
    assert body["domain"] == "acme-energy.example"
    assert body["documents_bucket"] == "one-docs"


def test_get_client_unknown_domain_returns_404(admin_client: TestClient) -> None:
    with patch("admin.clients.get_document", return_value=None):
        resp = admin_client.get("/api/admin/clients/unknown.com")
    assert resp.status_code == 404


def test_get_client_non_admin_returns_403(nonadmin_client: TestClient) -> None:
    with patch("admin.clients.get_document", return_value={}):
        resp = nonadmin_client.get("/api/admin/clients/example.com")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# PUT (upsert)
# ---------------------------------------------------------------------------


def test_put_client_upserts_and_returns_config(admin_client: TestClient) -> None:
    payload = {"documents_bucket": "one-docs", "display_name": "Acme Energy"}
    with patch("admin.clients.set_document") as mock_set:
        resp = admin_client.put("/api/admin/clients/acme-energy.example", json=payload)
    assert resp.status_code == 200
    mock_set.assert_called_once()
    body = resp.json()
    assert body["domain"] == "acme-energy.example"
    assert body["documents_bucket"] == "one-docs"
    assert body["display_name"] == "Acme Energy"


def test_put_client_persists_derived_group_tags(admin_client: TestClient) -> None:
    """acme-energy.example → ['ONE'] is the demo seed: grant ONE tag to whole domain."""
    payload = {"derived_group_tags": ["ONE"]}
    with patch("admin.clients.set_document") as mock_set:
        resp = admin_client.put("/api/admin/clients/acme-energy.example", json=payload)
    assert resp.status_code == 200
    mock_set.assert_called_once()
    written = mock_set.call_args[0][2]
    assert written["derived_group_tags"] == ["ONE"]
    assert resp.json()["derived_group_tags"] == ["ONE"]


def test_put_client_empty_derived_group_tags_collapses_to_null(admin_client: TestClient) -> None:
    """[] is not a useful tenant state — collapse to None so the field clears."""
    payload = {"derived_group_tags": []}
    with patch("admin.clients.set_document") as mock_set:
        resp = admin_client.put("/api/admin/clients/acme-energy.example", json=payload)
    assert resp.status_code == 200
    written = mock_set.call_args[0][2]
    assert written["derived_group_tags"] is None


def test_put_client_partial_update_only_writes_sent_fields(admin_client: TestClient) -> None:
    """v6.5.0 AUTH-LANDING: a partial PUT (only default_skill) must NOT write
    None for unsent fields — otherwise merge=True would clobber an existing
    enabled_skills / derived_group_tags / documents_bucket."""
    payload = {"default_skill": "one-ppa-expert"}
    with patch("admin.clients.set_document") as mock_set:
        resp = admin_client.put("/api/admin/clients/acme-energy.example", json=payload)
    assert resp.status_code == 200
    written = mock_set.call_args[0][2]
    assert written["default_skill"] == "one-ppa-expert"
    assert "enabled_skills" not in written
    assert "derived_group_tags" not in written
    assert "documents_bucket" not in written
    assert "display_name" not in written


def test_put_client_default_skill_round_trips(admin_client: TestClient) -> None:
    payload = {"default_skill": "one-ppa-expert"}
    with patch("admin.clients.set_document"):
        resp = admin_client.put("/api/admin/clients/acme-energy.example", json=payload)
    assert resp.status_code == 200
    assert resp.json()["default_skill"] == "one-ppa-expert"


def test_put_client_non_admin_returns_403(nonadmin_client: TestClient) -> None:
    with patch("admin.clients.set_document"):
        resp = nonadmin_client.put("/api/admin/clients/example.com", json={})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


def test_delete_client_removes_record(admin_client: TestClient) -> None:
    existing = {"documents_bucket": "one-docs", "display_name": "Acme Energy"}
    with patch("admin.clients.get_document", return_value=existing), patch("admin.clients.delete_document") as mock_del:
        resp = admin_client.delete("/api/admin/clients/acme-energy.example")
    assert resp.status_code == 200
    mock_del.assert_called_once_with("clients", "acme-energy.example")


def test_delete_client_not_found_returns_404(admin_client: TestClient) -> None:
    with patch("admin.clients.get_document", return_value=None):
        resp = admin_client.delete("/api/admin/clients/unknown.com")
    assert resp.status_code == 404


def test_delete_client_non_admin_returns_403(nonadmin_client: TestClient) -> None:
    with patch("admin.clients.get_document", return_value={}), patch("admin.clients.delete_document"):
        resp = nonadmin_client.delete("/api/admin/clients/example.com")
    assert resp.status_code == 403
