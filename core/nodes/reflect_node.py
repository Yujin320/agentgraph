"""Reflect node — compares SQL result to threshold and decides next step."""
from __future__ import annotations
from knowledge.workspace import Workspace

_OPS = {
    "<":  lambda v, t: v < t,
    ">":  lambda v, t: v > t,
    "<=": lambda v, t: v <= t,
    ">=": lambda v, t: v >= t,
    "==": lambda v, t: v == t,
    "!=": lambda v, t: v != t,
}


def _find_node(causal: dict, node_id: str) -> dict | None:
    for scenario in causal.get("scenarios", []):
        for node in scenario.get("nodes", []):
            if node.get("id") == node_id:
                return node
    return None


def _extract_scalar(sql_result: dict):
    """Return the first column of the first row as a float, or None."""
    rows = sql_result.get("rows", [])
    if not rows or not rows[0]:
        return None
    try:
        return float(rows[0][0])
    except (TypeError, ValueError):
        return None


def reflect_node(state: dict) -> dict:
    ws: Workspace = Workspace.get(state["workspace"])
    causal = ws.get_engine_graph()
    current_node_id: str = state.get("current_node", "")
    sql_result: dict = state.get("sql_result", {})

    node_cfg = _find_node(causal, current_node_id)
    if not node_cfg:
        reflection = {
            "status": "error",
            "metric_value": None,
            "threshold": None,
            "threshold_desc": f"Node '{current_node_id}' not found in causal graph",
            "is_root_cause": True,
        }
        return _build_return(state, current_node_id, sql_result, reflection, done=True)

    threshold = node_cfg.get("threshold")
    threshold_op: str = node_cfg.get("threshold_op", "<")
    threshold_desc: str = node_cfg.get("threshold_desc", "")
    children: list = node_cfg.get("children", [])

    metric_value = _extract_scalar(sql_result)

    # Determine status
    if metric_value is None:
        status = "error"
    elif threshold is not None and threshold_op in _OPS:
        status = "abnormal" if _OPS[threshold_op](metric_value, threshold) else "normal"
    else:
        status = "normal"

    is_root_cause = status == "abnormal" and len(children) == 0

    reflection = {
        "status": status,
        "metric_value": metric_value,
        "threshold": threshold,
        "threshold_desc": threshold_desc,
        "is_root_cause": is_root_cause,
    }

    # Decide whether to continue drilling down
    if status == "abnormal" and children:
        next_node = children[0]
        done = False
    else:
        next_node = current_node_id  # unchanged; graph will route to conclude
        done = True

    # Append step record
    steps: list = list(state.get("steps", []))
    causal_path: list = list(state.get("causal_path", []))
    step = {
        "node_id": current_node_id,
        "node_label": node_cfg.get("label", current_node_id),
        "sql": state.get("sql", ""),
        "result": sql_result,
        "metric_value": metric_value,
        "threshold": threshold,
        "status": status,
        "explanation": threshold_desc,
    }
    steps.append(step)

    updates: dict = {
        "reflection": reflection,
        "steps": steps,
        "done": done,
    }
    if not done:
        causal_path.append(next_node)
        updates["current_node"] = next_node
        updates["causal_path"] = causal_path

    return updates


def _build_return(state: dict, node_id: str, sql_result: dict, reflection: dict, done: bool) -> dict:
    steps = list(state.get("steps", []))
    steps.append({
        "node_id": node_id,
        "node_label": node_id,
        "sql": state.get("sql", ""),
        "result": sql_result,
        "metric_value": reflection.get("metric_value"),
        "threshold": reflection.get("threshold"),
        "status": reflection.get("status", "error"),
        "explanation": reflection.get("threshold_desc", ""),
    })
    return {"reflection": reflection, "steps": steps, "done": done}
