"""
Generic workspace-aware data explorer.

GET  /api/explorer/{workspace}/tables                    — list tables with row counts
GET  /api/explorer/{workspace}/tables/{table}/schema     — field list
GET  /api/explorer/{workspace}/tables/{table}/data       — preview rows (?limit=50)
POST /api/explorer/{workspace}/query                     — execute a SELECT query
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import inspect, text

from knowledge.workspace import Workspace

router = APIRouter(tags=["explorer"])


class QueryRequest(BaseModel):
    sql: str


def _get_ws(name: str) -> Workspace:
    try:
        return Workspace.get(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/explorer/{workspace}/tables")
def list_tables(workspace: str):
    """List all tables in the workspace database with row counts."""
    ws = _get_ws(workspace)
    try:
        engine = ws.get_engine()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    result = []
    with engine.connect() as conn:
        for name in table_names:
            try:
                row = conn.execute(text(f"SELECT COUNT(*) FROM [{name}]")).fetchone()
                row_count = row[0] if row else 0
            except Exception:
                row_count = None
            col_count = len(inspector.get_columns(name))
            result.append({
                "name": name,
                "row_count": row_count,
                "column_count": col_count,
            })
    return result


@router.get("/explorer/{workspace}/tables/{table}/schema")
def table_schema(workspace: str, table: str):
    """Return the column schema for a table."""
    ws = _get_ws(workspace)
    try:
        engine = ws.get_engine()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    inspector = inspect(engine)
    try:
        columns = inspector.get_columns(table)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Table '{table}' not found: {exc}")

    pk_constraint = inspector.get_pk_constraint(table)
    pk_cols = set(pk_constraint.get("constrained_columns", []))

    return [
        {
            "name": col["name"],
            "type": str(col["type"]),
            "nullable": col.get("nullable", True),
            "default": str(col.get("default", "")) or None,
            "primary_key": col["name"] in pk_cols,
        }
        for col in columns
    ]


@router.get("/explorer/{workspace}/tables/{table}/data")
def table_data(workspace: str, table: str, limit: int = 50):
    """Return a preview of table rows."""
    limit = min(limit, 500)  # cap at 500 rows
    ws = _get_ws(workspace)
    try:
        engine = ws.get_engine()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        with engine.connect() as conn:
            result = conn.execute(text(f"SELECT * FROM [{table}] LIMIT :lim"), {"lim": limit})
            columns = list(result.keys())
            rows = [list(row) for row in result.fetchall()]
            total_row = conn.execute(text(f"SELECT COUNT(*) FROM [{table}]")).fetchone()
            total = total_row[0] if total_row else 0
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"columns": columns, "rows": rows, "total": total}


@router.post("/explorer/{workspace}/query")
def run_query(workspace: str, body: QueryRequest):
    """Execute a read-only SELECT query against the workspace database."""
    sql = body.sql.strip()

    # Read-only guard: only allow SELECT statements
    if not sql.upper().startswith("SELECT"):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed.")

    ws = _get_ws(workspace)
    try:
        engine = ws.get_engine()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        with engine.connect() as conn:
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = [list(row) for row in result.fetchall()]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
    }
