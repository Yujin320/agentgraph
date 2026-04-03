"""
Scenario endpoints — derived from Neo4j KG (Scenario nodes + ENTRY_POINT edges).

GET /scenarios/{ws}                         — List all scenarios
GET /scenarios/{ws}/{scenario_id}           — Scenario config with stages
GET /scenarios/{ws}/{scenario_id}/kpis      — KPI values from workspace DB
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from backend.config import settings
from knowledge.workspace import Workspace

router = APIRouter(tags=["scenarios"])


def _get_ws(ws: str) -> Workspace:
    try:
        return Workspace.get(ws)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


def _neo4j_driver():
    from neo4j import GraphDatabase
    return GraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/scenarios/{ws}")
def list_scenarios(ws: str):
    """
    List all Scenario nodes from Neo4j for the workspace.
    Returns [{id, title, description, entry_metrics: [...]}].
    Falls back to workspace scenarios/ JSON files if Neo4j is unavailable.
    """
    workspace = _get_ws(ws)

    # Try Neo4j first
    try:
        driver = _neo4j_driver()
        with driver.session() as session:
            records = session.run(
                """
                MATCH (s:Scenario {workspace: $ws})
                OPTIONAL MATCH (s)-[:ENTRY_POINT]->(m:Metric)
                RETURN s, collect(m.id) AS entry_metrics
                """,
                ws=ws,
            ).data()
        driver.close()

        result = []
        for rec in records:
            sn = rec["s"]
            props = dict(sn.items()) if hasattr(sn, "items") else sn
            result.append({
                "id": props.get("id", ""),
                "title": props.get("name") or props.get("title", ""),
                "description": props.get("description", ""),
                "entry_metrics": rec.get("entry_metrics") or [],
            })
        if result:
            return result
    except Exception:
        pass  # Fall through to file-based fallback

    # Fallback: workspace scenarios/*.json files
    scenarios = workspace.get_scenarios()
    return [
        {
            "id": sc.get("id", sc.get("scenario_id", "")),
            "title": sc.get("title", ""),
            "description": sc.get("description", ""),
            "entry_metrics": [kpi.get("id", kpi.get("label", "")) for kpi in sc.get("kpis", [])],
        }
        for sc in scenarios
    ]


@router.get("/scenarios/{ws}/{scenario_id}")
def get_scenario(ws: str, scenario_id: str):
    """Return scenario config (with stages if available) for a given scenario."""
    workspace = _get_ws(ws)

    # Try Neo4j for scenario metadata
    neo4j_data: dict[str, Any] = {}
    try:
        driver = _neo4j_driver()
        with driver.session() as session:
            rec = session.run(
                """
                MATCH (s:Scenario {workspace: $ws, id: $sid})
                OPTIONAL MATCH (s)-[:ENTRY_POINT]->(m:Metric)
                RETURN s, collect(m.id) AS entry_metrics
                """,
                ws=ws,
                sid=scenario_id,
            ).single()
        driver.close()
        if rec:
            sn = rec["s"]
            props = dict(sn.items()) if hasattr(sn, "items") else sn
            neo4j_data = {
                "id": props.get("id", scenario_id),
                "title": props.get("name") or props.get("title", ""),
                "description": props.get("description", ""),
                "entry_metrics": rec.get("entry_metrics") or [],
            }
    except Exception:
        pass

    # Merge with file-based config if available
    for sc in workspace.get_scenarios():
        sc_id = sc.get("id") or sc.get("scenario_id", "")
        if sc_id == scenario_id:
            merged = {**sc, **neo4j_data} if neo4j_data else sc
            return merged

    if neo4j_data:
        return neo4j_data

    raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found in workspace '{ws}'")


@router.get("/scenarios/{ws}/{scenario_id}/kpis")
def get_kpis(ws: str, scenario_id: str):
    """
    For each entry metric in the scenario, execute a simple aggregation SQL
    against the workspace DB and return KPI values.
    """
    workspace = _get_ws(ws)

    # Collect entry metrics from Neo4j
    metrics: list[dict] = []
    try:
        driver = _neo4j_driver()
        with driver.session() as session:
            records = session.run(
                """
                MATCH (s:Scenario {workspace: $ws, id: $sid})-[:ENTRY_POINT]->(m:Metric)
                RETURN m
                """,
                ws=ws,
                sid=scenario_id,
            ).data()
        driver.close()
        for rec in records:
            m = rec["m"]
            props = dict(m.items()) if hasattr(m, "items") else m
            metrics.append(props)
    except Exception:
        pass

    # Fallback: use kpis from scenario file
    if not metrics:
        for sc in workspace.get_scenarios():
            sc_id = sc.get("id") or sc.get("scenario_id", "")
            if sc_id == scenario_id:
                # Return file-based KPIs directly (they may have pre-built SQL)
                return _run_file_kpis(workspace, sc.get("kpis", []))
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found in workspace '{ws}'")

    # Execute aggregation SQL for each Neo4j metric
    results = []
    try:
        engine = workspace.get_engine()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    for m in metrics:
        table = m.get("table", "")
        col = m.get("column") or m.get("id", "")
        alias = m.get("alias") or m.get("id", "")
        metric_id = m.get("id", "")
        value = None
        error = None

        if table and col:
            # Derive column name from metric id if needed
            # e.g. metric_sales_delivery_deliv_qty_mt → deliv_qty_mt
            sql = f"SELECT ROUND(SUM({col}), 2) AS value FROM {table}"
            try:
                with engine.connect() as conn:
                    row = conn.execute(text(sql)).fetchone()
                    value = row[0] if row else None
            except Exception as exc:
                error = str(exc)
                # Try using the last part of the metric id as column
                col_guess = metric_id.split("_")[-1] if "_" in metric_id else col
                if col_guess != col:
                    try:
                        sql = f"SELECT ROUND(SUM({col_guess}), 2) AS value FROM {table}"
                        with engine.connect() as conn:
                            row = conn.execute(text(sql)).fetchone()
                            value = row[0] if row else None
                            error = None
                    except Exception:
                        pass
        else:
            error = "Missing table or column info in metric node"

        results.append({
            "id": metric_id,
            "label": alias,
            "value": value,
            "table": table,
            "column": col,
            "error": error,
        })

    return results


def _run_file_kpis(workspace: Workspace, kpis: list[dict]) -> list:
    """Execute pre-built SQL KPIs from scenario file."""
    results = []
    try:
        engine = workspace.get_engine()
    except ValueError:
        return kpis

    for kpi in kpis:
        sql = kpi.get("sql", "")
        value = None
        error = None
        if sql:
            try:
                with engine.connect() as conn:
                    row = conn.execute(text(sql)).fetchone()
                    if row:
                        val_col = kpi.get("value_col", "v")
                        # row may be tuple or mapping
                        try:
                            value = row._mapping.get(val_col, row[0])
                        except Exception:
                            value = row[0]
                        if hasattr(value, "item"):
                            value = value.item()
            except Exception as exc:
                error = str(exc)

        results.append({
            "label": kpi.get("label", ""),
            "value": value,
            "format": kpi.get("format", "{}"),
            "help": kpi.get("help", ""),
            "error": error,
        })
    return results
