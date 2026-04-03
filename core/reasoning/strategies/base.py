"""Base strategy class and registry for composable analysis strategies."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph as CompiledGraph

from core.reasoning.state import AgentState


class StrategyBase(ABC):
    """Abstract base for analysis strategies.

    Each strategy provides:
    - Keyword triggers for auto-detection
    - A scoring function for routing
    - A sub-graph that can be composed into the main agent graph
    """

    name: ClassVar[str] = ""
    display_name: ClassVar[str] = ""
    description: ClassVar[str] = ""
    trigger_keywords: ClassVar[list[str]] = []

    @abstractmethod
    def build_subgraph(self) -> CompiledGraph:
        """Build and return a compiled LangGraph sub-graph for this strategy."""
        ...

    @abstractmethod
    def can_handle(self, intent: str, question: str) -> float:
        """Return a confidence score (0.0 - 1.0) for handling this question."""
        ...

    def meta(self) -> dict:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "trigger_keywords": self.trigger_keywords,
        }


class StrategyRegistry:
    """Global registry of analysis strategies."""

    _strategies: dict[str, StrategyBase] = {}

    @classmethod
    def register(cls, strategy_cls: type[StrategyBase]) -> type[StrategyBase]:
        """Class decorator — registers a strategy by its ``name``."""
        instance = strategy_cls()
        cls._strategies[instance.name] = instance
        return strategy_cls

    @classmethod
    def route(cls, intent: str, question: str) -> str:
        """Find the best strategy for a given intent/question. Returns strategy name."""
        best_name = "general"
        best_score = 0.0

        for name, strategy in cls._strategies.items():
            score = strategy.can_handle(intent, question)
            if score > best_score:
                best_score = score
                best_name = name

        return best_name if best_score > 0.3 else "general"

    @classmethod
    def get(cls, name: str) -> StrategyBase | None:
        return cls._strategies.get(name)

    @classmethod
    def list_all(cls) -> list[StrategyBase]:
        return list(cls._strategies.values())

    @classmethod
    def list_names(cls) -> list[str]:
        return list(cls._strategies.keys())
