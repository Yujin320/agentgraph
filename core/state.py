"""Shared LangGraph state schema — imported by all nodes."""
from typing import TypedDict, Optional, Any


class ReasoningStep(TypedDict):
    node_id: str          # causal graph node id
    node_label: str       # human-readable label
    sql: str
    result: dict          # {columns, rows, row_count}
    metric_value: Any     # extracted scalar value
    threshold: Any        # configured threshold
    status: str           # "abnormal" | "normal" | "error"
    explanation: str      # one-line AI explanation


class AgentState(TypedDict):
    # Identity
    session_id: str
    workspace: str        # workspace name (subdirectory under workspaces/)

    # Input
    question: str

    # Intent parsing output
    intent: dict          # {scenario, kpi_node, filters, time_range}

    # Reasoning loop
    causal_path: list     # ordered list of node_ids explored so far
    steps: list           # list[ReasoningStep]
    current_node: str     # node currently being evaluated
    max_steps: int        # termination guard (default 8)

    # SQL gen
    sql: str
    sql_result: dict

    # Reflection
    reflection: dict      # {status, metric_value, threshold, is_root_cause}

    # Final output
    conclusion: str
    chart_hint: str       # "bar" | "line" | "table" | ...
    done: bool
    error: Optional[str]
