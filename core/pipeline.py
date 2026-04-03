"""Pipeline orchestrator — manages stage execution, pause/resume, persistence."""
from __future__ import annotations

import logging
from pathlib import Path

from core.stage import StageBase, StageRegistry, StageResult
from core.persistence import (
    load_pipeline_state,
    save_pipeline_state,
    update_stage_status,
    get_next_pending_stage,
    save_stage_result,
    load_stage_result,
    SETUP_STAGES,
)
from knowledge.workspace import Workspace

logger = logging.getLogger(__name__)


class PipelineOrchestrator:
    """Stateless orchestrator — all state lives in workspace files."""

    # ------------------------------------------------------------------
    # Pipeline lifecycle
    # ------------------------------------------------------------------

    @staticmethod
    def create_pipeline(workspace_name: str) -> dict:
        """Initialise a setup pipeline for a workspace. Idempotent."""
        ws = Workspace.get(workspace_name)
        state = load_pipeline_state(ws.workspace_dir)
        # If already exists and not idle, return as-is
        if state["status"] != "idle" and any(
            s["status"] != "pending" for s in state["stages"]
        ):
            return state
        # Reset to fresh
        from core.persistence import _default_pipeline_state
        state = _default_pipeline_state(workspace_name)
        save_pipeline_state(ws.workspace_dir, state)
        return state

    @staticmethod
    def get_state(workspace_name: str) -> dict:
        ws = Workspace.get(workspace_name)
        return load_pipeline_state(ws.workspace_dir)

    @staticmethod
    def get_stage_result(workspace_name: str, stage_name: str) -> dict | None:
        ws = Workspace.get(workspace_name)
        return load_stage_result(ws.workspace_dir, stage_name)

    # ------------------------------------------------------------------
    # Stage execution
    # ------------------------------------------------------------------

    @staticmethod
    def run_stage(
        workspace_name: str,
        stage_name: str,
        input_data: dict | None = None,
        config: dict | None = None,
    ) -> StageResult:
        """Run a single stage. Persists result and updates pipeline state."""
        ws = Workspace.get(workspace_name)
        ws_dir = ws.workspace_dir
        input_data = input_data or {}
        config = config or {}

        # Get stage instance
        stage: StageBase = StageRegistry.get_instance(stage_name)

        # Validate
        errors = stage.validate_input(ws, input_data)
        if errors:
            result = StageResult(status="failed", errors=errors, message="Validation failed")
            update_stage_status(ws_dir, stage_name, "failed", error="; ".join(errors))
            save_stage_result(ws_dir, stage_name, result.to_dict())
            return result

        # Mark running
        update_stage_status(ws_dir, stage_name, "running")

        try:
            result = stage.run(ws, input_data, config)
        except Exception as exc:
            logger.exception("Stage '%s' failed for workspace '%s'", stage_name, workspace_name)
            result = StageResult(
                status="failed",
                errors=[str(exc)],
                message=f"Stage {stage_name} raised an exception",
            )

        # Persist result
        save_stage_result(ws_dir, stage_name, result.to_dict())

        # Update pipeline state
        if result.status == "failed":
            update_stage_status(ws_dir, stage_name, "failed", error="; ".join(result.errors))
        elif result.status == "needs_review":
            update_stage_status(ws_dir, stage_name, "needs_review")
        else:
            update_stage_status(ws_dir, stage_name, "completed")

        return result

    @staticmethod
    def run_next(workspace_name: str) -> StageResult | None:
        """Run the next pending stage. Returns None if nothing to run."""
        ws = Workspace.get(workspace_name)
        next_stage = get_next_pending_stage(ws.workspace_dir)
        if not next_stage:
            return None

        # Load previous stage's output as input
        idx = SETUP_STAGES.index(next_stage)
        prev_data = {}
        if idx > 0:
            prev_name = SETUP_STAGES[idx - 1]
            prev_result = load_stage_result(ws.workspace_dir, prev_name)
            if prev_result:
                prev_data = prev_result.get("data", {})

        return PipelineOrchestrator.run_stage(workspace_name, next_stage, input_data=prev_data)

    # ------------------------------------------------------------------
    # Human review
    # ------------------------------------------------------------------

    @staticmethod
    def submit_review(workspace_name: str, stage_name: str, edited_data: dict) -> dict:
        """Accept human-edited stage output, persist it, and advance pipeline."""
        ws = Workspace.get(workspace_name)
        ws_dir = ws.workspace_dir

        # Overwrite the stage result with edited data
        existing = load_stage_result(ws_dir, stage_name) or {}
        existing["data"] = edited_data
        existing["status"] = "success"
        existing["message"] = "Reviewed and approved by user"
        save_stage_result(ws_dir, stage_name, existing)

        # Mark stage completed
        update_stage_status(ws_dir, stage_name, "completed")
        return load_pipeline_state(ws_dir)

    # ------------------------------------------------------------------
    # Skip
    # ------------------------------------------------------------------

    @staticmethod
    def skip_stage(workspace_name: str, stage_name: str) -> dict:
        ws = Workspace.get(workspace_name)
        update_stage_status(ws.workspace_dir, stage_name, "skipped")
        return load_pipeline_state(ws.workspace_dir)

    # ------------------------------------------------------------------
    # Stage info
    # ------------------------------------------------------------------

    @staticmethod
    def list_stages() -> list[dict]:
        """Return metadata for all registered stages."""
        return [s().meta() for s in StageRegistry.list_all()]
