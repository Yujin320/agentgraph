"""Planner Agent — intent classification and Analysis Chain instantiation.

Corresponds to Section 4.3.1 of the AgentGraph paper.

Responsibilities:
  1. Classify the natural-language goal q into an analytical intent
     (causal_attribution, impact_analysis, comparative, trend, whatif, general).
  2. Retrieve matching Analysis Patterns from the Domain Knowledge Layer.
  3. Instantiate an Analysis Chain C from the matched template, or construct
     one from scratch via LLM reasoning over the ontology subgraph.
"""
from __future__ import annotations

import json
import logging
import re

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from core.reasoning.state import AgentState, AnalysisStep, StepType
from knowledge.workspace import Workspace

load_dotenv()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Keyword-based intent classification (fast path before LLM)
# ---------------------------------------------------------------------------

_CAUSAL_KW    = ["为什么", "原因", "归因", "怎么", "如何导致", "什么导致", "分析原因", "根因"]
_COMPARATIVE_KW = ["对比", "比较", "同比", "环比", "差异", "vs", "VS"]
_TREND_KW     = ["趋势", "走势", "变化", "历史", "近几个月", "近几年"]
_STATISTICAL_KW = ["相关", "分布", "占比", "TOP", "top", "排名", "最高", "最低"]
_WHATIF_KW    = ["如果", "假设", "模拟", "预测", "假如"]


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_INTENT_PROMPT = """\
你是智能分析助手。请分析用户问题的意图，并分类到以下策略之一：
- causal_attribution: 归因分析（为什么、原因、根因）
- impact_analysis: 影响分析（影响范围、波及、传播）
- comparative: 对比分析（对比、比较、同比、环比）
- trend: 趋势分析（趋势、走势、变化、历史）
- whatif: 假设分析（如果、假设、模拟、预测）
- general: 一般查询（其他）

用户问题: {question}

返回严格JSON（不要markdown代码块）：
{{"intent": "意图简要描述", "strategy": "策略名称"}}
"""

_PLAN_PROMPT = """\
你是分析规划专家。根据用户问题、分析策略和领域知识，制定分步分析计划。

用户问题: {question}
分析策略: {strategy}
意图描述: {intent}

领域上下文（匹配的Analysis Pattern）:
{pattern_context}

Schema上下文:
{schema_context}

要求：
- 每步用简短描述（10-20字），对应一个原子分析操作
- 步骤数量2-6个
- 每步标注操作类型: CypherQuery | GraphAlgorithm | MetricCheck | PatternMatch | Aggregate
- 归因分析需包含: 入口指标检查 → 上游追溯 → 验证 → 综合

返回严格JSON（不要markdown代码块）：
{{"steps": [{{"description": "步骤描述", "step_type": "CypherQuery"}}]}}
"""


