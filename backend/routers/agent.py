"""
Agentic chat endpoints — LangGraph-based reasoning with HITL support.

POST /api/workspaces/{ws}/chat/agent   — Start agentic chat (SSE stream)
POST /api/workspaces/{ws}/chat/resume  — Resume after human SQL approval
GET  /api/strategies                   — List available analysis strategies
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from knowledge.workspace import Workspace

logger = logging.getLogger(__name__)
router = APIRouter(tags=["agent"])


# ── Request/Response models ──────────────────────────────────────────────

class AgentChatRequest(BaseModel):
    question: str
    session_id: str = "default"
    strategy: str = "auto"  # "auto" | "causal" | "statistical" | ...
    enable_hitl: bool = False  # if True, pause before SQL execution for approval


class ResumeRequest(BaseModel):
    thread_id: str
    approved_sql: Optional[str] = None  # None = abort


# ── SSE helpers ──────────────────────────────────────────────────────────

def _sse(event: str, payload: dict) -> str:
    """Format a named SSE event."""
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


# ── Helpers ──────────────────────────────────────────────────────────────

def _get_ws_or_404(name: str) -> Workspace:
    try:
        return Workspace.get(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Graph cache ──────────────────────────────────────────────────────────

_GRAPH_CACHE = {}
_GRAPH_CACHE_NO_HITL = {}


def _get_agent_graph(enable_hitl: bool = False):
    """Get or build the compiled agent graph (cached)."""
    cache = _GRAPH_CACHE if enable_hitl else _GRAPH_CACHE_NO_HITL
    if "graph" not in cache:
        from core.reasoning.graph import build_agent_graph as _build_hitl
        if enable_hitl:
            cache["graph"] = _build_hitl()
        else:
            # Build without interrupt_before for non-HITL mode
            from langgraph.graph import StateGraph, END
            from langgraph.checkpoint.memory import MemorySaver
            from core.reasoning.state import AgentState
            from core.reasoning.nodes import (
                intent_node, plan_node, sql_gen_node,
                execute_node, reflect_node, conclude_node,
                route_after_reflect,
            )

            builder = StateGraph(AgentState)
            builder.add_node("intent", intent_node)
            builder.add_node("plan", plan_node)
            builder.add_node("sql_gen", sql_gen_node)
            builder.add_node("execute", execute_node)
            builder.add_node("reflect", reflect_node)
            builder.add_node("conclude", conclude_node)

            builder.set_entry_point("intent")
            builder.add_edge("intent", "plan")
            builder.add_edge("plan", "sql_gen")
            builder.add_edge("sql_gen", "execute")
            builder.add_edge("execute", "reflect")
            builder.add_conditional_edges(
                "reflect",
                route_after_reflect,
                {"sql_gen": "sql_gen", "conclude": "conclude"},
            )
            builder.add_edge("conclude", END)

            checkpointer = MemorySaver()
            cache["graph"] = builder.compile(checkpointer=checkpointer)

    return cache["graph"]


# ── Streaming execution ──────────────────────────────────────────────────

async def _stream_agent(
    workspace: str,
    question: str,
    session_id: str,
    strategy: str,
    enable_hitl: bool,
) -> AsyncGenerator[str, None]:
    """Run the agent graph and stream named SSE events."""
    thread_id = f"{session_id}-{uuid.uuid4().hex[:8]}"

    yield _sse("thinking", {"content": "分析问题意图..."})

    graph = _get_agent_graph(enable_hitl=enable_hitl)

    initial_state = {
        "workspace": workspace,
        "question": question,
        "thread_id": thread_id,
        "strategy": strategy if strategy != "auto" else "",
        "intent": "",
        "plan": [],
        "current_step_index": 0,
        "reasoning_steps": [],
        "current_sql": None,
        "sql_result": None,
        "sql_error": None,
        "retry_count": 0,
        "max_retries": 3,
        "pending_approval": False,
        "user_edited_sql": None,
        "conclusion": None,
        "attribution_paths": [],
        "chart_spec": None,
        "drill_depth": 0,
        "max_drill_depth": 3,
        "messages": [],
    }

    config = {"configurable": {"thread_id": thread_id}}

    loop = asyncio.get_event_loop()

    try:
        # Run graph in executor to avoid blocking the event loop
        # We use astream_events for fine-grained streaming
        last_emitted = set()

        async for event in graph.astream(initial_state, config=config, stream_mode="updates"):
            # event is a dict {node_name: state_update}
            for node_name, output in event.items():
                if not isinstance(output, dict):
                    continue

                # Emit node-specific SSE events
                if node_name == "intent" and "intent" not in last_emitted:
                    last_emitted.add("intent")
                    yield _sse("intent", {
                        "intent": output.get("intent", ""),
                        "strategy": output.get("strategy", ""),
                    })

                elif node_name == "plan" and "plan" not in last_emitted:
                    last_emitted.add("plan")
                    yield _sse("planning", {
                        "steps": output.get("plan", []),
                    })

                elif node_name == "sql_gen":
                    sql = output.get("current_sql", "")
                    if sql:
                        yield _sse("sql_ready", {
                            "sql": sql,
                            "step": output.get("current_step_index", 0),
                        })
                        if enable_hitl:
                            yield _sse("awaiting_approval", {
                                "sql": sql,
                                "thread_id": thread_id,
                            })

                elif node_name == "execute":
                    sql_result = output.get("sql_result", {})
                    yield _sse("executing", {
                        "sql": output.get("current_sql", ""),
                    })
                    if sql_result:
                        yield _sse("result", {
                            "columns": sql_result.get("columns", []),
                            "rows": sql_result.get("rows", [])[:100],
                            "row_count": sql_result.get("row_count", 0),
                            "error": sql_result.get("error"),
                        })

                elif node_name == "reflect":
                    steps = output.get("reasoning_steps", [])
                    if steps:
                        last_step = steps[-1]
                        decision = "continue"
                        content = last_step.get("content", "")
                        if "conclude" in content.lower():
                            decision = "conclude"
                        elif "重试" in content:
                            decision = "retry"
                        elif "drill" in content.lower():
                            decision = "drill"
                        yield _sse("reflecting", {
                            "content": content,
                            "decision": decision,
                        })

                elif node_name == "conclude":
                    conclusion = output.get("conclusion", "")
                    if conclusion:
                        yield _sse("conclusion", {
                            "content": conclusion,
                            "attribution_paths": output.get("attribution_paths", []),
                        })
                    chart_spec = output.get("chart_spec")
                    if chart_spec:
                        yield _sse("chart", chart_spec)

    except Exception as exc:
        logger.exception("Agent graph execution failed")
        yield _sse("error", {"message": str(exc)})

    yield _sse("done", {})


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/workspaces/{ws}/chat/agent")
async def agent_chat(ws: str, body: AgentChatRequest):
    """Agentic chat endpoint using LangGraph — streams SSE events."""
    _get_ws_or_404(ws)
    return StreamingResponse(
        _stream_agent(
            workspace=ws,
            question=body.question,
            session_id=body.session_id,
            strategy=body.strategy,
            enable_hitl=body.enable_hitl,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/workspaces/{ws}/chat/resume")
async def resume_chat(ws: str, body: ResumeRequest):
    """Resume agent execution after human approval of SQL.

    If approved_sql is None, the graph execution is aborted.
    If approved_sql is a string, it replaces the generated SQL and execution continues.
    """
    _get_ws_or_404(ws)

    if body.approved_sql is None:
        return {"status": "aborted", "thread_id": body.thread_id}

    graph = _get_agent_graph(enable_hitl=True)
    config = {"configurable": {"thread_id": body.thread_id}}

    # Update the graph state with user-edited SQL
    try:
        await graph.aupdate_state(
            config,
            {"user_edited_sql": body.approved_sql, "pending_approval": False},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to update state: {exc}")

    # Stream the continued execution
    async def _resume_stream() -> AsyncGenerator[str, None]:
        try:
            async for event in graph.astream(None, config=config, stream_mode="updates"):
                for node_name, output in event.items():
                    if not isinstance(output, dict):
                        continue

                    if node_name == "sql_gen":
                        sql = output.get("current_sql", "")
                        if sql:
                            yield _sse("sql_ready", {"sql": sql})

                    elif node_name == "execute":
                        sql_result = output.get("sql_result", {})
                        if sql_result:
                            yield _sse("result", {
                                "columns": sql_result.get("columns", []),
                                "rows": sql_result.get("rows", [])[:100],
                                "row_count": sql_result.get("row_count", 0),
                                "error": sql_result.get("error"),
                            })

                    elif node_name == "reflect":
                        steps = output.get("reasoning_steps", [])
                        if steps:
                            yield _sse("reflecting", {
                                "content": steps[-1].get("content", ""),
                            })

                    elif node_name == "conclude":
                        conclusion = output.get("conclusion", "")
                        if conclusion:
                            yield _sse("conclusion", {
                                "content": conclusion,
                                "attribution_paths": output.get("attribution_paths", []),
                            })
                        chart_spec = output.get("chart_spec")
                        if chart_spec:
                            yield _sse("chart", chart_spec)

        except Exception as exc:
            logger.exception("Resume graph execution failed")
            yield _sse("error", {"message": str(exc)})

        yield _sse("done", {})

    return StreamingResponse(
        _resume_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/strategies")
def list_strategies():
    """List all registered analysis strategies."""
    try:
        from core.reasoning.strategies import StrategyRegistry
        return {
            "strategies": [s.meta() for s in StrategyRegistry.list_all()],
        }
    except Exception as exc:
        return {"strategies": [], "error": str(exc)}
