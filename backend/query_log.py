"""Simple JSON-based query log storage per workspace."""
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent / "workspaces"


def _log_path(ws: str) -> Path:
    return LOG_DIR / ws / "query_logs.json"


def _load(ws: str) -> list:
    p = _log_path(ws)
    if p.exists():
        return json.loads(p.read_text())
    return []


def _save(ws: str, logs: list):
    p = _log_path(ws)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(logs, ensure_ascii=False, indent=2))


def add_log(ws: str, question: str, mode: str, **kwargs) -> str:
    """Add a new query log entry, return log_id."""
    logs = _load(ws)
    log_id = str(uuid.uuid4())[:8]
    entry = {
        "id": log_id,
        "question": question,
        "mode": mode,
        "status": kwargs.get("status", "success"),
        "duration_ms": kwargs.get("duration_ms", 0),
        "sql": kwargs.get("sql", ""),
        "result_summary": kwargs.get("result_summary", ""),
        "interpretation": kwargs.get("interpretation", ""),
        "error": kwargs.get("error"),
        "rating": None,
        "feedback": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    logs.append(entry)
    _save(ws, logs)
    return log_id


def list_logs(
    ws: str,
    limit: int = 50,
    offset: int = 0,
    min_rating: float | None = None,
    max_rating: float | None = None,
) -> tuple[list, int]:
    logs = _load(ws)
    # Filter by rating
    if min_rating is not None:
        logs = [l for l in logs if l.get("rating") is not None and l["rating"] >= min_rating]
    if max_rating is not None:
        logs = [l for l in logs if l.get("rating") is not None and l["rating"] <= max_rating]
    total = len(logs)
    # Sort by created_at desc
    logs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return logs[offset : offset + limit], total


def get_log(ws: str, log_id: str) -> dict | None:
    logs = _load(ws)
    return next((l for l in logs if l["id"] == log_id), None)


def add_feedback(ws: str, log_id: str, rating: int = None, feedback: str = None):
    logs = _load(ws)
    for l in logs:
        if l["id"] == log_id:
            if rating is not None:
                l["rating"] = rating
            if feedback is not None:
                l["feedback"] = feedback
            break
    _save(ws, logs)


def get_stats(ws: str) -> dict:
    logs = _load(ws)
    total = len(logs)
    rated = [l for l in logs if l.get("rating") is not None]
    return {
        "total": total,
        "success": sum(1 for l in logs if l.get("status") == "success"),
        "error": sum(1 for l in logs if l.get("status") == "error"),
        "rated": len(rated),
        "avg_rating": round(sum(l["rating"] for l in rated) / len(rated), 1) if rated else 0,
        "avg_duration_ms": round(sum(l.get("duration_ms", 0) for l in logs) / total) if total else 0,
    }
