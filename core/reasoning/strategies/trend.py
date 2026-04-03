"""Trend analysis strategy — time series analysis."""
from __future__ import annotations

import logging

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph as CompiledGraph

from core.reasoning.strategies.base import StrategyBase, StrategyRegistry
from core.reasoning.state import AgentState
from core.reasoning.nodes import sql_gen_node, execute_node

logger = logging.getLogger(__name__)


def _trend_plan_node(state: dict) -> dict:
    """Generate a trend analysis plan."""
    reasoning_steps = list(state.get("reasoning_steps", []))
    reasoning_steps.append({
        "step_type": "plan",
        "content": "趋势分析: 提取时间序列数据 → 分析变化趋势 → 识别拐点",
        "timestamp": "",
    })

    plan = ["确定时间范围和指标", "生成时序SQL", "执行查询", "分析趋势并生成结论"]
    return {
        "plan": plan,
        "current_step_index": 0,
        "reasoning_steps": reasoning_steps,
    }


def _trend_conclude_node(state: dict) -> dict:
    """Synthesize trend analysis conclusion."""
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
            f"用户问题: {question}\n\n"
            f"时序查询结果:\n列: {columns}\n"
            f"数据: {json.dumps(rows[:30], ensure_ascii=False, default=str)}\n\n"
            f"请分析数据的趋势变化，识别关键拐点和异常（200字以内）:"
        )
        response = llm.invoke([
            SystemMessage(content="你是时序数据分析专家，擅长识别趋势、拐点和异常。"),
            HumanMessage(content=prompt),
        ])
        conclusion = response.content.strip()
    except Exception:
        conclusion = f"趋势分析完成，返回 {len(rows)} 个时间点数据。"

    reasoning_steps.append({
        "step_type": "conclude",
        "content": conclusion,
        "timestamp": "",
    })

    chart_spec = {"type": "line", "title": question[:50]}

    return {
        "conclusion": conclusion,
        "chart_spec": chart_spec,
        "reasoning_steps": reasoning_steps,
    }


@StrategyRegistry.register
class TrendStrategy(StrategyBase):
    name = "trend"
    display_name = "趋势分析"
    description = "时间序列趋势分析、拐点识别"
    trigger_keywords = ["趋势", "走势", "变化", "历史", "近几个月", "近几年"]

    def can_handle(self, intent: str, question: str) -> float:
        score = 0.0
        for kw in self.trigger_keywords:
            if kw in question:
                score = max(score, 0.7)
        if "trend" in intent.lower() or "趋势" in intent:
            score = max(score, 0.8)
        return score

    def build_subgraph(self) -> CompiledGraph:
        builder = StateGraph(AgentState)

        builder.add_node("plan", _trend_plan_node)
        builder.add_node("sql_gen", sql_gen_node)
        builder.add_node("execute", execute_node)
        builder.add_node("conclude", _trend_conclude_node)

        builder.set_entry_point("plan")
        builder.add_edge("plan", "sql_gen")
        builder.add_edge("sql_gen", "execute")
        builder.add_edge("execute", "conclude")
        builder.add_edge("conclude", END)

        return builder.compile()
