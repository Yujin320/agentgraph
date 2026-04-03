"""
Workspace management endpoints.

GET  /api/workspaces                    — list all workspaces
GET  /api/workspaces/{name}             — workspace metadata
GET  /api/workspaces/{name}/schema      — tables + fields from schema_dict.yaml
GET  /api/workspaces/{name}/graph       — causal graph nodes + edges
GET  /api/workspaces/{name}/examples    — few_shots examples
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from knowledge.workspace import Workspace

router = APIRouter(tags=["workspaces"])


def _get_ws(name: str) -> Workspace:
    try:
        return Workspace.get(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/workspaces")
def list_workspaces():
    """List all available workspace names."""
    names = Workspace.list_workspaces()
    result = []
    for name in names:
        try:
            ws = Workspace.get(name)
            result.append({
                "name": name,
                "title": ws.title,
                "description": ws.description,
            })
        except Exception:
            result.append({"name": name, "title": name, "description": ""})
    return result


@router.get("/workspaces/{name}")
def get_workspace(name: str):
    """Workspace metadata: title, description, scenarios, current_period."""
    ws = _get_ws(name)
    scenarios = []
    try:
        scenarios = ws.get_scenarios()
    except Exception:
        pass
    return {
        "name": ws.name,
        "title": ws.title,
        "description": ws.description,
        "current_period": ws.current_period,
        "scenarios": scenarios,
    }


@router.get("/workspaces/{name}/schema")
def get_workspace_schema(name: str):
    """Return the schema_dict.yaml as JSON (tables + fields with business rules)."""
    ws = _get_ws(name)
    try:
        schema = ws.get_schema_dict()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return schema


@router.get("/workspaces/{name}/graph")
def get_workspace_graph(name: str):
    """Return causal graph nodes and edges for the workspace."""
    ws = _get_ws(name)
    try:
        causal = ws.get_causal_graph()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    # Flatten all nodes and build edges from parent/children relationships
    nodes = []
    edges = []
    seen_edges: set = set()

    for scenario in causal.get("scenarios", []):
        for node in scenario.get("nodes", []):
            nodes.append({
                "id": node.get("id"),
                "label": node.get("label", node.get("id")),
                "scenario_id": scenario.get("id"),
                "scenario_title": scenario.get("title", ""),
                "metric": node.get("metric", ""),
                "threshold": node.get("threshold"),
                "description": node.get("description", ""),
            })
            for child_id in node.get("children", []):
                key = (node.get("id"), child_id)
                if key not in seen_edges:
                    edges.append({"source": node.get("id"), "target": child_id})
                    seen_edges.add(key)

    return {
        "scenarios": [
            {"id": s.get("id"), "title": s.get("title", ""), "entry_node": s.get("entry_node")}
            for s in causal.get("scenarios", [])
        ],
        "nodes": nodes,
        "edges": edges,
    }


@router.get("/workspaces/{name}/examples")
def get_workspace_examples(name: str):
    """Return few_shots examples for the workspace."""
    ws = _get_ws(name)
    try:
        few_shots = ws.get_few_shots()
    except FileNotFoundError:
        return []

    # few_shots.json may be a list or a dict with an "examples" key
    if isinstance(few_shots, list):
        return few_shots
    if isinstance(few_shots, dict):
        return few_shots.get("examples", few_shots.get("few_shots", []))
    return []
