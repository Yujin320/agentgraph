"""Comparative analysis strategy — period/dimension comparison."""
from __future__ import annotations

import logging

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph as CompiledGraph

from core.reasoning.strategies.base import StrategyBase, StrategyRegistry
from core.reasoning.state import AgentState
from core.reasoning.nodes import sql_gen_node, execute_node

logger = logging.getLogger(__name__)


def _comparative_plan_node(state: dict) -> dict:
    """Generate a comparative analysis plan."""
    reasoning_steps = list(state.get("reasoning_steps", []))
    reasoning_steps.append({
        "step_type": "plan",
        "content": "对比分析: 识别对比维度 → 生成对比SQL → 计算差异 → 结论",
        "timestamp": "",
    })

    plan = ["识别对比维度和时间段", "生成对比查询SQL", "执行查询", "分析差异并生成结论"]
    return {
        "plan": plan,
        "current_step_index": 0,
        "reasoning_steps": reasoning_steps,
    }


def _comparative_conclude_node(state: dict) -> dict:
    """Synthesize comparative analysis conclusion."""
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
            f"对比查询结果:\n列: {columns}\n"
            f"数据: {json.dumps(rows[:20], ensure_ascii=False, default=str)}\n\n"
            f"请用业务语言解读对比分析结果，突出差异和变化趋势（200字以内）:"
        )
        response = llm.invoke([
            SystemMessage(content="你是数据分析顾问，擅长同比环比和维度对比分析。"),
            HumanMessage(content=prompt),
        ])
        conclusion = response.content.strip()
    except Exception:
        conclusion = f"对比分析完成，返回 {len(rows)} 行数据。"

    reasoning_steps.append({
        "step_type": "conclude",
        "content": conclusion,
        "timestamp": "",
    })

    chart_spec = {"type": "bar", "title": question[:50]}

    return {
        "conclusion": conclusion,
        "chart_spec": chart_spec,
        "reasoning_steps": reasoning_steps,
    }


@StrategyRegistry.register
class ComparativeStrategy(StrategyBase):
    name = "comparative"
    display_name = "对比分析"
    description = "同比/环比/维度对比分析"
    trigger_keywords = ["对比", "比较", "同比", "环比", "差异", "vs", "VS"]

    def can_handle(self, intent: str, question: str) -> float:
        score = 0.0
        for kw in self.trigger_keywords:
            if kw in question:
                score = max(score, 0.7)
        if "comparative" in intent.lower() or "对比" in intent:
            score = max(score, 0.8)
        return score

    def build_subgraph(self) -> CompiledGraph:
        builder = StateGraph(AgentState)

        builder.add_node("plan", _comparative_plan_node)
        builder.add_node("sql_gen", sql_gen_node)
        builder.add_node("execute", execute_node)
        builder.add_node("conclude", _comparative_conclude_node)

        builder.set_entry_point("plan")
        builder.add_edge("plan", "sql_gen")
        builder.add_edge("sql_gen", "execute")
        builder.add_edge("execute", "conclude")
        builder.add_edge("conclude", END)

        return builder.compile()
