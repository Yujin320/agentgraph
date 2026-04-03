"""Intent node — parses the user question into a structured intent dict."""
from __future__ import annotations
import json, os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from knowledge.workspace import Workspace

load_dotenv()

_SYSTEM = (
    "You are a business intelligence assistant. "
    "Parse the user question into a JSON intent object. "
    "Return ONLY valid JSON, no markdown fences."
)

_TEMPLATE = """\
Available scenarios:
{scenarios}

Causal graph entry nodes (scenario_id -> entry_node_id):
{entry_nodes}

Current reporting period: {current_period}

User question: {question}

Return a JSON object with exactly these keys:
  scenario_id   - the best matching scenario id (string)
  kpi_node_id   - the entry node id for that scenario (string)
  filters       - dict of field->value filters extracted from the question (may be empty)
  time_range    - explicit time range mentioned by the user, or the current period if none
"""


def _get_llm(workspace: Workspace) -> ChatOpenAI:
    wc = workspace.llm_config
    return ChatOpenAI(
        base_url=wc.get("base_url") or os.getenv("LLM_BASE_URL") or None,
        api_key=wc.get("api_key") or os.getenv("LLM_API_KEY") or "sk-placeholder",
        model=wc.get("model") or os.getenv("LLM_MODEL") or "gpt-4o",
        temperature=0,
    )


def intent_node(state: dict) -> dict:
    ws: Workspace = Workspace.get(state["workspace"])
    scenarios = ws.get_engine_graph().get("scenarios", [])
    causal = ws.get_causal_graph()

    # Build a compact scenario summary for the prompt
    scenario_lines = []
    entry_lines = []
    for sc in scenarios:
        scenario_lines.append(f"  - {sc.get('id')}: {sc.get('title')} — {sc.get('description', '')}")
        entry_lines.append(f"  {sc.get('id')} -> {sc.get('entry_node')}")

    # causal_graph.json scenarios may be a dict (name→config) — skip if so
    raw_sc = causal.get("scenarios", [])
    if isinstance(raw_sc, list):
        for sc in raw_sc:
            if isinstance(sc, dict) and sc.get("id") not in {s.get("id") for s in scenarios}:
                entry_lines.append(f"  {sc.get('id')} -> {sc.get('entry_node')}")

    prompt = _TEMPLATE.format(
        scenarios="\n".join(scenario_lines) or "(none defined)",
        entry_nodes="\n".join(entry_lines) or "(see causal graph)",
        current_period=ws.current_period,
        question=state.get("question", ""),
    )

    llm = _get_llm(ws)
    from langchain_core.messages import SystemMessage, HumanMessage
    response = llm.invoke([SystemMessage(content=_SYSTEM), HumanMessage(content=prompt)])
    raw = response.content.strip()

    try:
        intent = json.loads(raw)
    except json.JSONDecodeError:
        # Best-effort: find the first {...} block
        start, end = raw.find("{"), raw.rfind("}")
        intent = json.loads(raw[start : end + 1]) if start != -1 else {}

    # Ensure current_node is initialised to the kpi entry node
    updates: dict = {"intent": intent}
    if not state.get("current_node") and intent.get("kpi_node_id"):
        updates["current_node"] = intent["kpi_node_id"]
        updates["causal_path"] = [intent["kpi_node_id"]]

    return updates
