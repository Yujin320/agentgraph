"""Evaluator Agent — result assessment and Analysis Chain decision routing.

Corresponds to Section 4.3.3 of the AgentGraph paper.

After each Executor step, the Evaluator assesses the result along four
dimensions and emits one of five decisions that drive DAG transitions:

Assessment dimensions:
  1. Non-emptiness   — result contains at least one meaningful entity/value
  2. Goal proximity  — result reduces unresolved reasoning steps toward conclusion
  3. Sufficiency     — accumulated evidence definitively answers the goal q
  4. Anomaly         — result contains implausible values / hallucination indicators

Decision space:
  - continue        → advance to next planned step
  - branch          → new analysis direction found; Planner extends DAG
  - backtrack       → dead end; resume from last branch checkpoint
  - human_intervene → low confidence or self-healing exhausted; pause for analyst
  - terminate       → sufficiency criterion satisfied; compile report
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

load_dotenv()
logger = logging.getLogger(__name__)

# Token budget: when accumulated AgentState token estimate exceeds this
# fraction of the model context limit, compress completed step results.
CONTEXT_COMPRESSION_THRESHOLD = 0.6
COMPRESSION_TARGET_TOKENS = 200


_EVALUATOR_PROMPT = """\
你是分析质量评估专家。请对以下分析步骤的结果进行四维评估，并给出下一步决策。

分析目标: {goal}
当前步骤 ({step_index}/{total_steps}): {step_desc}
分析策略: {strategy}
已完成步骤数: {completed_steps}

当前步骤结果:
列: {columns}
数据（前10行）: {rows}
总行数: {row_count}
执行状态: {status}
修复次数: {repair_count}

四维评估指南：
1. non_emptiness: 结果是否包含有意义的实体或数值？
2. goal_proximity: 该结果是否缩短了到达结论的距离？
3. sufficiency: 当前累积证据是否已能回答分析目标？
4. anomaly: 结果中是否存在不合理数值或内部矛盾（LLM幻觉指示）？

决策规则：
- terminate: sufficiency=true，分析目标已达成
- continue: 结果有效但尚未充分，按计划继续下一步
- branch: 结果揭示了计划外的新分析方向
- backtrack: non_emptiness=false 且已无重试机会，退回上一分支点
- human_intervene: anomaly=true 或 repair_count>=3 或置信度极低

返回严格JSON（不要markdown代码块）：
{{
  "non_emptiness": true/false,
  "goal_proximity": "high/medium/low",
  "sufficiency": true/false,
  "anomaly": true/false,
  "decision": "continue|branch|backtrack|human_intervene|terminate",
  "confidence": 0.0-1.0,
  "reasoning": "决策理由（1-2句）",
  "branch_hint": "若decision=branch，描述新分析方向（否则为null）"
}}
"""

_COMPRESSION_PROMPT = """\
请将以下分析步骤结果压缩为不超过{target_tokens}个token的摘要。
保留：实体名称、异常指标、决策理由。删除：原始查询文本、完整数据行。

步骤历史:
{steps_text}

返回压缩摘要（纯文本，不要JSON）:
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


def _estimate_tokens(state: AgentState) -> int:
    """Rough token estimate of current AgentState (4 chars ≈ 1 token)."""
    return len(json.dumps(state, ensure_ascii=False, default=str)) // 4


def _compress_history(ws: Workspace, state: AgentState) -> list[dict]:
    """Compress completed step results when context window fills up."""
    chain = state.get("analysis_chain", [])
    step_idx = state.get("current_step_index", 0)
    completed = chain[:step_idx]
    if not completed:
        return chain

    steps_text = "\n".join(
        f"Step {i + 1} ({s.get('description', '?')}): "
        f"rows={s.get('result', {}).get('row_count', 0)}, "
        f"decision={s.get('evaluator_decision', '?')}, "
        f"note={s.get('evaluator_reasoning', '')}"
        for i, s in enumerate(completed)
    )
    try:
        summary = _get_llm(ws).invoke([HumanMessage(content=_COMPRESSION_PROMPT.format(
            target_tokens=COMPRESSION_TARGET_TOKENS,
            steps_text=steps_text,
        ))]).content.strip()
        # Replace completed step results with compressed summary
        compressed = [{"step_id": "summary", "description": "压缩历史", "summary": summary}]
        return compressed + chain[step_idx:]
    except Exception as exc:
        logger.warning("History compression failed (non-critical): %s", exc)
        return chain


# ═══════════════════════════════════════════════════════════════════════════
# Evaluator node
# ═══════════════════════════════════════════════════════════════════════════

