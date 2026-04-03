"""Statistical analysis strategy — correlation, distribution, ranking."""
from __future__ import annotations

import logging

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph as CompiledGraph

from core.reasoning.strategies.base import StrategyBase, StrategyRegistry
from core.reasoning.state import AgentState
from core.reasoning.nodes import sql_gen_node, execute_node

logger = logging.getLogger(__name__)


def _statistical_plan_node(state: dict) -> dict:
    """Generate a statistical analysis plan."""
    question = state.get("question", "")
    reasoning_steps = list(state.get("reasoning_steps", []))
    reasoning_steps.append({
        "step_type": "plan",
        "content": "统计分析: 生成聚合查询 → 执行 → 解读分布/排名",
        "timestamp": "",
    })

    plan = ["生成统计聚合SQL", "执行查询", "分析统计特征", "生成结论"]
    return {
        "plan": plan,
        "current_step_index": 0,
        "reasoning_steps": reasoning_steps,
    }


def _statistical_conclude_node(state: dict) -> dict:
    """Synthesize statistical analysis conclusion."""
    from knowledge.workspace import Workspace
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage
    import os

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
        import json
        prompt = (
            f"用户问题: {question}\n\n"
            f"统计查询结果:\n列: {columns}\n"
            f"数据: {json.dumps(rows[:20], ensure_ascii=False, default=str)}\n\n"
            f"请用业务语言解读统计分析结果（200字以内）:"
        )
        response = llm.invoke([
            SystemMessage(content="你是数据分析顾问，擅长解读统计分布和排名结果。"),
            HumanMessage(content=prompt),
        ])
        conclusion = response.content.strip()
    except Exception:
        conclusion = f"统计分析完成，返回 {len(rows)} 行数据。"

    reasoning_steps.append({
        "step_type": "conclude",
        "content": conclusion,
        "timestamp": "",
    })

    chart_spec = {"type": "bar", "title": question[:50]}
    if len(columns) >= 2 and len(rows) <= 10:
        chart_spec["type"] = "bar"
    elif len(rows) == 1:
        chart_spec["type"] = "kpi"

    return {
        "conclusion": conclusion,
        "chart_spec": chart_spec,
        "reasoning_steps": reasoning_steps,
    }


@StrategyRegistry.register
class StatisticalStrategy(StrategyBase):
    name = "statistical"
    display_name = "统计分析"
    description = "相关性分析、分布统计、TOP N排名"
    trigger_keywords = ["相关", "分布", "占比", "TOP", "top", "排名", "最高", "最低"]

    def can_handle(self, intent: str, question: str) -> float:
        score = 0.0
        for kw in self.trigger_keywords:
            if kw in question:
                score = max(score, 0.7)
        if "statistical" in intent.lower() or "统计" in intent:
            score = max(score, 0.8)
        return score

    def build_subgraph(self) -> CompiledGraph:
        builder = StateGraph(AgentState)

        builder.add_node("plan", _statistical_plan_node)
        builder.add_node("sql_gen", sql_gen_node)
        builder.add_node("execute", execute_node)
        builder.add_node("conclude", _statistical_conclude_node)

        builder.set_entry_point("plan")
        builder.add_edge("plan", "sql_gen")
        builder.add_edge("sql_gen", "execute")
        builder.add_edge("execute", "conclude")
        builder.add_edge("conclude", END)

        return builder.compile()
