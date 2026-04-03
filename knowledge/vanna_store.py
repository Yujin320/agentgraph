"""Vanna store — per-workspace SQL RAG using ChromaDB.

Each workspace gets its own isolated ChromaDB collection trained on:
  - DDL statements from schema_dict.yaml
  - Table/field descriptions as documentation
  - Few-shot Q&A pairs from few_shots.json

Usage::
    from knowledge.vanna_store import get_vanna
    vn = get_vanna(workspace)       # returns WorkspaceVanna or None
    sql = vn.generate_sql("这个月整体达成率是多少？") if vn else None
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from knowledge.workspace import Workspace

logger = logging.getLogger(__name__)

# Persist ChromaDB collections here, one sub-directory per workspace name.
CHROMA_DIR = Path(__file__).resolve().parent.parent / "workspaces" / ".chroma"

# Module-level cache: workspace_name → WorkspaceVanna instance
_VANNA_CACHE: dict[str, "WorkspaceVanna"] = {}


# ---------------------------------------------------------------------------
# WorkspaceVanna — the real Vanna class (only defined when deps are present)
# ---------------------------------------------------------------------------

try:
    from vanna.chromadb import ChromaDB_VectorStore  # type: ignore
    from vanna.openai import OpenAI_Chat              # type: ignore

    class WorkspaceVanna(ChromaDB_VectorStore, OpenAI_Chat):
        """Vanna instance bound to a specific workspace's ChromaDB collection."""

        def __init__(self, workspace_name: str, config: dict):
            ChromaDB_VectorStore.__init__(self, config={
                "path": str(CHROMA_DIR / workspace_name),
                "collection_name": f"vanna_{workspace_name}",
            })
            OpenAI_Chat.__init__(self, config=config)

    _VANNA_AVAILABLE = True

except ImportError:
    logger.warning(
        "vanna / chromadb packages not installed — "
        "SQL RAG disabled. Install with: pip install vanna chromadb"
    )
    _VANNA_AVAILABLE = False
    WorkspaceVanna = None  # type: ignore[assignment,misc]


# ---------------------------------------------------------------------------
# Training helpers
# ---------------------------------------------------------------------------

def _train_from_workspace(vn: "WorkspaceVanna", workspace: "Workspace") -> None:
    """Train a fresh WorkspaceVanna instance from workspace knowledge files."""
    schema = workspace.get_schema_dict()
    few_shots = workspace.get_few_shots()

    # --- DDL: one CREATE TABLE per table definition ---
    tables: dict = schema.get("tables", {})
    for tbl_name, tbl_meta in tables.items():
        ddl_lines = [f"CREATE TABLE {tbl_name} ("]
        fields: dict = tbl_meta.get("fields", {})
        col_defs = []
        for col_name, col_meta in fields.items():
            col_type = _sql_type(col_meta.get("type", "string"))
            comment = col_meta.get("alias", col_name)
            col_defs.append(f"    {col_name} {col_type}  -- {comment}")
        ddl_lines.append(",\n".join(col_defs))
        ddl_lines.append(");")
        ddl = "\n".join(ddl_lines)
        vn.train(ddl=ddl)
        logger.debug("Trained DDL for table: %s", tbl_name)

    # --- Documentation: table-level descriptions ---
    for tbl_name, tbl_meta in tables.items():
        desc_parts = [
            f"表名: {tbl_name}",
            f"中文名: {tbl_meta.get('alias', '')}",
            f"说明: {tbl_meta.get('description', '')}",
            f"粒度: {tbl_meta.get('row_granularity', '')}",
        ]
        # Per-field descriptions
        fields = tbl_meta.get("fields", {})
        for col_name, col_meta in fields.items():
            field_desc = (
                f"  - {col_name} ({col_meta.get('alias', '')}): "
                f"{col_meta.get('description', '')}"
            )
            desc_parts.append(field_desc)
        vn.train(documentation="\n".join(desc_parts))

    # --- Business rules as documentation ---
    rules: dict = schema.get("business_rules", {})
    if rules:
        rules_lines = ["业务规则:"]
        for rule_name, rule_body in rules.items():
            rule_text = rule_body.get("rule", "") if isinstance(rule_body, dict) else str(rule_body)
            rule_desc = rule_body.get("description", "") if isinstance(rule_body, dict) else ""
            rules_lines.append(f"  [{rule_name}] {rule_text} — {rule_desc}")
        vn.train(documentation="\n".join(rules_lines))

    # --- Query term mappings as documentation ---
    term_map: dict = schema.get("query_term_mapping", {})
    if term_map:
        term_lines = ["常用中文查询词映射:"]
        for term, mapping in term_map.items():
            term_lines.append(f'  "{term}" → {mapping}')
        vn.train(documentation="\n".join(term_lines))

    # --- Few-shot Q&A pairs ---
    examples: list = few_shots.get("examples", [])
    for ex in examples:
        question: str = ex.get("question", "")
        sql: str = ex.get("sql", "")
        if question and sql:
            vn.add_question_sql(question=question, sql=sql)
            logger.debug("Added few-shot: %s", question[:60])

    logger.info(
        "Vanna training complete for workspace '%s': "
        "%d tables, %d few-shots.",
        workspace.name,
        len(tables),
        len(examples),
    )


def _sql_type(field_type: str) -> str:
    """Map schema field types to SQL column types."""
    mapping = {
        "string": "TEXT",
        "integer": "INTEGER",
        "float": "REAL",
        "date": "DATE",
        "datetime": "DATETIME",
    }
    return mapping.get(field_type.lower(), "TEXT")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_vanna(workspace: "Workspace") -> Optional["WorkspaceVanna"]:
    """Return a trained WorkspaceVanna for *workspace*, cached after first call.

    On the first call for a given workspace name a new ChromaDB collection is
    created and trained from the workspace knowledge files.  Subsequent calls
    return the cached instance immediately.

    Returns None if the vanna/chromadb packages are not installed.
    """
    if not _VANNA_AVAILABLE:
        return None

    name = workspace.name
    if name in _VANNA_CACHE:
        return _VANNA_CACHE[name]

    # Build LLM config from env + optional workspace override
    llm_override = workspace.llm_config
    config: dict = {
        "api_key": llm_override.get("api_key") or os.getenv("LLM_API_KEY", ""),
        "model": llm_override.get("model") or os.getenv("LLM_MODEL", "gpt-4o"),
    }
    base_url = llm_override.get("base_url") or os.getenv("LLM_BASE_URL", "")
    if base_url:
        config["base_url"] = base_url

    # Ensure ChromaDB persistence directory exists
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    chroma_path = CHROMA_DIR / name

    try:
        vn = WorkspaceVanna(workspace_name=name, config=config)

        # Train only on first creation (empty collection)
        if not chroma_path.exists() or not any(chroma_path.iterdir()):
            logger.info(
                "No existing Vanna collection for '%s' — training now.", name
            )
            _train_from_workspace(vn, workspace)
        else:
            logger.info(
                "Loaded existing Vanna collection for workspace '%s'.", name
            )

        _VANNA_CACHE[name] = vn
        return vn

    except Exception as exc:
        logger.warning(
            "Failed to initialise Vanna for workspace '%s': %s", name, exc
        )
        return None
