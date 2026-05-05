"""Executor Agent — NL-to-query generation, self-healing execution, tool dispatch.

Corresponds to Section 4.3.2 of the AgentGraph paper.

Capabilities:
  1. Schema-aware NL-to-SQL/Cypher generation using focused schema context
     and top-k retrieved few-shot examples.
  2. Self-healing execution: on DB error, iteratively repair the query up to
     k=3 times using the error message as feedback (Algorithm 1 in paper).
  3. Tool dispatch for non-query steps (GraphAlgorithm, MetricCheck).

Each repair attempt is recorded in the step's repair_log for auditability
without expanding the Analysis Chain.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from core.reasoning.state import AgentState, AnalysisStep
from knowledge.workspace import Workspace

load_dotenv()
logger = logging.getLogger(__name__)

MAX_HEAL_RETRIES = 3  # k in Algorithm 1


def _get_llm(workspace: Workspace, temperature: float = 0) -> ChatOpenAI:
    wc = workspace.llm_config
    return ChatOpenAI(
        base_url=wc.get("base_url") or None,
        api_key=wc.get("api_key") or "sk-placeholder",
        model=wc.get("model") or "gpt-4o",
        temperature=temperature,
    )


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        s, e = raw.find("{"), raw.rfind("}")
        if s != -1 and e > s:
            try:
                return json.loads(raw[s: e + 1])
            except json.JSONDecodeError:
                pass
    return {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# SQL generation prompts
# ---------------------------------------------------------------------------

_SQL_GEN_PROMPT = """\
你是数据分析SQL专家。根据用户问题和数据库schema生成SQLite查询。

{schema_context}

{few_shots}

当前报告期: {current_period}

Analysis Chain上下文:
- 当前步骤 ({step_index}/{total_steps}): {current_step}
- 分析意图: {intent}
- 前序步骤结果摘要: {prior_results}

用户问题: {question}

要求：只返回SQL，不要解释，使用schema中的实际列名。
"""

_RETRY_PROMPT = """\
上一次SQL执行失败。

错误: {error}
失败的SQL:
{failed_sql}

Schema上下文:
{schema_context}

用户问题: {question}

