"""Workspace abstraction — each domain is a self-contained workspace directory."""
from __future__ import annotations
import json, yaml, os
from pathlib import Path
from typing import Optional
from sqlalchemy import create_engine, Engine


WORKSPACES_DIR = Path(__file__).resolve().parent.parent / "workspaces"


class Workspace:
    """
    A workspace is a directory under workspaces/<name>/ containing:
      - workspace.yaml      — metadata + DB connection string
      - causal_graph.json   — attribution causal graph
      - schema_dict.yaml    — field semantics + business rules
      - few_shots.json      — example Q&A pairs
      - scenarios/          — scenario definitions (*.json)
      - docs/               — optional documents for RAG (PDF, DOCX, TXT)
    """

    def __init__(self, name: str):
        self.name = name
        self.path = WORKSPACES_DIR / name
        if not self.path.is_dir():
            raise FileNotFoundError(f"Workspace '{name}' not found at {self.path}")
        self._config: dict = self._load_yaml("workspace.yaml")
        self._causal_graph: Optional[dict] = None
        self._schema_dict: Optional[dict] = None
        self._few_shots: Optional[dict] = None
        self._engine: Optional[Engine] = None

    # ── Config ──────────────────────────────────────────────────────────────

    @property
    def title(self) -> str:
        return self._config.get("title", self.name)

    @property
    def description(self) -> str:
        return self._config.get("description", "")

    @property
    def llm_config(self) -> dict:
        """Override global LLM config per workspace (optional)."""
        return self._config.get("llm", {})

    @property
    def current_period(self) -> str:
        """Current reporting period, e.g. '202603'. Used in SQL generation."""
        return str(self._config.get("current_period", ""))

    # ── Knowledge files ──────────────────────────────────────────────────────

    def get_causal_graph(self) -> dict:
        if self._causal_graph is None:
            self._causal_graph = self._load_json("causal_graph.json")
        return self._causal_graph

    def get_engine_graph(self) -> dict:
        """Engine-compatible attribution graph (engine_graph.json if present, else causal_graph.json)."""
        p = self.path / "engine_graph.json"
        if p.exists():
            with open(p, encoding="utf-8") as f:
                import json
                return json.load(f)
        return self.get_causal_graph()

    def get_schema_dict(self) -> dict:
        if self._schema_dict is None:
            self._schema_dict = self._load_yaml("schema_dict.yaml")
        return self._schema_dict

    def get_few_shots(self) -> dict:
        if self._few_shots is None:
            self._few_shots = self._load_json("few_shots.json")
        return self._few_shots

    def get_scenarios(self) -> list[dict]:
        scenario_dir = self.path / "scenarios"
        if not scenario_dir.is_dir():
            return []
        import glob
        result = []
        for fp in sorted(glob.glob(str(scenario_dir / "*.json"))):
            with open(fp, encoding="utf-8") as f:
                result.append(json.load(f))
        return result

    def get_docs_dir(self) -> Optional[Path]:
        d = self.path / "docs"
        return d if d.is_dir() else None

    # ── Database ─────────────────────────────────────────────────────────────

    def get_engine(self) -> Engine:
        if self._engine is None:
            dsn = self._config.get("database", {}).get("url", "")
            if not dsn:
                raise ValueError(f"Workspace '{self.name}' has no database.url in workspace.yaml")
            # Resolve relative sqlite paths relative to workspace dir
            if dsn.startswith("sqlite:///") and not dsn.startswith("sqlite:////"):
                rel = dsn[len("sqlite:///"):]
                abs_path = self.path / rel
                dsn = f"sqlite:///{abs_path}"
            self._engine = create_engine(dsn, connect_args={"check_same_thread": False})
        return self._engine

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _load_json(self, filename: str) -> dict:
        p = self.path / filename
        if not p.exists():
            raise FileNotFoundError(f"{filename} not found in workspace '{self.name}'")
        with open(p, encoding="utf-8") as f:
            return json.load(f)

    def _load_yaml(self, filename: str) -> dict:
        p = self.path / filename
        if not p.exists():
            return {}
        with open(p, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    # ── Registry ─────────────────────────────────────────────────────────────

    @classmethod
    def list_workspaces(cls) -> list[str]:
        if not WORKSPACES_DIR.is_dir():
            return []
        return [
            d.name for d in sorted(WORKSPACES_DIR.iterdir())
            if d.is_dir() and (d / "workspace.yaml").exists()
        ]

    @classmethod
    def get(cls, name: str) -> "Workspace":
        return cls(name)
