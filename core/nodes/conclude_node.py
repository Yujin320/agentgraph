"""Conclude node — generates the final natural-language attribution conclusion."""
from __future__ import annotations
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from knowledge.workspace import Workspace

load_dotenv()

_SYSTEM = (
    "你是一位专业的业务数据分析师，擅长用简洁的中文总结多步归因分析的结论。"
    "请根据以下分析链条，给出2-3句话的归因结论，说明根本原因及其对核心指标的影响路径。"
    "只输出结论文字，不要列表、不要标题、不要Markdown格式。"
)


def _build_chain_summary(steps: list) -> str:
    lines = []
    for i, step in enumerate(steps, 1):
        label = step.get("node_label") or step.get("node_id", f"步骤{i}")
        value = step.get("metric_value")
        threshold = step.get("threshold")
        status = step.get("status", "unknown")
        desc = step.get("explanation", "")
        v_str = f"{value:.4g}" if isinstance(value, (int, float)) else str(value)
        t_str = f"{threshold:.4g}" if isinstance(threshold, (int, float)) else str(threshold)
        status_cn = {"abnormal": "异常", "normal": "正常", "error": "错误"}.get(status, status)
        lines.append(
            f"第{i}步 [{label}]: 指标值={v_str}, 阈值={t_str}, 状态={status_cn}. {desc}"
        )
    return "\n".join(lines)


def _get_llm(workspace: Workspace) -> ChatOpenAI:
    wc = workspace.llm_config
    return ChatOpenAI(
        base_url=wc.get("base_url") or os.getenv("LLM_BASE_URL") or None,
        api_key=wc.get("api_key") or os.getenv("LLM_API_KEY") or "sk-placeholder",
        model=wc.get("model") or os.getenv("LLM_MODEL") or "gpt-4o",
        temperature=0.3,
    )


def conclude_node(state: dict) -> dict:
    steps: list = state.get("steps", [])
    error: str | None = state.get("error")

    if error:
        conclusion = f"分析过程中发生错误，无法完成归因：{error}"
        return {"conclusion": conclusion, "done": True}

    if not steps:
        conclusion = "未收集到任何分析步骤，无法生成结论。"
        return {"conclusion": conclusion, "done": True}

    chain_summary = _build_chain_summary(steps)
    question = state.get("question", "")
    prompt = f"原始问题：{question}\n\n分析链条：\n{chain_summary}"

    try:
        ws: Workspace = Workspace.get(state["workspace"])
        llm = _get_llm(ws)
        response = llm.invoke([SystemMessage(content=_SYSTEM), HumanMessage(content=prompt)])
        conclusion = response.content.strip()
    except Exception as exc:
        # Fallback: build a rule-based conclusion
        abnormal_steps = [s for s in steps if s.get("status") == "abnormal"]
        if abnormal_steps:
            root = abnormal_steps[-1]
            conclusion = (
                f"归因分析发现，{root.get('node_label', '末端节点')}指标异常"
                f"（当前值 {root.get('metric_value')}，阈值 {root.get('threshold')}），"
                "是本次问题的根本原因。"
            )
        else:
            conclusion = "各指标均在正常范围内，未发现明显异常根因。"

    return {"conclusion": conclusion, "done": True}