def evaluator_node(state: AgentState) -> dict:
    """Evaluator Agent: 4-dimension assessment → 5-decision routing.

    Decoupling evaluation from execution is deliberate: an agent that both
    executes and evaluates cannot reliably distinguish an empty result
    reflecting a wrong query from one reflecting a true absence of entities.
    """
    ws = Workspace.get(state["workspace"])
    chain = list(state.get("analysis_chain", []))
    step_idx = state.get("current_step_index", 0)
    branch_stack = list(state.get("branch_stack", []))
    reasoning_steps = list(state.get("reasoning_steps", []))

    current_step = chain[step_idx] if step_idx < len(chain) else {}
    result = current_step.get("result", {})
    step_status = current_step.get("status", "")

    # ── Fast-path: executor signalled needs_human (self-healing exhausted) ──
    if step_status == "needs_human":
        reasoning_steps.append({
            "role": "evaluator",
            "content": "Self-healing exhausted → human_intervene",
            "decision": "human_intervene",
        })
        if step_idx < len(chain):
            chain[step_idx] = {**chain[step_idx], "evaluator_decision": "human_intervene"}
        return {
            "analysis_chain": chain,
            "reasoning_steps": reasoning_steps,
            "evaluator_decision": "human_intervene",
            "pending_approval": True,
        }

    # ── LLM 4-dimension assessment ──
    columns = result.get("columns", [])
    rows = result.get("rows", [])
    row_count = result.get("row_count", 0)
    repair_count = len(current_step.get("repair_log", []))

    assessment = {}
    try:
        llm = _get_llm(ws)
        assessment = _parse_json(llm.invoke([HumanMessage(content=_EVALUATOR_PROMPT.format(
            goal=state.get("question", ""),
            step_index=step_idx + 1,
            total_steps=len(chain),
            step_desc=current_step.get("description", ""),
            strategy=state.get("strategy", ""),
            completed_steps=step_idx,
            columns=columns,
            rows=json.dumps(rows[:10], ensure_ascii=False, default=str),
            row_count=row_count,
            status=step_status,
            repair_count=repair_count,
        ))]).content)
    except Exception as exc:
        logger.warning("LLM evaluation failed, defaulting to continue: %s", exc)
        assessment = {"decision": "continue", "confidence": 0.5, "reasoning": "LLM evaluation failed"}

    decision = assessment.get("decision", "continue")
    reasoning = assessment.get("reasoning", "")
    branch_hint = assessment.get("branch_hint")

    # ── Apply decision to Analysis Chain state ──
    if step_idx < len(chain):
        chain[step_idx] = {
            **chain[step_idx],
            "evaluator_decision": decision,
            "evaluator_reasoning": reasoning,
            "assessment": {
                "non_emptiness": assessment.get("non_emptiness"),
                "goal_proximity": assessment.get("goal_proximity"),
                "sufficiency": assessment.get("sufficiency"),
                "anomaly": assessment.get("anomaly"),
                "confidence": assessment.get("confidence"),
            },
        }

    updates: dict = {
        "analysis_chain": chain,
        "evaluator_decision": decision,
    }

    if decision == "continue":
        updates["current_step_index"] = step_idx + 1

    elif decision == "branch":
        # Checkpoint current context onto branch_stack before extending
        branch_stack.append({
            "step_index": step_idx,
            "chain_snapshot": [s.get("step_id") for s in chain],
            "branch_hint": branch_hint,
        })
        updates["branch_stack"] = branch_stack
        updates["current_step_index"] = step_idx + 1
        # Signal planner to re-invoke and extend the DAG
        updates["needs_replan"] = True
        updates["replan_hint"] = branch_hint

    elif decision == "backtrack":
        if branch_stack:
            checkpoint = branch_stack.pop()
            updates["current_step_index"] = checkpoint["step_index"]
            updates["branch_stack"] = branch_stack
        else:
            # No checkpoint → terminate gracefully
            decision = "terminate"
            updates["evaluator_decision"] = "terminate"

    elif decision == "human_intervene":
        updates["pending_approval"] = True

    elif decision == "terminate":
        pass  # conclude_node will be invoked next

    reasoning_steps.append({
        "role": "evaluator",
        "content": (
            f"Step {step_idx + 1}: decision={decision}, "
            f"confidence={assessment.get('confidence', '?'):.2f} — {reasoning}"
        ),
        "decision": decision,
    })
    updates["reasoning_steps"] = reasoning_steps

    # ── Context compression (§4.3.4) ──
    estimated = _estimate_tokens(state)
    model_limit = 128_000  # conservative default; overridden per backbone
    if estimated > model_limit * CONTEXT_COMPRESSION_THRESHOLD:
        updates["analysis_chain"] = _compress_history(ws, {**state, **updates})

    return updates


# ═══════════════════════════════════════════════════════════════════════════
# Routing function — determines next DAG transition
# ═══════════════════════════════════════════════════════════════════════════

def route_after_evaluator(state: AgentState) -> str:
    """Map Evaluator decision to next graph node.

    Decision → Node mapping:
      continue        → executor   (next Analysis Chain step)
      branch          → planner    (re-invoke Planner to extend DAG)
      backtrack       → executor   (resume from branch checkpoint)
      human_intervene → __end__    (pause; resume via /chat/resume)
      terminate       → conclude
    """
    decision = state.get("evaluator_decision", "continue")
    chain = state.get("analysis_chain", [])
    step_idx = state.get("current_step_index", 0)

    if decision == "terminate":
        return "conclude"
    if decision == "human_intervene":
        return "conclude"  # conclude with partial results
    if decision == "branch":
        return "planner"
    if decision == "backtrack":
        return "executor"
    # continue / default
    if step_idx >= len(chain):
        return "conclude"
    return "executor"
