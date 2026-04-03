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
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Ensure all stages are registered
import core.stages  # noqa: F401

from core.pipeline import PipelineOrchestrator
from core.stage import StageRegistry
from knowledge.workspace import Workspace

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
