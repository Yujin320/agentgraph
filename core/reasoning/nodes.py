"""AgentGraph node re-exports and conclude_node implementation.

The three primary agent roles are defined in dedicated modules:
  - core.reasoning.planner   → planner_node
  - core.reasoning.executor  → executor_node
  - core.reasoning.evaluator → evaluator_node, route_after_evaluator

This module keeps conclude_node (unchanged) and provides backward-compatible
re-exports so existing code that imports from core.reasoning.nodes still works.
"""
from __future__ import annotations

import json
import logging
import re

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from core.reasoning.state import AgentState
from knowledge.workspace import Workspace

# ── Backward-compatible re-exports ──
from core.reasoning.planner import planner_node          # noqa: F401
from core.reasoning.executor import executor_node        # noqa: F401
from core.reasoning.evaluator import (                   # noqa: F401
    evaluator_node,
    route_after_evaluator,
)

load_dotenv()
logger = logging.getLogger(__name__)

_CONCLUDE_PROMPT = """\
你是供应链数据分析顾问。请根据所有分析步骤的结果，生成最终的分析结论。

分析目标: {question}
分析策略: {strategy}

分析链路径:
{chain_summary}

要求：用简洁的中文业务语言，凸显关键发现和异常值，给出可落地的建议，200字以内。
"""

_CHART_PROMPT = """\
根据以下查询结果，选择最适合的图表类型。
列: {columns}  数据行数: {row_count}  策略: {strategy}  问题: {question}
返回JSON: {{"type": "bar|line|pie|table|kpi", "x_column": "...", "y_columns": [...], "title": "..."}}
"""


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


def conclude_node(state: AgentState) -> dict:
    """Synthesise all Analysis Chain results into a structured report R."""
    question = state.get("question", "")
    strategy = state.get("strategy", "general")
    chain = state.get("analysis_chain", [])
    ws = Workspace.get(state["workspace"])

    # Build chain summary for LLM
    summary_lines = []
    last_result = {}
    for i, step in enumerate(chain):
        result = step.get("result") or {}
        decision = step.get("evaluator_decision", "")
        summary_lines.append(
            f"Step {i + 1} [{step.get('step_type', '?')}] {step.get('description', '')}: "
            f"rows={result.get('row_count', 0)}, decision={decision}"
        )
        if result.get("row_count", 0) > 0:
            last_result = result

    chain_summary = "\n".join(summary_lines) or "（无分析步骤记录）"

    # Generate conclusion
    conclusion = ""
    try:
        conclusion = _get_llm(ws, temperature=0.3).invoke([
            HumanMessage(content=_CONCLUDE_PROMPT.format(
                question=question, strategy=strategy, chain_summary=chain_summary,
            ))
        ]).content.strip()
    except Exception as exc:
        logger.warning("LLM conclusion failed: %s", exc)
        conclusion = f"分析完成，共执行 {len(chain)} 个分析步骤。"

    # Generate chart spec from last non-empty result
    chart_spec = None
    columns = last_result.get("columns", [])
    row_count = last_result.get("row_count", 0)
    if columns and row_count > 0:
        try:
            chart_spec = _parse_json(_get_llm(ws).invoke([
                HumanMessage(content=_CHART_PROMPT.format(
                    columns=columns, row_count=row_count,
                    strategy=strategy, question=question,
                ))
            ]).content)
        except Exception:
            chart_spec = {"type": "table", "title": question[:50]}

    reasoning_steps = list(state.get("reasoning_steps", []))
    reasoning_steps.append({"role": "conclude", "content": conclusion})

    return {
        "conclusion": conclusion,
        "chart_spec": chart_spec,
        "attribution_paths": [],
        "reasoning_steps": reasoning_steps,
    }
