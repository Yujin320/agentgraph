"""What-if analysis strategy — parametric simulation."""
from __future__ import annotations

import logging

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph as CompiledGraph

from core.reasoning.strategies.base import StrategyBase, StrategyRegistry
from core.reasoning.state import AgentState
from core.reasoning.nodes import sql_gen_node, execute_node

logger = logging.getLogger(__name__)


def _whatif_plan_node(state: dict) -> dict:
    """Generate a what-if analysis plan."""
    reasoning_steps = list(state.get("reasoning_steps", []))
    reasoning_steps.append({
        "step_type": "plan",
        "content": "假设分析: 提取基线数据 → 应用参数变化 → 模拟结果",
        "timestamp": "",
    })

    plan = ["获取当前基线数据", "识别假设参数", "计算模拟结果", "对比基线与模拟"]
    return {
        "plan": plan,
        "current_step_index": 0,
        "reasoning_steps": reasoning_steps,
    }


def _whatif_conclude_node(state: dict) -> dict:
    """Synthesize what-if analysis conclusion."""
    from knowledge.workspace import Workspace
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage
    import os, json

    ws = Workspace.get(state["workspace"])
    question = state.get("question", "")
    sql_result = state.get("sql_result", {})
    reasoning_steps = list(state.get("reasoning_steps", []))

    columns = sql_result.get("columns", [])
    rows = sql_result.get("rows", [])

    try:
        wc = ws.llm_config
        llm = ChatOpenAI(
            base_url=wc.get("base_url") or os.getenv("LLM_BASE_URL") or None,
            api_key=wc.get("api_key") or os.getenv("LLM_API_KEY") or "sk-placeholder",
            model=wc.get("model") or os.getenv("LLM_MODEL") or "gpt-4o",
            temperature=0.3,
        )
        prompt = (
            f"用户问题（假设分析）: {question}\n\n"
            f"基线数据:\n列: {columns}\n"
            f"数据: {json.dumps(rows[:20], ensure_ascii=False, default=str)}\n\n"
            f"请基于查询结果，分析假设条件下的可能影响（200字以内）:"
        )
        response = llm.invoke([
            SystemMessage(content="你是业务模拟分析专家，擅长基于数据进行假设推演。"),
            HumanMessage(content=prompt),
        ])
        conclusion = response.content.strip()
    except Exception:
        conclusion = f"假设分析完成，基线数据包含 {len(rows)} 行。"

    reasoning_steps.append({
        "step_type": "conclude",
        "content": conclusion,
        "timestamp": "",
    })

    chart_spec = {"type": "bar", "title": f"假设分析: {question[:40]}"}

    return {
        "conclusion": conclusion,
        "chart_spec": chart_spec,
        "reasoning_steps": reasoning_steps,
    }


@StrategyRegistry.register
class WhatIfStrategy(StrategyBase):
    name = "whatif"
    display_name = "假设分析"
    description = "参数化模拟和假设推演"
    trigger_keywords = ["如果", "假设", "模拟", "预测", "假如"]

    def can_handle(self, intent: str, question: str) -> float:
        score = 0.0
        for kw in self.trigger_keywords:
            if kw in question:
                score = max(score, 0.7)
        if "whatif" in intent.lower() or "假设" in intent or "模拟" in intent:
            score = max(score, 0.8)
        return score

    def build_subgraph(self) -> CompiledGraph:
        builder = StateGraph(AgentState)

        builder.add_node("plan", _whatif_plan_node)
        builder.add_node("sql_gen", sql_gen_node)
        builder.add_node("execute", execute_node)
        builder.add_node("conclude", _whatif_conclude_node)

        builder.set_entry_point("plan")
        builder.add_edge("plan", "sql_gen")
        builder.add_edge("sql_gen", "execute")
        builder.add_edge("execute", "conclude")
        builder.add_edge("conclude", END)

        return builder.compile()
