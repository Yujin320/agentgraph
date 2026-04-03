"""Node implementations for the agentic reasoning graph.

Each node function takes AgentState and returns a partial state update dict.
Reuses existing infrastructure from core.stages for SQL generation and execution.
"""
from __future__ import annotations

import json
import os
import re
import logging
from datetime import datetime, timezone

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from knowledge.workspace import Workspace
from core.reasoning.state import AgentState, ReasoningStep
from core.reasoning.prompts import (
    INTENT_PROMPT,
    PLAN_PROMPT,
    SQL_GEN_PROMPT,
    RETRY_PROMPT,
    REFLECT_PROMPT,
    CONCLUDE_PROMPT,
    CHART_SELECT_PROMPT,
)

load_dotenv()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LLM helper
# ---------------------------------------------------------------------------

def _get_llm(workspace: Workspace, temperature: float = 0) -> ChatOpenAI:
    wc = workspace.llm_config
    return ChatOpenAI(
        base_url=wc.get("base_url") or os.getenv("LLM_BASE_URL") or None,
        api_key=wc.get("api_key") or os.getenv("LLM_API_KEY") or "sk-placeholder",
        model=wc.get("model") or os.getenv("LLM_MODEL") or "gpt-4o",
        temperature=temperature,
    )


def _parse_json(raw: str) -> dict:
    """Extract JSON from LLM response, stripping markdown fences."""
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw)
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(raw[start : end + 1])
            except json.JSONDecodeError:
                pass
    return {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_step(step_type: str, content: str, **kwargs) -> dict:
    step = ReasoningStep(
        step_type=step_type,
        content=content,
        timestamp=_now_iso(),
        **kwargs,
    )
    return step.model_dump()


# ---------------------------------------------------------------------------
# Attribution keywords (reused from pipeline.py)
# ---------------------------------------------------------------------------

_CAUSAL_KEYWORDS = ["为什么", "原因", "归因", "怎么", "如何导致", "什么导致", "分析原因", "根因"]
_COMPARATIVE_KEYWORDS = ["对比", "比较", "同比", "环比", "差异", "vs", "VS"]
_TREND_KEYWORDS = ["趋势", "走势", "变化", "历史", "近几个月", "近几年"]
_STATISTICAL_KEYWORDS = ["相关", "分布", "占比", "TOP", "top", "排名", "最高", "最低"]
_WHATIF_KEYWORDS = ["如果", "假设", "模拟", "预测", "假如"]


# ═══════════════════════════════════════════════════════════════════════════
# Node 1: intent_node
# ═══════════════════════════════════════════════════════════════════════════

def intent_node(state: dict) -> dict:
    """Classify user question intent using keyword matching + LLM fallback."""
    question = state.get("question", "")
    ws = Workspace.get(state["workspace"])

    # Fast keyword-based classification
    strategy = "general"
    if any(kw in question for kw in _CAUSAL_KEYWORDS):
        strategy = "causal"
    elif any(kw in question for kw in _COMPARATIVE_KEYWORDS):
        strategy = "comparative"
    elif any(kw in question for kw in _TREND_KEYWORDS):
        strategy = "trend"
    elif any(kw in question for kw in _STATISTICAL_KEYWORDS):
        strategy = "statistical"
    elif any(kw in question for kw in _WHATIF_KEYWORDS):
        strategy = "whatif"

    # LLM refinement
    intent_desc = question
    try:
        llm = _get_llm(ws)
        prompt = INTENT_PROMPT.format(question=question)
        response = llm.invoke([HumanMessage(content=prompt)])
        parsed = _parse_json(response.content)
        if parsed.get("strategy"):
            strategy = parsed["strategy"]
        if parsed.get("intent"):
            intent_desc = parsed["intent"]
    except Exception as exc:
        logger.warning("LLM intent classification failed, using keyword fallback: %s", exc)

    reasoning_steps = list(state.get("reasoning_steps", []))
    reasoning_steps.append(_make_step("plan", f"意图识别: {intent_desc}, 策略: {strategy}"))

    return {
        "strategy": strategy,
        "intent": intent_desc,
        "reasoning_steps": reasoning_steps,
        "retry_count": 0,
        "max_retries": state.get("max_retries", 3),
        "drill_depth": 0,
        "max_drill_depth": state.get("max_drill_depth", 3),
        "current_step_index": 0,
        "pending_approval": False,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Node 2: plan_node
# ═══════════════════════════════════════════════════════════════════════════

def plan_node(state: dict) -> dict:
    """Decompose question into sub-task list using LLM."""
    question = state.get("question", "")
    strategy = state.get("strategy", "general")
    intent = state.get("intent", question)
    ws = Workspace.get(state["workspace"])

    # Build context from KG if available
    context = ""
    try:
        from core.stages.text_to_sql import TextToSqlStage
        stage = TextToSqlStage()
        kg_context = stage._retrieve_kg_context(ws.name, question)
        if kg_context.get("scenario"):
            context = f"匹配场景: {kg_context['scenario'].get('title', '')}"
        if kg_context.get("metrics"):
            metric_names = [m.get("alias", m.get("name", "")) for m in kg_context["metrics"][:5]]
            context += f"\n相关指标: {', '.join(metric_names)}"
    except Exception as exc:
        logger.debug("KG context retrieval failed (non-critical): %s", exc)

    # LLM plan generation
    steps = ["生成SQL查询", "执行查询", "解读结果"]
    try:
        llm = _get_llm(ws)
        prompt = PLAN_PROMPT.format(
            question=question,
            strategy=strategy,
            intent=intent,
            context=context,
        )
        response = llm.invoke([HumanMessage(content=prompt)])
        parsed = _parse_json(response.content)
        if parsed.get("steps") and isinstance(parsed["steps"], list):
            steps = parsed["steps"]
    except Exception as exc:
        logger.warning("LLM plan generation failed, using defaults: %s", exc)

    reasoning_steps = list(state.get("reasoning_steps", []))
    reasoning_steps.append(_make_step("plan", f"分析计划: {'; '.join(steps)}"))

    return {
        "plan": steps,
        "current_step_index": 0,
        "reasoning_steps": reasoning_steps,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Node 3: sql_gen_node
# ═══════════════════════════════════════════════════════════════════════════

def sql_gen_node(state: dict) -> dict:
    """Generate SQL using the existing TextToSqlStage infrastructure."""
    question = state.get("question", "")
    ws = Workspace.get(state["workspace"])

    # If user edited SQL via HITL, use that
    user_edited_sql = state.get("user_edited_sql")
    if user_edited_sql:
        reasoning_steps = list(state.get("reasoning_steps", []))
        reasoning_steps.append(_make_step("sql_gen", "使用用户修改的SQL", sql=user_edited_sql))
        return {
            "current_sql": user_edited_sql,
            "user_edited_sql": None,  # consumed
            "sql_error": None,
            "reasoning_steps": reasoning_steps,
            "pending_approval": False,
        }

    # Reuse TextToSqlStage infrastructure for schema/KG/RAG
    from core.stages.text_to_sql import TextToSqlStage
    stage = TextToSqlStage()

    retry_count = state.get("retry_count", 0)
    sql_error = state.get("sql_error")

    try:
        llm = _get_llm(ws)
        kg_context = stage._retrieve_kg_context(ws.name, question)
        schema_context = stage._build_focused_schema(ws, kg_context)
        few_shots_text = stage._get_few_shots(ws, question)

        plan = state.get("plan", [])
        step_idx = state.get("current_step_index", 0)
        current_step = plan[step_idx] if step_idx < len(plan) else "生成SQL"

        if retry_count > 0 and sql_error:
            # Retry with error context
            prompt = RETRY_PROMPT.format(
                error=sql_error,
                failed_sql=state.get("current_sql", ""),
                schema_context=schema_context,
                question=question,
            )
        else:
            prompt = SQL_GEN_PROMPT.format(
                schema_context=schema_context,
                few_shots=few_shots_text,
                current_period=ws.current_period,
                current_step=current_step,
                intent=state.get("intent", ""),
                question=question,
            )

        response = llm.invoke([
            SystemMessage(content="你是数据分析SQL专家。只返回SQL，不要解释。"),
            HumanMessage(content=prompt),
        ])
        sql = stage._clean_sql(response.content)
    except Exception as exc:
        logger.error("SQL generation failed: %s", exc)
        sql = f"-- SQL generation error: {exc}"

    reasoning_steps = list(state.get("reasoning_steps", []))
    step_label = "SQL重试" if retry_count > 0 else "SQL生成"
    reasoning_steps.append(_make_step("sql_gen", f"{step_label}: {sql[:100]}...", sql=sql))

    return {
        "current_sql": sql,
        "sql_error": None,
        "sql_result": None,
        "reasoning_steps": reasoning_steps,
        "pending_approval": False,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Node 4: execute_node
# ═══════════════════════════════════════════════════════════════════════════

def execute_node(state: dict) -> dict:
    """Execute SQL using existing workspace engine infrastructure."""
    sql = (state.get("current_sql") or "").strip()

    if not sql or sql.startswith("--"):
        return {
            "sql_result": {"columns": [], "rows": [], "row_count": 0, "error": sql or "Empty SQL"},
            "sql_error": sql or "Empty SQL",
        }

    try:
        from sqlalchemy import text
        ws = Workspace.get(state["workspace"])
        engine = ws.get_engine()

        with engine.connect() as conn:
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = [list(row) for row in result.fetchall()]

        sql_result = {
            "columns": columns,
            "rows": rows[:200],
            "row_count": len(rows),
            "error": None,
        }

        reasoning_steps = list(state.get("reasoning_steps", []))
        reasoning_steps.append(_make_step(
            "execute",
            f"执行成功: {len(rows)} 行结果",
            sql=sql,
            result={"columns": columns, "rows": rows[:5], "row_count": len(rows)},
        ))

        return {
            "sql_result": sql_result,
            "sql_error": None,
            "reasoning_steps": reasoning_steps,
        }
    except Exception as exc:
        err_msg = f"{type(exc).__name__}: {exc}"
        reasoning_steps = list(state.get("reasoning_steps", []))
        reasoning_steps.append(_make_step("execute", f"执行失败: {err_msg}", sql=sql, error=err_msg))

        return {
            "sql_result": {"columns": [], "rows": [], "row_count": 0, "error": err_msg},
            "sql_error": err_msg,
            "reasoning_steps": reasoning_steps,
        }


# ═══════════════════════════════════════════════════════════════════════════
# Node 5: reflect_node
# ═══════════════════════════════════════════════════════════════════════════

def reflect_node(state: dict) -> dict:
    """LLM evaluates the result and decides: retry, drill, or conclude."""
    sql_result = state.get("sql_result", {})
    sql_error = state.get("sql_error")
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 3)

    # If SQL error and retries remain, route to retry
    if sql_error and retry_count < max_retries:
        reasoning_steps = list(state.get("reasoning_steps", []))
        reasoning_steps.append(_make_step(
            "reflect", f"SQL执行错误，第{retry_count + 1}次重试", error=sql_error
        ))
        return {
            "retry_count": retry_count + 1,
            "reasoning_steps": reasoning_steps,
        }

    # If SQL error and no retries left, conclude with error
    if sql_error:
        reasoning_steps = list(state.get("reasoning_steps", []))
        reasoning_steps.append(_make_step(
            "reflect", f"SQL重试{max_retries}次仍失败，结束分析", error=sql_error
        ))
        return {"reasoning_steps": reasoning_steps}

    # LLM reflection on result quality
    question = state.get("question", "")
    strategy = state.get("strategy", "general")
    plan = state.get("plan", [])
    step_idx = state.get("current_step_index", 0)
    current_step = plan[step_idx] if step_idx < len(plan) else "当前步骤"
    ws = Workspace.get(state["workspace"])

    columns = sql_result.get("columns", [])
    rows = sql_result.get("rows", [])
    row_count = sql_result.get("row_count", 0)

    decision = "conclude"
    assessment = "结果正常"

    try:
        llm = _get_llm(ws)
        prompt = REFLECT_PROMPT.format(
            question=question,
            strategy=strategy,
            current_step=step_idx + 1,
            total_steps=len(plan),
            sql=state.get("current_sql", ""),
            columns=columns,
            rows=json.dumps(rows[:10], ensure_ascii=False, default=str),
            row_count=row_count,
        )
        response = llm.invoke([HumanMessage(content=prompt)])
        parsed = _parse_json(response.content)
        if parsed.get("decision") in ("conclude", "drill", "retry"):
            decision = parsed["decision"]
        if parsed.get("assessment"):
            assessment = parsed["assessment"]
    except Exception as exc:
        logger.warning("LLM reflection failed, defaulting to conclude: %s", exc)

    reasoning_steps = list(state.get("reasoning_steps", []))
    reasoning_steps.append(_make_step("reflect", f"评估: {assessment}, 决策: {decision}"))

    updates: dict = {"reasoning_steps": reasoning_steps}

    if decision == "retry" and retry_count < max_retries:
        updates["retry_count"] = retry_count + 1
    elif decision == "drill":
        drill_depth = state.get("drill_depth", 0)
        max_drill = state.get("max_drill_depth", 3)
        if drill_depth < max_drill:
            updates["drill_depth"] = drill_depth + 1
            updates["current_step_index"] = step_idx + 1
        # else: fall through to conclude
    # "conclude" or exhausted retries/drills — no additional state change needed

    return updates


# ═══════════════════════════════════════════════════════════════════════════
# Node 6: conclude_node
# ═══════════════════════════════════════════════════════════════════════════

def conclude_node(state: dict) -> dict:
    """Synthesize all reasoning steps into a final answer."""
    question = state.get("question", "")
    strategy = state.get("strategy", "general")
    reasoning_steps = state.get("reasoning_steps", [])
    sql_result = state.get("sql_result", {})
    ws = Workspace.get(state["workspace"])

    # Build reasoning trace
    trace_lines = []
    for i, step in enumerate(reasoning_steps, 1):
        trace_lines.append(f"{i}. [{step.get('step_type', '?')}] {step.get('content', '')}")
        if step.get("sql"):
            trace_lines.append(f"   SQL: {step['sql'][:200]}")
        if step.get("error"):
            trace_lines.append(f"   错误: {step['error']}")

    reasoning_trace = "\n".join(trace_lines) if trace_lines else "无分析步骤记录"

    # Generate conclusion via LLM
    conclusion = ""
    try:
        llm = _get_llm(ws, temperature=0.3)
        prompt = CONCLUDE_PROMPT.format(
            question=question,
            strategy=strategy,
            reasoning_trace=reasoning_trace,
        )
        response = llm.invoke([HumanMessage(content=prompt)])
        conclusion = response.content.strip()
    except Exception as exc:
        logger.warning("LLM conclusion failed: %s", exc)
        conclusion = f"分析完成，共 {len(reasoning_steps)} 个步骤。"
        if sql_result.get("row_count"):
            conclusion += f" 查询返回 {sql_result['row_count']} 行数据。"

    # Generate chart spec
    chart_spec = None
    columns = sql_result.get("columns", [])
    row_count = sql_result.get("row_count", 0)
    if columns and row_count > 0:
        try:
            llm = _get_llm(ws)
            chart_prompt = CHART_SELECT_PROMPT.format(
                columns=columns,
                row_count=row_count,
                strategy=strategy,
                question=question,
            )
            chart_response = llm.invoke([HumanMessage(content=chart_prompt)])
            chart_spec = _parse_json(chart_response.content)
        except Exception:
            # Fallback chart spec
            chart_spec = {"type": "table", "title": question[:50]}

    # Build attribution paths for causal strategy
    attribution_paths = []
    if strategy == "causal":
        attribution_paths = _build_attribution_paths(ws, question)

    final_steps = list(reasoning_steps)
    final_steps.append(_make_step("conclude", conclusion))

    return {
        "conclusion": conclusion,
        "chart_spec": chart_spec,
        "attribution_paths": attribution_paths,
        "reasoning_steps": final_steps,
    }


def _build_attribution_paths(ws: Workspace, question: str) -> list[dict]:
    """Build attribution paths from the attribution stage for causal questions."""
    try:
        from core.stages.attribution import AttributionStage
        stage = AttributionStage()
        entry_id = stage._find_entry_from_question(ws.name, question)
        if not entry_id:
            return []
        raw_paths = stage._enumerate_paths(ws.name, entry_id, max_depth=5)
        paths = []
        for raw_path in raw_paths[:3]:
            path_info = {
                "nodes": [
                    {"id": n.get("id", ""), "alias": n.get("alias", n.get("name", ""))}
                    for n in raw_path
                ],
            }
            paths.append(path_info)
        return paths
    except Exception as exc:
        logger.debug("Attribution path building failed (non-critical): %s", exc)
        return []


# ═══════════════════════════════════════════════════════════════════════════
# Routing function
# ═══════════════════════════════════════════════════════════════════════════

def route_after_reflect(state: dict) -> str:
    """Conditional routing after reflect node."""
    sql_error = state.get("sql_error")
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 3)

    # If there was a SQL error and we just incremented retry_count, go back to sql_gen
    if sql_error and retry_count <= max_retries and retry_count > 0:
        # Check if the latest reasoning step indicates a retry
        steps = state.get("reasoning_steps", [])
        if steps:
            last = steps[-1]
            content = last.get("content", "")
            if "重试" in content and "仍失败" not in content:
                return "sql_gen"

    # Check if reflect decided to drill deeper
    plan = state.get("plan", [])
    step_idx = state.get("current_step_index", 0)
    drill_depth = state.get("drill_depth", 0)

    # If we just incremented drill_depth and haven't exhausted plan steps
    steps = state.get("reasoning_steps", [])
    if steps:
        last = steps[-1]
        content = last.get("content", "")
        if "drill" in content.lower() and step_idx < len(plan) and drill_depth <= state.get("max_drill_depth", 3):
            return "sql_gen"

    return "conclude"
