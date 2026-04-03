"""
System management endpoints.

GET  /system/health                  — Database, Neo4j, and knowledge directory checks
GET  /system/config                  — Current LLM config (API key masked)
PUT  /system/config                  — Update LLM settings in .env
POST /system/test-connection         — Test LLM connectivity with a simple prompt
GET  /system/sample-questions/{ws}   — Sample questions grouped by scenario
GET  /system/few-shots/{ws}          — Raw few_shots content for a workspace
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import settings
from knowledge.workspace import Workspace

router = APIRouter(tags=["system"])

# Project root .env path
_ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"


# ── Request models ────────────────────────────────────────────────────────────

class ConfigUpdate(BaseModel):
    base_url: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_ws(ws: str) -> Workspace:
    try:
        return Workspace.get(ws)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


def _read_env() -> dict[str, str]:
    """Parse .env file into a key→value dict."""
    env: dict[str, str] = {}
    if _ENV_PATH.exists():
        for line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env


def _write_env(env: dict[str, str]) -> None:
    """Write key→value pairs back to .env (preserving existing keys)."""
    _ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    if _ENV_PATH.exists():
        for line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                lines.append(line)
                continue
            k = stripped.split("=", 1)[0].strip()
            if k in env:
                lines.append(f"{k}={env.pop(k)}")
            else:
                lines.append(line)
    # Append any new keys that weren't already in the file
    for k, v in env.items():
        lines.append(f"{k}={v}")
    _ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/system/health")
def health():
    """Check database (first workspace), Neo4j connectivity, and knowledge directory."""
    checks: dict[str, bool | str] = {
        "database": False,
        "neo4j": False,
        "knowledge": False,
    }

    # Database check — use the first available workspace
    try:
        ws_names = Workspace.list_workspaces()
        if ws_names:
            ws = Workspace.get(ws_names[0])
            engine = ws.get_engine()
            with engine.connect() as conn:
                from sqlalchemy import text
                conn.execute(text("SELECT 1"))
            checks["database"] = True
        else:
            checks["database"] = "no_workspace"
    except Exception as exc:
        checks["database"] = str(exc)

    # Neo4j check
    try:
        from neo4j import GraphDatabase
        driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        with driver.session() as session:
            session.run("RETURN 1")
        driver.close()
        checks["neo4j"] = True
    except Exception as exc:
        checks["neo4j"] = str(exc)

    # Knowledge directory check
    from knowledge.workspace import WORKSPACES_DIR
    checks["knowledge"] = WORKSPACES_DIR.is_dir()

    all_ok = all(v is True for v in checks.values())
    return {"status": "ok" if all_ok else "degraded", "checks": checks}


@router.get("/system/config")
def get_config():
    """Return current LLM configuration (API key masked)."""
    api_key = settings.llm_api_key
    masked_key = (api_key[:8] + "...") if len(api_key) > 8 else ("***" if api_key else "")
    return {
        "base_url": settings.llm_base_url,
        "model": settings.llm_model,
        "api_key": masked_key,
    }


@router.put("/system/config")
def update_config(body: ConfigUpdate):
    """Update LLM settings in the .env file. Only non-empty fields are changed."""
    env = _read_env()
    if body.base_url:
        env["LLM_BASE_URL"] = body.base_url
    if body.model:
        env["LLM_MODEL"] = body.model
    if body.api_key:
        env["LLM_API_KEY"] = body.api_key
    _write_env(env)
    return {"status": "updated", "note": "Restart the server for changes to take effect."}


@router.post("/system/test-connection")
def test_connection():
    """Test LLM API connectivity with a minimal prompt."""
    try:
        import httpx
        url = (settings.llm_base_url or "").rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.llm_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": settings.llm_model,
            "messages": [{"role": "user", "content": "你好，请回复OK"}],
            "max_tokens": 50,
            "temperature": 0.1,
        }
        resp = httpx.post(url, json=payload, headers=headers, timeout=20, trust_env=False)
        resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"]
        return {"status": "ok", "response": text[:200]}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


@router.get("/system/sample-questions/{ws}")
def sample_questions(ws: str):
    """
    Return scenario titles and sample questions from the workspace's few_shots.json,
    grouped by scenario.
    """
    workspace = _get_ws(ws)

    # Load scenario ordering from scenarios/*.json
    scenarios_order: list[str] = []
    for sc in workspace.get_scenarios():
        title = sc.get("title") or sc.get("scenario_id", "")
        if title:
            scenarios_order.append(title)

    # Load few_shots
    try:
        few_shots = workspace.get_few_shots()
    except FileNotFoundError:
        return {"scenarios": scenarios_order, "by_scenario": {sc: [] for sc in scenarios_order}}

    if isinstance(few_shots, list):
        examples = few_shots
    elif isinstance(few_shots, dict):
        examples = few_shots.get("examples", few_shots.get("few_shots", []))
    else:
        examples = []

    grouped: dict[str, list] = {sc: [] for sc in scenarios_order}
    for ex in examples:
        sc_key = ex.get("scenario", "")
        if sc_key not in grouped:
            grouped[sc_key] = []
        grouped[sc_key].append({
            "id": ex.get("id"),
            "question": ex.get("question"),
            "category": ex.get("category", ""),
            "step_label": ex.get("step_label", "分析"),
            "step_color": ex.get("step_color", "default"),
            "complexity": ex.get("complexity", 1),
        })

    return {"scenarios": scenarios_order, "by_scenario": grouped}


@router.get("/system/few-shots/{ws}")
def get_few_shots(ws: str):
    """Return raw few_shots content for the workspace."""
    workspace = _get_ws(ws)
    try:
        return workspace.get_few_shots()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
