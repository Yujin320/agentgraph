"""Document retriever — indexes docs/ directory using LlamaIndex + ChromaDB.

Provides unstructured-document RAG for a workspace's optional docs/ folder.
Supported file types include PDF, DOCX, TXT, and any other format that
LlamaIndex's SimpleDirectoryReader can handle.

Usage::
    from knowledge.doc_retriever import get_doc_retriever
    retriever = get_doc_retriever(workspace)   # None if no docs/
    if retriever:
        nodes = retriever.retrieve("外调品物流成本分析方法")
        for node in nodes:
            print(node.text)

Index persistence:
    Indexes are persisted to workspaces/.index/<workspace_name>/ so they are
    not rebuilt on every restart.  Delete that directory to force a rebuild.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from knowledge.workspace import Workspace

logger = logging.getLogger(__name__)

# Root directory for persisted LlamaIndex vector stores
INDEX_DIR = Path(__file__).resolve().parent.parent / "workspaces" / ".index"


def get_doc_retriever(workspace: "Workspace"):
    """Return a LlamaIndex retriever for workspace docs/, or None if unavailable.

    Returns:
        A LlamaIndex BaseRetriever (similarity_top_k=3) if docs exist and
        LlamaIndex is installed, otherwise None.
    """
    docs_dir = workspace.get_docs_dir()
    if docs_dir is None:
        logger.debug(
            "Workspace '%s' has no docs/ directory — doc retriever disabled.",
            workspace.name,
        )
        return None

    # Check that there is at least one file in docs/
    doc_files = list(docs_dir.iterdir())
    if not doc_files:
        logger.debug("Workspace '%s' docs/ is empty — skipping index build.", workspace.name)
        return None

    try:
        from llama_index.core import (  # type: ignore
            SimpleDirectoryReader,
            VectorStoreIndex,
            StorageContext,
            load_index_from_storage,
            Settings,
        )
    except ImportError:
        logger.warning(
            "llama_index not installed — doc retriever disabled. "
            "Install with: pip install llama-index"
        )
        return None

    persist_dir = INDEX_DIR / workspace.name
    persist_dir.mkdir(parents=True, exist_ok=True)

    # Load existing persisted index if available
    if (persist_dir / "docstore.json").exists():
        try:
            storage_ctx = StorageContext.from_defaults(persist_dir=str(persist_dir))
            index = load_index_from_storage(storage_ctx)
            logger.info(
                "Loaded existing doc index for workspace '%s' from %s.",
                workspace.name,
                persist_dir,
            )
            return index.as_retriever(similarity_top_k=3)
        except Exception as exc:
            logger.warning(
                "Failed to load persisted index for '%s' (%s) — rebuilding.",
                workspace.name,
                exc,
            )

    # Build index from scratch
    try:
        reader = SimpleDirectoryReader(
            input_dir=str(docs_dir),
            recursive=True,  # descend into sub-directories
            filename_as_id=True,
        )
        documents = reader.load_data()
        logger.info(
            "Loaded %d document(s) from %s for workspace '%s'.",
            len(documents),
            docs_dir,
            workspace.name,
        )

        index = VectorStoreIndex.from_documents(documents, show_progress=False)
        index.storage_context.persist(persist_dir=str(persist_dir))
        logger.info(
            "Doc index built and persisted to %s.", persist_dir
        )
        return index.as_retriever(similarity_top_k=3)

    except Exception as exc:
        logger.warning(
            "Failed to build doc index for workspace '%s': %s",
            workspace.name,
            exc,
        )
        return None
