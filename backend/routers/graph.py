"""
Knowledge Graph endpoints — structured causal graph data from Neo4j,
formatted for ECharts DAG visualization.

GET /graph/{ws} — Full KG as layered DAG for the CausalGraph page
"""
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException

from backend.config import settings
from knowledge.workspace import Workspace

router = APIRouter(tags=["graph"])


def _get_ws(ws: str) -> Workspace:
    try:
        return Workspace.get(ws)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/graph/{ws}")
def get_graph(ws: str):
    """
    Return the full KG for a workspace in a structured format suitable for
    ECharts DAG visualization. Falls back to causal_graph.json if Neo4j is
    unavailable.
    """
    workspace = _get_ws(ws)

    # Try Neo4j
    try:
        from neo4j import GraphDatabase

        driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        with driver.session() as session:
            # Fetch all nodes
            node_records = session.run(
                "MATCH (n) WHERE n.workspace = $ws RETURN n, labels(n) AS labels",
                ws=ws,
            ).data()

            # Fetch all edges
            edge_records = session.run(
                """
                MATCH (a)-[r]->(b)
                WHERE a.workspace = $ws
                RETURN a.id AS source, b.id AS target, type(r) AS type, properties(r) AS props
                """,
                ws=ws,
            ).data()

            # Fetch scenarios with entry metrics
            scenario_records = session.run(
                """
                MATCH (s:Scenario {workspace: $ws})
                OPTIONAL MATCH (s)-[:ENTRY_POINT]->(m:Metric)
                RETURN s, collect(m.id) AS metrics
                """,
                ws=ws,
            ).data()

        driver.close()

        # Build structured nodes
        structured_nodes = []
        for record in node_records:
            n = record["n"]
            labels = record["labels"]
            node_type = labels[0] if labels else "Unknown"
            props = dict(n.items()) if hasattr(n, "items") else n
            structured_nodes.append({
                "id": props.get("id", ""),
                "label": props.get("alias") or props.get("name") or props.get("id", ""),
                "type": node_type,
                "table": props.get("table", ""),
                "description": props.get("description", ""),
            })

        # Build structured edges
        structured_edges = [
            {
                "source": e.get("source", ""),
                "target": e.get("target", ""),
                "type": e.get("type", ""),
            }
            for e in edge_records
        ]

        # Build structured scenarios
        structured_scenarios = []
        for rec in scenario_records:
            sn = rec["s"]
            props = dict(sn.items()) if hasattr(sn, "items") else sn
            structured_scenarios.append({
                "id": props.get("id", ""),
                "title": props.get("name") or props.get("title", ""),
                "description": props.get("description", ""),
                "entry_metrics": rec.get("metrics") or [],
            })

        # Causal chains from CAUSES edges
        causal_edges = [e for e in structured_edges if e["type"] == "CAUSES"]

        return {
            "nodes": structured_nodes,
            "edges": structured_edges,
            "scenarios": structured_scenarios,
            "causal_edges": causal_edges,
            "stats": {
                "total_nodes": len(structured_nodes),
                "total_edges": len(structured_edges),
                "metrics": sum(1 for n in structured_nodes if n["type"] == "Metric"),
                "dimensions": sum(1 for n in structured_nodes if n["type"] == "Dimension"),
                "tables": sum(1 for n in structured_nodes if n["type"] == "Table"),
                "scenarios": len(structured_scenarios),
            },
        }

    except ImportError:
        raise HTTPException(status_code=500, detail="neo4j driver not installed")
    except Exception as exc:
        # Fall back to causal_graph.json from workspace
        try:
            causal = workspace.get_causal_graph()
            return _causal_json_to_graph(causal)
        except Exception:
            raise HTTPException(
                status_code=503,
                detail=f"Neo4j unavailable and no causal_graph.json fallback: {exc}",
            )


def _causal_json_to_graph(causal: dict) -> dict:
    """Convert a causal_graph.json structure to the standard graph response format."""
    nodes = []
    edges = []
    scenarios_out = []
    seen_edges: set = set()

    for scenario in causal.get("scenarios", []):
        sc_id = scenario.get("id", "")
        entry_metrics = []
        for node in scenario.get("nodes", []):
            nid = node.get("id", "")
            nodes.append({
                "id": nid,
                "label": node.get("label", nid),
                "type": "Metric",
                "table": node.get("metric", ""),
                "description": node.get("description", ""),
            })
            for child_id in node.get("children", []):
                key = (nid, child_id)
                if key not in seen_edges:
                    edges.append({"source": nid, "target": child_id, "type": "CAUSES"})
                    seen_edges.add(key)
        if scenario.get("entry_node"):
            entry_metrics = [scenario["entry_node"]]
        scenarios_out.append({
            "id": sc_id,
            "title": scenario.get("title", sc_id),
            "description": scenario.get("description", ""),
            "entry_metrics": entry_metrics,
        })

    return {
        "nodes": nodes,
        "edges": edges,
        "scenarios": scenarios_out,
        "causal_edges": edges,
        "stats": {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "metrics": len(nodes),
            "dimensions": 0,
            "tables": 0,
            "scenarios": len(scenarios_out),
        },
    }
