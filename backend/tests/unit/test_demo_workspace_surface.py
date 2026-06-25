"""B2 exercise check — demo-workspace must route A2UI to the workspace surface.

The Round-B A2UI reconstruct blanks `default_surface` in the demo-workspace seed
(backend/db/local_fixture.py). Blanked → this test fails; restored → it passes.
See docs/exercises/a2ui.md.
"""

from __future__ import annotations


def test_demo_workspace_routes_to_workspace_surface():
    from db.local_fixture import _demo_skills

    skills = {s["skillId"]: s for s in _demo_skills(0.0)}
    assert "demo-workspace" in skills, "demo-workspace seed is missing"

    a2ui = skills["demo-workspace"]["skillMetadata"]["toolConfigs"]["a2ui"]
    assert a2ui.get("default_surface") == "workspace", (
        "demo-workspace must declare default_surface='workspace' so its A2UI "
        "renders in the workspace pane, not inline in chat. "
        "See docs/exercises/a2ui.md."
    )
