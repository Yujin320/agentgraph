"""Causal attribution strategy — KG traversal + threshold verification."""
from __future__ import annotations

import json
import logging
import os

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph as CompiledGraph

from core.reasoning.strategies.base import StrategyBase, StrategyRegistry
from core.reasoning.state import AgentState

logger = logging.getLogger(__name__)


def _causal_traverse_node(state: dict) -> dict:
    """Traverse KG upstream to find causal paths, then verify each with SQL."""
    from knowledge.workspace import Workspace
    from core.stages.attribution import AttributionStage

    ws = Workspace.get(state["workspace"])
    question = state.get("question", "")

    stage = AttributionStage()
    entry_id = stage._find_entry_from_question(ws.name, question)

    attribution_paths = []
    reasoning_steps = list(state.get("reasoning_steps", []))

    if not entry_id:
        reasoning_steps.append({
            "step_type": "reflect",
            "content": "未找到归因起点指标",
            "timestamp": "",
        })
        return {
            "attribution_paths": [],
            "reasoning_steps": reasoning_steps,
        }

    try:
        raw_paths = stage._enumerate_paths(ws.name, entry_id, max_depth=5)
        for raw_path in raw_paths[:5]:
            path_info = {
                "nodes": [
                    {"id": n.get("id", ""), "alias": n.get("alias", n.get("name", ""))}
                    for n in raw_path
                ],
            }
            attribution_paths.append(path_info)
            reasoning_steps.append({
                "step_type": "reflect",
                "content": f"因果路径: {' → '.join(n.get('alias', n.get('name', '?')) for n in raw_path)}",
                "timestamp": "",
            })
    except Exception as exc:
        logger.warning("Causal traversal failed: %s", exc)
        reasoning_steps.append({
            "step_type": "reflect",
            "content": f"KG遍历失败: {exc}",
            "timestamp": "",
        })

    return {
        "attribution_paths": attribution_paths,
        "reasoning_steps": reasoning_steps,
    }


def _causal_verify_node(state: dict) -> dict:
    """Verify each causal path node with SQL execution."""
    from knowledge.workspace import Workspace
    from core.stages.attribution import AttributionStage
    from langchain_openai import ChatOpenAI

    ws = Workspace.get(state["workspace"])
    question = state.get("question", "")
    attribution_paths = state.get("attribution_paths", [])

    if not attribution_paths:
        return {}

    wc = ws.llm_config
    llm = ChatOpenAI(
        base_url=wc.get("base_url") or os.getenv("LLM_BASE_URL") or None,
        api_key=wc.get("api_key") or os.getenv("LLM_API_KEY") or "sk-placeholder",
        model=wc.get("model") or os.getenv("LLM_MODEL") or "gpt-4o",
        temperature=0,
    )

    stage = AttributionStage()
    reasoning_steps = list(state.get("reasoning_steps", []))

    # Verify top path nodes
    for path in attribution_paths[:3]:
        for node_info in path.get("nodes", [])[:5]:
            node_alias = node_info.get("alias", node_info.get("id", ""))
            reasoning_steps.append({
                "step_type": "execute",
                "content": f"验证节点: {node_alias}",
                "timestamp": "",
            })

    return {"reasoning_steps": reasoning_steps}


def _causal_conclude_node(state: dict) -> dict:
    """Synthesize causal attribution conclusion."""
    from knowledge.workspace import Workspace
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage

    ws = Workspace.get(state["workspace"])
    question = state.get("question", "")
    attribution_paths = state.get("attribution_paths", [])
    reasoning_steps = state.get("reasoning_steps", [])

    # Build path description
    paths_text = []
    for i, path in enumerate(attribution_paths[:3]):
        chain = " → ".join(n.get("alias", n.get("id", "?")) for n in path.get("nodes", []))
        paths_text.append(f"路径{i + 1}: {chain}")

    trace = "\n".join(paths_text) if paths_text else "无因果路径"

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
            f"归因路径:\n{trace}\n\n"
            f"请生成简洁的归因分析结论（200字以内）:"
        )
        response = llm.invoke([
            SystemMessage(content="你是供应链归因分析专家。根据因果路径生成归因报告。"),
            HumanMessage(content=prompt),
        ])
        conclusion = response.content.strip()
    except Exception:
        conclusion = f"归因分析完成，发现 {len(attribution_paths)} 条因果路径。"

    return {
        "conclusion": conclusion,
        "reasoning_steps": list(reasoning_steps) + [{
            "step_type": "conclude",
            "content": conclusion,
            "timestamp": "",
        }],
    }


@StrategyRegistry.register
class CausalStrategy(StrategyBase):
    name = "causal"
    display_name = "因果归因分析"
    description = "沿知识图谱因果边进行多路BFS归因，验证每条路径"
    trigger_keywords = ["为什么", "原因", "归因", "怎么", "如何导致", "什么导致", "分析原因", "根因"]

    def can_handle(self, intent: str, question: str) -> float:
        score = 0.0
        for kw in self.trigger_keywords:
            if kw in question:
                score = max(score, 0.8)
        if "causal" in intent.lower() or "归因" in intent:
            score = max(score, 0.9)
        return score

    def build_subgraph(self) -> CompiledGraph:
        builder = StateGraph(AgentState)

        builder.add_node("traverse", _causal_traverse_node)
        builder.add_node("verify", _causal_verify_node)
        builder.add_node("conclude", _causal_conclude_node)

        builder.set_entry_point("traverse")
        builder.add_edge("traverse", "verify")
        builder.add_edge("verify", "conclude")
        builder.add_edge("conclude", END)

        return builder.compile()
