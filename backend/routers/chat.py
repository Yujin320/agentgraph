"""
SSE streaming chat endpoint.

POST /api/chat
Request body: {question: str, workspace: str, session_id: str}

Streams LangGraph node outputs as SSE events:
  - type "step"       — a reasoning step completed
  - type "sql"        — the generated SQL
  - type "result"     — SQL execution result (columns + rows, max 100 rows)
  - type "conclusion" — final conclusion text
  - type "done"       — stream finished
"""
from __future__ import annotations
import json
import traceback
from typing import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.state import AgentState

router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    question: str
    workspace: str = "supply-chain"
    session_id: str = "default"


def _sse(payload: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _stream_graph(state: AgentState) -> AsyncGenerator[str, None]:
    """Run the LangGraph pipeline and yield SSE events for each node output."""
    try:
        from core.graph import build_graph  # noqa: PLC0415 — lazy import keeps startup fast
    except ImportError as exc:
        yield _sse({"type": "error", "message": f"Graph not available: {exc}"})
        yield _sse({"type": "done"})
        return

    try:
        graph = build_graph()
    except Exception as exc:
        yield _sse({"type": "error", "message": f"Failed to build graph: {exc}"})
        yield _sse({"type": "done"})
        return

    try:
        async for chunk in graph.astream(state):
            # chunk is a dict of {node_name: output_dict}
            for node_name, output in chunk.items():
                if not isinstance(output, dict):
                    continue

                # Emit step events from the steps list
                new_steps: list = output.get("steps", [])
                for step in new_steps:
                    yield _sse({
                        "type": "step",
                        "node_id": step.get("node_id", ""),
                        "node_label": step.get("node_label", node_name),
                        "metric_value": step.get("metric_value"),
                        "threshold": step.get("threshold"),
                        "status": step.get("status", ""),
                        "explanation": step.get("explanation", ""),
                    })

                # Emit SQL event when sql is set
                if output.get("sql"):
                    yield _sse({
                        "type": "sql",
                        "sql": output["sql"],
                        "node": node_name,
                    })

                # Emit result event when sql_result is set
                if output.get("sql_result"):
                    sql_result: dict = output["sql_result"]
                    rows = sql_result.get("rows", [])
                    yield _sse({
                        "type": "result",
                        "columns": sql_result.get("columns", []),
                        "rows": rows[:100],
                        "row_count": sql_result.get("row_count", len(rows)),
                        "error": sql_result.get("error"),
                    })

                # Emit conclusion event
                if output.get("conclusion"):
                    yield _sse({
                        "type": "conclusion",
                        "text": output["conclusion"],
                        "chart_hint": output.get("chart_hint", "table"),
                    })

                # Emit done only after conclusion is present (conclude_node sets both)
                if output.get("done") and output.get("conclusion"):
                    yield _sse({"type": "done"})
                    return

    except Exception as exc:
        tb = traceback.format_exc()
        yield _sse({"type": "error", "message": str(exc), "traceback": tb})

    yield _sse({"type": "done"})


@router.post("/chat")
async def chat_endpoint(body: ChatRequest):
    state: AgentState = {
        "session_id": body.session_id,
        "workspace": body.workspace,
        "question": body.question,
        # Defaults — graph nodes will fill these in
        "intent": {},
        "causal_path": [],
        "steps": [],
        "current_node": "",
        "max_steps": 8,
        "sql": "",
        "sql_result": {},
        "reflection": {},
        "conclusion": "",
        "chart_hint": "table",
        "done": False,
        "error": None,
    }

    return StreamingResponse(
        _stream_graph(state),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
