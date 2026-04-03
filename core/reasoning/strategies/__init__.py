"""Composable analysis strategies — each one builds a specialized sub-graph."""
from core.reasoning.strategies.base import StrategyBase, StrategyRegistry

# Import all strategies to trigger registration
from core.reasoning.strategies import causal  # noqa: F401
from core.reasoning.strategies import statistical  # noqa: F401
from core.reasoning.strategies import comparative  # noqa: F401
from core.reasoning.strategies import trend  # noqa: F401
from core.reasoning.strategies import whatif  # noqa: F401

__all__ = ["StrategyBase", "StrategyRegistry"]
