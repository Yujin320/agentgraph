"""AgentState — shared state schema for the agentic reasoning graph."""
from __future__ import annotations

from typing import Literal, TypedDict

from pydantic import BaseModel, Field


class ReasoningStep(BaseModel):
    """A single step in the multi-step reasoning process."""
    step_type: Literal["plan", "sql_gen", "execute", "reflect", "conclude"] = "plan"
    content: str = ""
    sql: str | None = None
    result: dict | None = None  # {columns, rows}
    error: str | None = None
    timestamp: str = ""


class AgentState(TypedDict, total=False):
    """LangGraph state for the agentic reasoning engine."""
    # Identity
    workspace: str
    question: str
    thread_id: str

    # Strategy / intent
    strategy: str  # "causal" | "statistical" | "comparative" | "trend" | "auto"
    intent: str  # free-form intent description

    # Planning
    plan: list[str]
    current_step_index: int

    # Reasoning trace
    reasoning_steps: list[dict]  # serialized ReasoningStep list

    # SQL cycle
    current_sql: str | None
    sql_result: dict | None  # {columns, rows, row_count, error}
    sql_error: str | None
    retry_count: int
    max_retries: int

    # Human-in-the-loop
    pending_approval: bool
    user_edited_sql: str | None

    # Output
    conclusion: str | None
    attribution_paths: list[dict]
    chart_spec: dict | None

    # Drill control
    drill_depth: int
    max_drill_depth: int

    # LLM conversation memory
    messages: list
