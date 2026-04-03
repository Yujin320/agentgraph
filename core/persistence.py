"""Pipeline state and stage result persistence — JSON files per workspace."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pipeline state model
# ---------------------------------------------------------------------------

SETUP_STAGES = ["connect", "introspect", "enrich", "build_kg", "train_sql"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_stage_status(name: str) -> dict:
    return {
        "name": name,
        "status": "pending",
        "started_at": None,
        "completed_at": None,
        "error": None,
    }


def _default_pipeline_state(workspace_name: str) -> dict:
    return {
        "workspace": workspace_name,
        "pipeline_type": "setup",
        "status": "idle",
        "stages": [_default_stage_status(n) for n in SETUP_STAGES],
        "created_at": _now(),
        "updated_at": _now(),
    }


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

def _ws_dir(workspace_dir: Path) -> Path:
    return workspace_dir


def _stages_dir(workspace_dir: Path) -> Path:
    d = workspace_dir / "stages"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _pipeline_state_path(workspace_dir: Path) -> Path:
    return workspace_dir / "pipeline_state.json"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_pipeline_state(workspace_dir: Path) -> dict:
    """Load or initialise pipeline_state.json."""
    path = _pipeline_state_path(workspace_dir)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    state = _default_pipeline_state(workspace_dir.name)
    save_pipeline_state(workspace_dir, state)
    return state


def save_pipeline_state(workspace_dir: Path, state: dict) -> None:
    state["updated_at"] = _now()
    path = _pipeline_state_path(workspace_dir)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def update_stage_status(
    workspace_dir: Path,
    stage_name: str,
    status: Literal["pending", "running", "completed", "needs_review", "failed", "skipped"],
    error: str | None = None,
) -> dict:
    """Update a single stage's status and return the full pipeline state."""
    state = load_pipeline_state(workspace_dir)
    for s in state["stages"]:
        if s["name"] == stage_name:
            s["status"] = status
            if status == "running":
                s["started_at"] = _now()
            elif status in ("completed", "needs_review", "failed", "skipped"):
                s["completed_at"] = _now()
            if error:
                s["error"] = error
            break

    # Derive overall pipeline status
    statuses = [s["status"] for s in state["stages"]]
    if "running" in statuses:
        state["status"] = "running"
    elif "needs_review" in statuses:
        state["status"] = "paused"
    elif all(s in ("completed", "skipped") for s in statuses):
        state["status"] = "completed"
    elif "failed" in statuses:
        state["status"] = "failed"
    else:
        state["status"] = "idle"

    save_pipeline_state(workspace_dir, state)
    return state


def get_next_pending_stage(workspace_dir: Path) -> str | None:
    """Return the name of the first pending stage, or None."""
    state = load_pipeline_state(workspace_dir)
    for s in state["stages"]:
        if s["status"] == "pending":
            return s["name"]
    return None


# ---------------------------------------------------------------------------
# Stage result persistence
# ---------------------------------------------------------------------------

def save_stage_result(workspace_dir: Path, stage_name: str, result: dict) -> Path:
    """Persist a StageResult.to_dict() as stages/<name>.json."""
    path = _stages_dir(workspace_dir) / f"{stage_name}.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_stage_result(workspace_dir: Path, stage_name: str) -> dict | None:
    """Load a persisted stage result, or None if not found."""
    path = _stages_dir(workspace_dir) / f"{stage_name}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
