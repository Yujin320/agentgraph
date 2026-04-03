"""SQL RAG store — per-workspace few-shot retrieval using ChromaDB.

Replaces the old Vanna-based approach with a lightweight ChromaDB store
that embeds question→SQL pairs and retrieves the most relevant examples
for a given user question.

Usage::
    from knowledge.vanna_store import get_sql_rag, generate_sql_with_rag
    rag = get_sql_rag(workspace)
    examples = rag.retrieve("本月整体达成率") if rag else []
"""
from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from knowledge.workspace import Workspace

logger = logging.getLogger(__name__)

CHROMA_DIR = Path(__file__).resolve().parent.parent / "workspaces" / ".chroma"

_CACHE: dict[str, "SqlRagStore"] = {}

try:
    import chromadb

    class SqlRagStore:
        """Lightweight ChromaDB store for SQL few-shot retrieval."""

        def __init__(self, workspace_name: str):
            CHROMA_DIR.mkdir(parents=True, exist_ok=True)
            self._client = chromadb.PersistentClient(path=str(CHROMA_DIR / workspace_name))
            self._collection = self._client.get_or_create_collection(
                name=f"sql_rag_{workspace_name}",
                metadata={"hnsw:space": "cosine"},
            )

        @property
        def count(self) -> int:
            return self._collection.count()

        def add_example(self, question: str, sql: str, metadata: dict | None = None):
            doc_id = hashlib.md5(question.encode()).hexdigest()[:12]
            meta = {"sql": sql}
            if metadata:
                meta.update({k: str(v) for k, v in metadata.items()})
            self._collection.upsert(
                ids=[doc_id],
                documents=[question],
                metadatas=[meta],
            )

        def add_documentation(self, text: str, doc_id: str | None = None):
            if not doc_id:
                doc_id = "doc_" + hashlib.md5(text.encode()).hexdigest()[:12]
            self._collection.upsert(
                ids=[doc_id],
                documents=[text],
                metadatas=[{"type": "documentation"}],
            )

        def retrieve(self, question: str, n_results: int = 5) -> list[dict]:
            """Return top-N most relevant examples for a question."""
            if self._collection.count() == 0:
                return []
            results = self._collection.query(
                query_texts=[question],
                n_results=min(n_results, self._collection.count()),
            )
            out = []
            for i, doc in enumerate(results["documents"][0]):
                meta = results["metadatas"][0][i] if results["metadatas"] else {}
                out.append({"question": doc, "sql": meta.get("sql", ""), **meta})
            return out

    _AVAILABLE = True

except ImportError:
    logger.warning("chromadb not installed — SQL RAG disabled.")
    _AVAILABLE = False
    SqlRagStore = None  # type: ignore


def _train_store(store: SqlRagStore, workspace: Workspace) -> None:
    """Populate store from workspace knowledge files."""
    schema = workspace.get_schema_dict()
    few_shots = workspace.get_few_shots()

    # Add DDL documentation
    from knowledge.schema_builder import build_ddl, build_rules_context
    store.add_documentation(build_ddl(workspace), doc_id="ddl")
    rules = build_rules_context(workspace)
    if rules:
        store.add_documentation(rules, doc_id="rules")

    # Add few-shot Q&A pairs
    count = 0
    for ex in few_shots.get("examples", []):
        q, sql = ex.get("question", ""), ex.get("sql", "")
        if q and sql:
            store.add_example(q, sql, {"scenario": ex.get("scenario", "")})
            count += 1

    logger.info("SQL RAG trained for workspace: %d examples indexed.", count)


def get_sql_rag(workspace: Workspace) -> Optional[SqlRagStore]:
    """Return a trained SqlRagStore, cached per workspace name."""
    if not _AVAILABLE:
        return None

    name = workspace.name
    if name in _CACHE:
        return _CACHE[name]

    try:
        store = SqlRagStore(name)
        if store.count == 0:
            logger.info("Training SQL RAG for workspace '%s'...", name)
            _train_store(store, workspace)
        _CACHE[name] = store
        return store
    except Exception as exc:
        logger.warning("Failed to init SQL RAG for '%s': %s", name, exc)
        return None


# Backward-compatible alias used by sql_node.py
def get_vanna(workspace: Workspace):
    return get_sql_rag(workspace)
