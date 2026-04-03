"""Execute node — runs state.sql against the workspace database."""
from __future__ import annotations
from sqlalchemy import text
from knowledge.workspace import Workspace


def execute_node(state: dict) -> dict:
    sql: str = state.get("sql", "").strip()

    if not sql or sql.startswith("--"):
        return {
            "sql_result": {"columns": [], "rows": [], "row_count": 0, "error": sql or "Empty SQL"},
            "error": sql or "Empty SQL",
            "done": True,
        }

    try:
        ws: Workspace = Workspace.get(state["workspace"])
        engine = ws.get_engine()

        with engine.connect() as conn:
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = [list(row) for row in result.fetchall()]

        sql_result = {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "error": None,
        }
        return {"sql_result": sql_result}

    except Exception as exc:
        err_msg = f"{type(exc).__name__}: {exc}"
        return {
            "sql_result": {"columns": [], "rows": [], "row_count": 0, "error": err_msg},
            "error": err_msg,
            "done": True,
        }
