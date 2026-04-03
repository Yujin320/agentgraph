"""Graph builder — assembles the agentic reasoning StateGraph."""
from __future__ import annotations

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from core.reasoning.state import AgentState
from core.reasoning.nodes import (
    intent_node,
    plan_node,
    sql_gen_node,
    execute_node,
    reflect_node,
    conclude_node,
    route_after_reflect,
)


def build_agent_graph():
    """Build and compile the agentic reasoning graph.

    Graph flow:
        intent → plan → sql_gen → execute → reflect →(conditional)→ sql_gen | conclude → END

    Human-in-the-loop: interrupt_before=["sql_gen"] allows the caller to
    inspect the planned SQL and optionally edit it before execution.
    """
    builder = StateGraph(AgentState)

    # Add nodes
    builder.add_node("intent", intent_node)
    builder.add_node("plan", plan_node)
    builder.add_node("sql_gen", sql_gen_node)
    builder.add_node("execute", execute_node)
    builder.add_node("reflect", reflect_node)
    builder.add_node("conclude", conclude_node)

    # Set entry point
    builder.set_entry_point("intent")

    # Linear edges
    builder.add_edge("intent", "plan")
    builder.add_edge("plan", "sql_gen")
    builder.add_edge("sql_gen", "execute")
    builder.add_edge("execute", "reflect")

    # Conditional edge from reflect
    builder.add_conditional_edges(
        "reflect",
        route_after_reflect,
        {"sql_gen": "sql_gen", "conclude": "conclude"},
    )

    # Terminal edge
    builder.add_edge("conclude", END)

    # Compile with checkpointer for HITL and memory
    checkpointer = MemorySaver()
    compiled = builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["sql_gen"],
    )

    return compiled