请修正SQL（只返回SQL，不要解释）:
"""


def _get_prior_results_summary(state: AgentState) -> str:
    """Summarise completed step results for chain context injection."""
    chain = state.get("analysis_chain", [])
    step_idx = state.get("current_step_index", 0)
    summaries = []
    for i, step in enumerate(chain[:step_idx]):
        result = step.get("result")
        if result and result.get("row_count"):
            summaries.append(
                f"Step {i + 1} ({step.get('description', '?')}): "
                f"{result['row_count']} rows returned"
            )
    return "; ".join(summaries) if summaries else "(first step)"


# ═══════════════════════════════════════════════════════════════════════════
# Executor node
# ═══════════════════════════════════════════════════════════════════════════

def executor_node(state: AgentState) -> dict:
    """Executor Agent: generate query → self-heal on error → execute → return result.

    Implements Algorithm 1 (Self-healing Query Execution) from the paper.
    Repair attempts are recorded in the step's repair_log field.
    """
    question = state.get("question", "")
    ws = Workspace.get(state["workspace"])

    # Handle HITL user-edited SQL
    user_edited_sql = state.get("user_edited_sql")
    if user_edited_sql:
        result = _execute_sql(ws, user_edited_sql)
        chain = list(state.get("analysis_chain", []))
        step_idx = state.get("current_step_index", 0)
        if step_idx < len(chain):
            chain[step_idx] = {
                **chain[step_idx],
                "query": user_edited_sql,
                "result": result,
                "status": "done" if not result.get("error") else "failed",
                "repair_log": [{"source": "human_edit", "sql": user_edited_sql}],
            }
        reasoning_steps = list(state.get("reasoning_steps", []))
        reasoning_steps.append({"role": "executor", "content": "使用用户修改的SQL执行"})
        return {
            "analysis_chain": chain,
            "user_edited_sql": None,
            "pending_approval": False,
            "reasoning_steps": reasoning_steps,
        }

    # ── Generate query ──
    from core.stages.text_to_sql import TextToSqlStage
    stage = TextToSqlStage()
    kg_context = stage._retrieve_kg_context(ws.name, question)
    schema_context = stage._build_focused_schema(ws, kg_context)
    few_shots_text = stage._get_few_shots(ws, question)

    chain = list(state.get("analysis_chain", []))
    step_idx = state.get("current_step_index", 0)
    current_step = chain[step_idx] if step_idx < len(chain) else {}
    prior_results = _get_prior_results_summary(state)

    try:
        llm = _get_llm(ws)
        sql = stage._clean_sql(llm.invoke([
            SystemMessage(content="你是数据分析SQL专家。只返回SQL，不要解释。"),
            HumanMessage(content=_SQL_GEN_PROMPT.format(
                schema_context=schema_context,
                few_shots=few_shots_text,
                current_period=ws.current_period,
                step_index=step_idx + 1,
                total_steps=len(chain),
                current_step=current_step.get("description", ""),
                intent=state.get("intent", ""),
                prior_results=prior_results,
                question=question,
            )),
        ]).content)
    except Exception as exc:
        logger.error("SQL generation failed: %s", exc)
        sql = f"-- SQL generation error: {exc}"

    # ── Self-healing execution loop (Algorithm 1) ──
    repair_log = []
    result = None
    final_sql = sql

    for attempt in range(MAX_HEAL_RETRIES + 1):
        result = _execute_sql(ws, final_sql)
        if not result.get("error"):
            break
        if attempt == MAX_HEAL_RETRIES:
            # All retries exhausted — escalate to human_intervene
            logger.warning("Self-healing exhausted after %d attempts", MAX_HEAL_RETRIES)
            break
        # Repair
        try:
            repaired = stage._clean_sql(_get_llm(ws).invoke([
                HumanMessage(content=_RETRY_PROMPT.format(
                    error=result["error"],
                    failed_sql=final_sql,
                    schema_context=schema_context,
                    question=question,
                )),
            ]).content)
            repair_log.append({
                "attempt": attempt + 1,
                "failed_sql": final_sql,
                "error": result["error"],
                "repaired_sql": repaired,
                "timestamp": _now_iso(),
            })
            final_sql = repaired
        except Exception as exc:
            logger.warning("Repair attempt %d failed: %s", attempt + 1, exc)
            break

    # ── Update Analysis Chain step ──
    status = "done" if result and not result.get("error") else "failed"
    if result and result.get("error") and len(repair_log) == MAX_HEAL_RETRIES:
        status = "needs_human"  # signals Evaluator to emit human_intervene

    if step_idx < len(chain):
        chain[step_idx] = {
            **chain[step_idx],
            "query": final_sql,
            "result": result,
            "status": status,
            "repair_log": repair_log,
        }

    reasoning_steps = list(state.get("reasoning_steps", []))
    row_count = result.get("row_count", 0) if result else 0
    healing_note = f" (healed after {len(repair_log)} repairs)" if repair_log else ""
    reasoning_steps.append({
        "role": "executor",
        "content": f"Step {step_idx + 1}: {status}, {row_count} rows{healing_note}",
        "sql": final_sql[:200],
    })

    return {
        "analysis_chain": chain,
        "reasoning_steps": reasoning_steps,
        "pending_approval": False,
    }


def _execute_sql(ws: Workspace, sql: str) -> dict:
    """Execute SQL via workspace engine. Returns result dict."""
    if not sql or sql.strip().startswith("--"):
        return {"columns": [], "rows": [], "row_count": 0, "error": sql or "Empty SQL"}
    try:
        from sqlalchemy import text
        engine = ws.get_engine()
        with engine.connect() as conn:
            res = conn.execute(text(sql))
            columns = list(res.keys())
            rows = [list(r) for r in res.fetchall()]
        return {"columns": columns, "rows": rows[:200], "row_count": len(rows), "error": None}
    except Exception as exc:
        return {"columns": [], "rows": [], "row_count": 0, "error": f"{type(exc).__name__}: {exc}"}
