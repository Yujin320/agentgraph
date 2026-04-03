"""SQL node — generates SQL for the current causal node.

Priority:
  1. node.metric_sql   — explicit override (optional, for edge cases)
  2. LLM generation    — from node description + schema + rules
  3. RAG fallback      — closest few-shot example from ChromaDB
"""
from __future__ import annotations
import os
import re
from dotenv import load_dotenv
from knowledge.workspace import Workspace

load_dotenv()

_SQL_SYSTEM = (
    "You are a SQL expert for a supply-chain analytics system. "
    "Generate a single SQLite SELECT statement that computes exactly ONE numeric value "
    "aliased as `value`. "
    "Return ONLY the raw SQL — no markdown fences, no explanation."
)

_SQL_TEMPLATE = """\
{schema_context}

{rules_context}

Task: Write a SQLite query for the following metric.

Metric: {label} ({layer})
Description: {description}
Period: Use '{current_period}' for the current month filter.

Requirements:
- SELECT exactly one row with one column aliased as `value`
- Apply all relevant business rules from the schema above
- Use correct column names exactly as listed in the schema
- For period filters on sales_delivery use strftime('%Y%m', deliv_crt_time)
- For period filters on sales_order use strftime('%Y%m', order_crt_date)
- For rolling_plan, production_output, inventory use stats_yearmth / record_yearmth / snapshot_yearmth directly

SQL:"""


def _find_node(causal: dict, node_id: str) -> dict | None:
    for scenario in causal.get("scenarios", []):
        for node in scenario.get("nodes", []):
            if node.get("id") == node_id:
                return node
    return None


def _prev_period(period: str) -> str:
    try:
        year, month = int(period[:4]), int(period[4:6])
        month -= 1
        if month == 0:
            month, year = 12, year - 1
        return f"{year}{month:02d}"
    except Exception:
        return period


def _apply_filters(sql: str, filters: dict) -> str:
    for field, value in filters.items():
        if field in sql:
            continue
        clause = f" AND {field} = '{value}'"
        for keyword in (" ORDER ", " GROUP ", " LIMIT ", " HAVING "):
            idx = sql.upper().find(keyword)
            if idx != -1:
                sql = sql[:idx] + clause + sql[idx:]
                break
        else:
            sql = sql.rstrip(";") + clause
    return sql


def _llm_generate_sql(node_cfg: dict, ws: Workspace) -> str:
    """Ask the LLM to write SQL for this node using the workspace schema."""
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage
    from knowledge.schema_builder import build_schema_context, build_rules_context

    wc = ws.llm_config
    llm = ChatOpenAI(
        base_url=wc.get("base_url") or os.getenv("LLM_BASE_URL") or None,
        api_key=wc.get("api_key") or os.getenv("LLM_API_KEY") or "sk-placeholder",
        model=wc.get("model") or os.getenv("LLM_MODEL") or "gpt-4o",
        temperature=0,
    )

    prompt = _SQL_TEMPLATE.format(
        schema_context=build_schema_context(ws),
        rules_context=build_rules_context(ws),
        label=node_cfg.get("label", ""),
        layer=node_cfg.get("layer", ""),
        description=node_cfg.get("description", node_cfg.get("label", "")),
        current_period=ws.current_period,
    )

    response = llm.invoke([SystemMessage(content=_SQL_SYSTEM), HumanMessage(content=prompt)])
    raw = response.content.strip()

    # Strip markdown code fences if the model added them anyway
    raw = re.sub(r"^```(?:sql)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


def sql_node(state: dict) -> dict:
    ws: Workspace = Workspace.get(state["workspace"])
    causal = ws.get_engine_graph()
    current_node_id: str = state.get("current_node", "")
    intent: dict = state.get("intent", {})
    current_period = ws.current_period
    last_period = _prev_period(current_period)

    node_cfg = _find_node(causal, current_node_id)
    sql = ""

    if node_cfg:
        if node_cfg.get("metric_sql"):
            # Explicit override — use as-is
            sql = node_cfg["metric_sql"]
            sql = sql.replace("{current_period}", current_period)
            sql = sql.replace("{last_period}", last_period)
        else:
            # General path: LLM generates SQL from node semantics + schema
            sql = _llm_generate_sql(node_cfg, ws)
            sql = sql.replace("{current_period}", current_period)
            sql = sql.replace("{last_period}", last_period)

        # Apply any dynamic filters from intent
        filters: dict = intent.get("filters", {})
        if filters:
            sql = _apply_filters(sql, filters)

    if not sql:
        # RAG fallback: closest few-shot example
        from knowledge.vanna_store import get_sql_rag
        rag = get_sql_rag(ws)
        if rag:
            matches = rag.retrieve(state.get("question", ""), n_results=1)
            sql = matches[0]["sql"] if matches and matches[0].get("sql") else ""
    if not sql:
        sql = f"-- No SQL could be generated for node '{current_node_id}'"

    return {"sql": sql}
