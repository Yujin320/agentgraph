"""
Pipeline setup endpoints.

POST /api/workspaces                              — Create workspace
POST /api/workspaces/{ws}/pipeline/create         — Initialize setup pipeline
GET  /api/workspaces/{ws}/pipeline                — Get pipeline state
POST /api/workspaces/{ws}/pipeline/run/{stage}    — Run a specific stage
POST /api/workspaces/{ws}/pipeline/next           — Run next pending stage
GET  /api/workspaces/{ws}/pipeline/result/{stage} — Get stage result
PUT  /api/workspaces/{ws}/pipeline/review/{stage} — Submit edited output
POST /api/workspaces/{ws}/pipeline/skip/{stage}   — Skip a stage
GET  /api/pipeline/stages                         — List all registered stages
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any, AsyncGenerator, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Ensure all stages are registered
import core.stages  # noqa: F401

from core.pipeline import PipelineOrchestrator
from core.stage import StageRegistry
from knowledge.workspace import Workspace
from backend.query_log import add_log

router = APIRouter(tags=["pipeline"])


# ── Request models ──────────────────────────────────────────────────────────

class WorkspaceCreateRequest(BaseModel):
    name: str
    db_url: str
    title: Optional[str] = None
    description: Optional[str] = None


class RunStageRequest(BaseModel):
    input: Optional[dict] = None
    config: Optional[dict] = None


class ReviewRequest(BaseModel):
    data: Any


# ── Helpers ─────────────────────────────────────────────────────────────────

def _get_ws_or_404(name: str) -> Workspace:
    try:
        return Workspace.get(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Workspace creation ───────────────────────────────────────────────────────

@router.post("/workspaces", status_code=201)
def create_workspace(body: WorkspaceCreateRequest):
    """Create a new workspace with the given name and DB connection."""
    try:
        ws = Workspace.create(
            body.name,
            {
                "title": body.title or body.name,
                "description": body.description or "",
                "database": {"url": body.db_url},
            },
        )
        return {
            "name": ws.name,
            "title": ws.title,
            "description": ws.description,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Pipeline lifecycle ───────────────────────────────────────────────────────

@router.post("/workspaces/{ws}/pipeline/create")
def create_pipeline(ws: str):
    """Initialize (or reset) the setup pipeline for a workspace."""
    _get_ws_or_404(ws)
    try:
        state = PipelineOrchestrator.create_pipeline(ws)
        return state
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/workspaces/{ws}/pipeline")
def get_pipeline(ws: str):
    """Return current pipeline state for a workspace."""
    _get_ws_or_404(ws)
    try:
        return PipelineOrchestrator.get_state(ws)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Stage execution ──────────────────────────────────────────────────────────

@router.post("/workspaces/{ws}/pipeline/run/{stage}")
async def run_stage(ws: str, stage: str, body: RunStageRequest = RunStageRequest()):
    """Run a specific stage (may involve LLM calls — wrapped in executor)."""
    _get_ws_or_404(ws)
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: PipelineOrchestrator.run_stage(
                ws, stage, input_data=body.input, config=body.config
            ),
        )
        return result.to_dict()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/workspaces/{ws}/pipeline/next")
async def run_next(ws: str):
    """Run the next pending stage (may involve LLM calls — wrapped in executor)."""
    _get_ws_or_404(ws)
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: PipelineOrchestrator.run_next(ws),
        )
        if result is None:
            return {"status": "no_pending", "message": "所有阶段已完成或无待执行阶段"}
        return result.to_dict()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Results ──────────────────────────────────────────────────────────────────

@router.get("/workspaces/{ws}/pipeline/result/{stage}")
def get_stage_result(ws: str, stage: str):
    """Return the persisted result for a completed stage."""
    _get_ws_or_404(ws)
    result = PipelineOrchestrator.get_stage_result(ws, stage)
    if result is None:
        raise HTTPException(status_code=404, detail=f"阶段 '{stage}' 尚无结果")
    return result


# ── Human review ─────────────────────────────────────────────────────────────

@router.put("/workspaces/{ws}/pipeline/review/{stage}")
def submit_review(ws: str, stage: str, body: ReviewRequest):
    """Accept human-edited stage output, persist it, and advance the pipeline."""
    _get_ws_or_404(ws)
    try:
        state = PipelineOrchestrator.submit_review(ws, stage, body.data)
        return state
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Skip ──────────────────────────────────────────────────────────────────────

@router.post("/workspaces/{ws}/pipeline/skip/{stage}")
def skip_stage(ws: str, stage: str):
    """Mark a stage as skipped and return updated pipeline state."""
    _get_ws_or_404(ws)
    try:
        state = PipelineOrchestrator.skip_stage(ws, stage)
        return state
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Stage metadata ────────────────────────────────────────────────────────────

@router.get("/pipeline/stages")
def list_stages():
    """List all registered pipeline stages with metadata."""
    return PipelineOrchestrator.list_stages()


# ── Knowledge Graph ───────────────────────────────────────────────────────────

@router.get("/workspaces/{ws}/kg")
def get_kg(ws: str):
    """Return KG nodes and edges for a workspace from Neo4j."""
    _get_ws_or_404(ws)
    import os
    from neo4j import GraphDatabase
    uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "dataagent")
    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        with driver.session() as session:
            # Fetch nodes
            node_result = session.run(
                "MATCH (n) WHERE n.workspace = $ws RETURN n",
                ws=ws
            )
            nodes = []
            for record in node_result:
                n = record["n"]
                props = dict(n.items())
                nodes.append({
                    "id": props.get("id", str(n.id)),
                    "label": props.get("alias") or props.get("name") or props.get("id", ""),
                    "type": list(n.labels)[0] if n.labels else "Unknown",
                    "table": props.get("table", ""),
                })
            # Fetch edges
            edge_result = session.run(
                "MATCH (a)-[r]->(b) WHERE a.workspace = $ws AND b.workspace = $ws RETURN a.id AS src, b.id AS dst, type(r) AS rel_type",
                ws=ws
            )
            edges = []
            for record in edge_result:
                edges.append({
                    "source": record["src"],
                    "target": record["dst"],
                    "type": record["rel_type"],
                })
        driver.close()
        return {"nodes": nodes, "edges": edges}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Workspace chat (pipeline-based SSE) ──────────────────────────────────────

class WorkspaceChatRequest(BaseModel):
    question: str
    session_id: str = "default"


def _is_attribution_question(question: str) -> bool:
    """Detect if the question is asking for causal attribution."""
    keywords = ["为什么", "原因", "归因", "怎么", "如何导致", "什么导致", "分析原因", "根因"]
    return any(kw in question for kw in keywords)


def _sse(event: str, payload: dict) -> str:
    """Format a named SSE event compatible with useChat hook."""
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _stream_pipeline_chat(ws: str, question: str, session_id: str) -> AsyncGenerator[str, None]:
    """Run text_to_sql or attribution stage and stream named SSE events."""
    use_attribution = _is_attribution_question(question)
    stage_name = "attribution" if use_attribution else "text_to_sql"
    log_id = str(uuid.uuid4())[:8]
    start_time = time.monotonic()

    # Emit session info
    yield _sse("session", {"session_id": session_id, "log_id": log_id})
    yield _sse("intent", {"mode": stage_name, "keywords": []})

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: PipelineOrchestrator.run_stage(
                ws, stage_name, input_data={"question": question}
            ),
        )
    except Exception as exc:
        duration_ms = int((time.monotonic() - start_time) * 1000)
        error_msg = str(exc)
        yield _sse("error", {"message": error_msg})
        yield _sse("done", {})
        try:
            add_log(ws, question, stage_name, status="error", duration_ms=duration_ms, error=error_msg)
        except Exception:
            pass
        return

    if result.status == "failed":
        duration_ms = int((time.monotonic() - start_time) * 1000)
        error_msg = "; ".join(result.errors or ["执行失败"])
        yield _sse("error", {"message": error_msg})
        yield _sse("done", {})
        try:
            add_log(ws, question, stage_name, status="error", duration_ms=duration_ms, error=error_msg)
        except Exception:
            pass
        return

    data = result.data or {}
    sql_logged = ""
    interpretation_logged = ""
    result_summary = ""

    if use_attribution:
        yield _sse("reasoning_start", {})
        paths = data.get("paths", [])
        step_num = 0
        for path in paths[:3]:  # top 3 paths
            for step in path.get("steps", []):
                step_num += 1
                yield _sse("reasoning_step", {
                    "step_number": step_num,
                    "causal_node": step.get("node_id", ""),
                    "node_label": step.get("alias", step.get("node_id", "")),
                    "metric_value": step.get("value"),
                    "threshold": step.get("threshold"),
                    "status": "abnormal" if step.get("is_abnormal") else "normal",
                    "explanation": f"偏差: {step.get('deviation', 0):.1%}" if step.get("deviation") else "",
                    "sql": step.get("sql", ""),
                })
        conclusion = data.get("conclusion", "")
        if conclusion:
            interpretation_logged = conclusion
            yield _sse("reasoning_conclusion", {
                "paths": [
                    {"steps": p.get("steps", [])} for p in paths[:3]
                ],
                "summary": conclusion,
            })
    else:
        # text_to_sql
        sql = data.get("sql", "")
        if sql:
            sql_logged = sql
            yield _sse("sql", {"sql": sql})

        sql_result = data.get("result") or data.get("sql_result") or {}
        if sql_result:
            rows = sql_result.get("rows", [])
            col_count = len(sql_result.get("columns", []))
            result_summary = f"{len(rows)} rows × {col_count} columns"
            yield _sse("data", {
                "columns": sql_result.get("columns", []),
                "rows": rows[:100],
                "row_count": sql_result.get("row_count", len(rows)),
                "error": sql_result.get("error"),
            })

        interpretation = data.get("interpretation") or data.get("conclusion") or ""
        if interpretation:
            interpretation_logged = interpretation
            # Stream interpretation in chunks for a smoother UX
            chunk_size = 50
            for i in range(0, len(interpretation), chunk_size):
                yield _sse("interpretation", {"chunk": interpretation[i:i + chunk_size]})

    duration_ms = int((time.monotonic() - start_time) * 1000)
    yield _sse("done", {})

    # Persist to query log
    try:
        add_log(
            ws,
            question,
            stage_name,
            status="success",
            duration_ms=duration_ms,
            sql=sql_logged,
            result_summary=result_summary,
            interpretation=interpretation_logged,
        )
    except Exception:
        pass


@router.post("/workspaces/{ws}/chat")
async def workspace_chat(ws: str, body: WorkspaceChatRequest):
    """New pipeline-based SSE chat endpoint."""
    _get_ws_or_404(ws)
    return StreamingResponse(
        _stream_pipeline_chat(ws, body.question, body.session_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
