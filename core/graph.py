"""LangGraph attribution reasoning engine — assembles all nodes into a StateGraph."""
from __future__ import annotations
from langgraph.graph import StateGraph, END
from core.state import AgentState
from core.nodes.intent_node import intent_node
from core.nodes.sql_node import sql_node
from core.nodes.execute_node import execute_node
from core.nodes.reflect_node import reflect_node
from core.nodes.conclude_node import conclude_node


def should_continue(state: AgentState) -> str:
    """Conditional router after the reflect node."""
    if state.get("done") or state.get("error"):
        return "conclude"
    if len(state.get("steps", [])) >= state.get("max_steps", 8):
        return "conclude"
    return "sql"


def build_graph() -> StateGraph:
    g = StateGraph(AgentState)

    g.add_node("intent", intent_node)
    g.add_node("sql", sql_node)
    g.add_node("execute", execute_node)
    g.add_node("reflect", reflect_node)
    g.add_node("conclude", conclude_node)

    g.set_entry_point("intent")
    g.add_edge("intent", "sql")
    g.add_edge("sql", "execute")
    g.add_edge("execute", "reflect")
    g.add_conditional_edges(
        "reflect",
        should_continue,
        {"sql": "sql", "conclude": "conclude"},
    )
    g.add_edge("conclude", END)

    return g.compile()
