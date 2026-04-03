"""Stage base class, result type, and registry for the pluggable pipeline."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal

from knowledge.workspace import Workspace


# ---------------------------------------------------------------------------
# Stage result
# ---------------------------------------------------------------------------

@dataclass
class StageResult:
    """Structured output from a stage execution."""
    status: Literal["success", "failed", "needs_review"]
    data: dict[str, Any] = field(default_factory=dict)
    artifacts: list[str] = field(default_factory=list)
    message: str = ""
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "data": self.data,
            "artifacts": self.artifacts,
            "message": self.message,
            "errors": self.errors,
        }


# ---------------------------------------------------------------------------
# Stage base
# ---------------------------------------------------------------------------

class StageBase(ABC):
    """Abstract base for all pipeline stages.

    Subclasses must set class-level attributes and implement ``run``.
    Register with ``@StageRegistry.register``.
    """

    name: str = ""                          # e.g. "connect"
    display_name: str = ""                  # e.g. "数据源连接"
    description: str = ""
    pipeline_type: Literal["setup", "runtime"] = "setup"
    order: int = 0                          # execution order within pipeline

    @abstractmethod
    def run(self, workspace: Workspace, input_data: dict, config: dict) -> StageResult:
        """Execute the stage. Must be idempotent (safe to re-run)."""
        ...

    def validate_input(self, workspace: Workspace, input_data: dict) -> list[str]:
        """Return a list of validation error strings, empty if OK."""
        return []

    def get_default_config(self) -> dict:
        """Return default configuration for this stage."""
        return {}

    def meta(self) -> dict:
        """Serialisable metadata for API responses."""
        return {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "pipeline_type": self.pipeline_type,
            "order": self.order,
            "default_config": self.get_default_config(),
        }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class StageRegistry:
    """Global registry of pipeline stages. Stages register via decorator."""

    _stages: dict[str, type[StageBase]] = {}

    @classmethod
    def register(cls, stage_cls: type[StageBase]) -> type[StageBase]:
        """Class decorator — registers a stage by its ``name``."""
        if not stage_cls.name:
            raise ValueError(f"{stage_cls.__name__} must set 'name'")
        cls._stages[stage_cls.name] = stage_cls
        return stage_cls

    @classmethod
    def get(cls, name: str) -> type[StageBase]:
        if name not in cls._stages:
            raise KeyError(f"Stage '{name}' not registered. Available: {list(cls._stages)}")
        return cls._stages[name]

    @classmethod
    def get_instance(cls, name: str) -> StageBase:
        return cls.get(name)()

    @classmethod
    def list_all(cls) -> list[type[StageBase]]:
        return sorted(cls._stages.values(), key=lambda s: s.order)

    @classmethod
    def list_setup(cls) -> list[type[StageBase]]:
        return [s for s in cls.list_all() if s.pipeline_type == "setup"]

    @classmethod
    def list_runtime(cls) -> list[type[StageBase]]:
        return [s for s in cls.list_all() if s.pipeline_type == "runtime"]
