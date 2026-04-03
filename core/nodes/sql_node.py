"""SQL node — generates SQL for the current causal node."""
from __future__ import annotations
import re
from knowledge.workspace import Workspace
from knowledge.vanna_store import get_vanna as _get_vanna_for_workspace


def _find_node(causal: dict, node_id: str) -> dict | None:
    """Search all scenarios in causal_graph for the node with matching id."""
    for scenario in causal.get("scenarios", []):
        for node in scenario.get("nodes", []):
            if node.get("id") == node_id:
                return node
    return None


def _prev_period(period: str) -> str:
    """Return the previous month period string (YYYYMM - 1 month)."""
    try:
        year, month = int(period[:4]), int(period[4:6])
        month -= 1
        if month == 0:
            month = 12
            year -= 1
        return f"{year}{month:02d}"
    except Exception:
        return period


def _apply_filters(sql: str, filters: dict) -> str:
    """Naively append extra WHERE conditions for any filters not already in SQL."""
    for field, value in filters.items():
        # Skip if the field name already appears literally in the SQL
        if field in sql:
            continue
        # Append as AND clause before any ORDER/GROUP/LIMIT or at the end
        clause = f" AND {field} = '{value}'"
        for keyword in (" ORDER ", " GROUP ", " LIMIT ", " HAVING "):
            idx = sql.upper().find(keyword)
            if idx != -1:
                sql = sql[:idx] + clause + sql[idx:]
                break
        else:
            sql = sql.rstrip(";") + clause
    return sql


def sql_node(state: dict) -> dict:
    ws: Workspace = Workspace.get(state["workspace"])
    causal = ws.get_engine_graph()
    current_node_id: str = state.get("current_node", "")
    intent: dict = state.get("intent", {})
    current_period = ws.current_period
    last_period = _prev_period(current_period)

    node_cfg = _find_node(causal, current_node_id)

    if node_cfg and node_cfg.get("metric_sql"):
        # Use the template SQL from the causal graph
        sql = node_cfg["metric_sql"]
        sql = sql.replace("{current_period}", current_period)
        sql = sql.replace("{last_period}", last_period)
        # Apply any dynamic filters from intent
        filters: dict = intent.get("filters", {})
        if filters:
            sql = _apply_filters(sql, filters)
    else:
        # Fallback: use Vanna for ad-hoc generation
        vn = _get_vanna_for_workspace(ws)
        schema_hint = str(ws.get_schema_dict())
        generated = vn.generate_sql(state.get("question", ""), schema_hint=schema_hint) if vn else None
        if generated:
            sql = generated
        else:
            sql = f"-- No SQL template found for node '{current_node_id}' and Vanna unavailable"

    return {"sql": sql}
