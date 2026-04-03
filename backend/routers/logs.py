"""
Query log endpoints — per-workspace query history with ratings and feedback.

GET  /logs/{ws}              — List logs with pagination and optional rating filter
GET  /logs/{ws}/stats        — Aggregated statistics for the workspace
GET  /logs/{ws}/{log_id}     — Get a single log entry
POST /logs/{ws}/{log_id}/feedback — Submit rating + feedback text
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.query_log import add_feedback, get_log, get_stats, list_logs
from knowledge.workspace import Workspace

router = APIRouter(tags=["logs"])


def _require_ws(ws: str) -> None:
    """Raise 404 if the workspace does not exist."""
    try:
        Workspace.get(ws)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


class FeedbackRequest(BaseModel):
    rating: Optional[int] = None
    feedback: Optional[str] = None


@router.get("/logs/{ws}")
def list_query_logs(
    ws: str,
    limit: int = 50,
    offset: int = 0,
    min_rating: Optional[float] = None,
    max_rating: Optional[float] = None,
):
    """List query logs for a workspace with pagination and optional rating filter."""
    _require_ws(ws)
    logs, total = list_logs(ws, limit=limit, offset=offset, min_rating=min_rating, max_rating=max_rating)
    return {"total": total, "offset": offset, "limit": limit, "items": logs}


@router.get("/logs/{ws}/stats")
def query_log_stats(ws: str):
    """Return aggregated query statistics for the workspace."""
    _require_ws(ws)
    return get_stats(ws)


@router.get("/logs/{ws}/{log_id}")
def get_query_log(ws: str, log_id: str):
    """Return a single query log entry."""
    _require_ws(ws)
    entry = get_log(ws, log_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Log '{log_id}' not found in workspace '{ws}'")
    return entry


@router.post("/logs/{ws}/{log_id}/feedback")
def submit_feedback(ws: str, log_id: str, body: FeedbackRequest):
    """Submit a rating (1-5) and/or feedback text for a query log entry."""
    _require_ws(ws)
    entry = get_log(ws, log_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Log '{log_id}' not found in workspace '{ws}'")
    if body.rating is not None and not (1 <= body.rating <= 5):
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    add_feedback(ws, log_id, rating=body.rating, feedback=body.feedback)
    return {"status": "ok", "log_id": log_id}