def _get_llm(workspace: Workspace) -> ChatOpenAI:
    wc = workspace.llm_config
    return ChatOpenAI(
        base_url=wc.get("base_url") or None,
        api_key=wc.get("api_key") or "sk-placeholder",
        model=wc.get("model") or "gpt-4o",
        temperature=0,
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


def _retrieve_analysis_patterns(ws: Workspace, question: str, strategy: str) -> str:
    """Retrieve top-k matching Analysis Patterns from the Domain Knowledge Layer.

    Patterns are stored in causal_graph.json under 'analysis_patterns'.
    Matching uses trigger keyword overlap (lightweight; no vector search required
    for the small pattern library of ~12 entries).
    """
    try:
        causal = ws.get_causal_graph()
        patterns = causal.get("analysis_patterns", [])
        if not patterns:
            # Fall back to causal_chains for backward compatibility
            patterns = causal.get("causal_chains", [])

        if not patterns:
            return "(no analysis patterns registered)"

        q_lower = question.lower()
        scored = []
        for p in patterns:
            trigger = p.get("trigger", "")
            # Score = number of trigger keywords present in question
            score = sum(1 for kw in trigger.lower().split() if kw in q_lower)
            # Boost if strategy matches domain
            if strategy in p.get("domain", "").lower():
                score += 2
            scored.append((score, p))

        # Take top-3 (k=3 per paper §4.1.2)
        top = sorted(scored, key=lambda x: x[0], reverse=True)[:3]
        if not top or top[0][0] == 0:
            return "(no matching patterns found)"

        lines = []
        for _, p in top:
            lines.append(
                f"Pattern: {p.get('name', '?')}\n"
                f"  Trigger: {p.get('trigger', '')}\n"
                f"  Steps: {p.get('steps', [])}\n"
                f"  Domain: {p.get('domain', '')}"
            )
        return "\n\n".join(lines)
    except Exception as exc:
        logger.debug("Pattern retrieval failed (non-critical): %s", exc)
        return "(pattern retrieval unavailable)"


def _build_schema_context(ws: Workspace, question: str) -> str:
    """Retrieve focused schema context from the Knowledge Layer."""
    try:
        from core.stages.text_to_sql import TextToSqlStage
        stage = TextToSqlStage()
        kg_context = stage._retrieve_kg_context(ws.name, question)
        return stage._build_focused_schema(ws, kg_context)
    except Exception:
        return ""


# ═══════════════════════════════════════════════════════════════════════════
# Planner node — entry point for the Agent Orchestration Layer
# ═══════════════════════════════════════════════════════════════════════════

def planner_node(state: AgentState) -> dict:
    """Planner Agent: classify intent → retrieve patterns → instantiate chain.

    Returns state updates:
      - strategy, intent: classified analytical intent
      - analysis_chain: list of AnalysisStep dicts
      - current_step_index: 0 (reset)
      - reasoning_steps: updated trace
    """
    question = state.get("question", "")
    ws = Workspace.get(state["workspace"])

    # ── Step 1: Intent classification (keyword fast-path + LLM refinement) ──
    strategy = "general"
    if any(kw in question for kw in _CAUSAL_KW):
        strategy = "causal_attribution"
    elif any(kw in question for kw in _COMPARATIVE_KW):
        strategy = "comparative"
    elif any(kw in question for kw in _TREND_KW):
        strategy = "trend"
    elif any(kw in question for kw in _STATISTICAL_KW):
        strategy = "statistical"
    elif any(kw in question for kw in _WHATIF_KW):
        strategy = "whatif"

    intent_desc = question
    try:
        llm = _get_llm(ws)
        parsed = _parse_json(
            llm.invoke([HumanMessage(content=_INTENT_PROMPT.format(question=question))]).content
        )
        if parsed.get("strategy"):
            strategy = parsed["strategy"]
        if parsed.get("intent"):
            intent_desc = parsed["intent"]
    except Exception as exc:
        logger.warning("LLM intent classification failed, using keyword fallback: %s", exc)

    # ── Step 2: Retrieve Analysis Patterns from Domain Knowledge Layer ──
    pattern_context = _retrieve_analysis_patterns(ws, question, strategy)
    schema_context = _build_schema_context(ws, question)

    # ── Step 3: Instantiate Analysis Chain ──
    raw_steps = [
        {"description": "生成查询", "step_type": "CypherQuery"},
        {"description": "执行分析", "step_type": "CypherQuery"},
        {"description": "综合结论", "step_type": "Aggregate"},
    ]
    try:
        llm = _get_llm(ws)
        parsed = _parse_json(
            llm.invoke([HumanMessage(content=_PLAN_PROMPT.format(
                question=question,
                strategy=strategy,
                intent=intent_desc,
                pattern_context=pattern_context,
                schema_context=schema_context[:2000],
            ))]).content
        )
        if parsed.get("steps") and isinstance(parsed["steps"], list):
            raw_steps = parsed["steps"]
    except Exception as exc:
        logger.warning("LLM chain planning failed, using defaults: %s", exc)

    # Build typed AnalysisStep objects
    analysis_chain = []
    for i, s in enumerate(raw_steps):
        step = AnalysisStep(
            step_id=f"step_{i}",
            step_type=s.get("step_type", StepType.CYPHER_QUERY),
            description=s.get("description", f"Step {i + 1}"),
            status="pending",
        )
        analysis_chain.append(step.model_dump())

    reasoning_steps = list(state.get("reasoning_steps", []))
    reasoning_steps.append({
        "role": "planner",
        "content": f"Intent: {intent_desc} | Strategy: {strategy} | Chain: {len(analysis_chain)} steps",
    })

    return {
        "strategy": strategy,
        "intent": intent_desc,
        "analysis_chain": analysis_chain,
        "current_step_index": 0,
        "retry_count": 0,
        "branch_stack": [],
        "pending_approval": False,
        "reasoning_steps": reasoning_steps,
    }
