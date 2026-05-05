"""AgentState — shared state schema for the AgentGraph reasoning engine.

Corresponds to Section 4.3.4 of the AgentGraph paper:
  "All three agents operate on a shared AgentState object that constitutes
   the Analysis Context."

Key additions vs. the original DataAgent state:
  - analysis_chain: explicit DAG representation of the Analysis Chain
  - branch_stack: checkpoints for backtrack decisions
  - evaluator_decision: current Evaluator verdict
  - needs_replan / replan_hint: signals Planner re-invocation on branch
"""
from __future__ import annotations

from enum import Enum
from typing import Literal, Optional, TypedDict

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Step type taxonomy (§4.2.1)
# ---------------------------------------------------------------------------

class StepType(str, Enum):
    CYPHER_QUERY    = "CypherQuery"
    GRAPH_ALGORITHM = "GraphAlgorithm"
    METRIC_CHECK    = "MetricCheck"
    PATTERN_MATCH   = "PatternMatch"
    AGGREGATE       = "Aggregate"


class StepStatus(str, Enum):
    PENDING      = "pending"
    RUNNING      = "running"
    DONE         = "done"
    FAILED       = "failed"
    NEEDS_HUMAN  = "needs_human"


# ---------------------------------------------------------------------------
# Analysis Step (atomic node in the Analysis Chain DAG)
# ---------------------------------------------------------------------------

class RepairRecord(BaseModel):
    """One self-healing repair attempt (Algorithm 1, §4.3.2)."""
    attempt: int = 0
    failed_sql: str = ""
    error: str = ""
    repaired_sql: str = ""
    timestamp: str = ""


class AnalysisStep(BaseModel):
    """A single typed step in the Analysis Chain DAG."""
    step_id: str = ""
    step_type: StepType = StepType.CYPHER_QUERY
    description: str = ""

    # Execution fields (filled by Executor)
    query: Optional[str] = None
    result: Optional[dict] = None
    status: StepStatus = StepStatus.PENDING
    repair_log: list[RepairRecord] = Field(default_factory=list)

    # Evaluation fields (filled by Evaluator)
    evaluator_decision: Optional[str] = None
    evaluator_reasoning: Optional[str] = None
    assessment: Optional[dict] = None  # {non_emptiness, goal_proximity, sufficiency, anomaly}


# ---------------------------------------------------------------------------
# Legacy ReasoningStep (kept for backward compat with existing routers)
# ---------------------------------------------------------------------------

class ReasoningStep(BaseModel):
    step_type: Literal["plan", "sql_gen", "execute", "reflect", "conclude",
                       "planner", "executor", "evaluator"] = "plan"
    content: str = ""
    sql: Optional[str] = None
    result: Optional[dict] = None
    error: Optional[str] = None
    timestamp: str = ""


# ---------------------------------------------------------------------------
# AgentState — the shared Analysis Context
# ---------------------------------------------------------------------------

class AgentState(TypedDict, total=False):
    """LangGraph state for the AgentGraph reasoning engine.

    Shared by Planner, Executor, and Evaluator agents. Designed to be
    serialisable to JSON for checkpoint persistence and HITL resume.
    """
    # ── Identity ──
    workspace: str
    question: str
    thread_id: str

    # ── Planner outputs ──
    strategy: str          # "causal_attribution" | "comparative" | "trend" | ...
    intent: str            # free-form intent description
    analysis_chain: list   # list[AnalysisStep.model_dump()]  — the DAG
    current_step_index: int

    # ── Branch / backtrack support (§4.3.3) ──
    branch_stack: list     # list of {step_index, chain_snapshot, branch_hint}
    needs_replan: bool     # signals Planner to extend DAG
    replan_hint: Optional[str]

    # ── Evaluator outputs ──
    evaluator_decision: str  # "continue|branch|backtrack|human_intervene|terminate"

    # ── Human-in-the-loop (§4.4) ──
    pending_approval: bool
    user_edited_sql: Optional[str]

    # ── Reasoning trace (audit log) ──
    reasoning_steps: list  # list of {role, content, ...}

    # ── Executor cycle counters ──
    retry_count: int
    max_retries: int

    # ── Final output ──
    conclusion: Optional[str]
    chart_spec: Optional[dict]
    attribution_paths: list
