"""AgentGraph reasoning engine — assembles Planner–Executor–Evaluator StateGraph.

Corresponds to Section 4.3 of the AgentGraph paper.

Graph topology:
    planner → executor → evaluator ──┬── continue ──→ executor
                          ↑          ├── branch ───→ planner (re-invoke)
                          └──────────├── backtrack → executor
                                     ├── human_intervene → conclude (partial)
                                     └── terminate ──→ conclude → END

Human-in-the-loop: interrupt_before=["executor"] allows the caller to
inspect and edit the generated query before execution via /chat/resume.
"""
from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from core.reasoning.evaluator import evaluator_node, route_after_evaluator
from core.reasoning.executor import executor_node
from core.reasoning.planner import planner_node
from core.reasoning.state import AgentState
from core.reasoning.nodes import conclude_node  # unchanged from original


def build_agent_graph():
    """Build and compile the Planner–Executor–Evaluator reasoning graph.

    Returns a compiled LangGraph StateGraph with MemorySaver checkpointing
    for HITL interrupt/resume support.
    """
    builder = StateGraph(AgentState)

    # ── Register nodes ──
    builder.add_node("planner",   planner_node)
    builder.add_node("executor",  executor_node)
    builder.add_node("evaluator", evaluator_node)
    builder.add_node("conclude",  conclude_node)

    # ── Entry point ──
    builder.set_entry_point("planner")

    # ── Fixed edges ──
    builder.add_edge("planner",  "executor")
    builder.add_edge("executor", "evaluator")
    builder.add_edge("conclude", END)

    # ── Conditional edges from Evaluator (5-decision space) ──
    builder.add_conditional_edges(
        "evaluator",
        route_after_evaluator,
        {
            "executor":  "executor",   # continue / backtrack
            "planner":   "planner",    # branch → re-invoke Planner
            "conclude":  "conclude",   # terminate / human_intervene (partial)
        },
    )

    # ── HITL: pause before executor so analyst can review/edit query ──
    checkpointer = MemorySaver()
    compiled = builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["executor"],
    )

    return compiled
