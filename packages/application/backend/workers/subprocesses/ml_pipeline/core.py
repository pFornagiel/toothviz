from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class InferenceContext:
    """State object that travels through the ML pipeline."""
    data: np.ndarray
    original_spacing: np.ndarray
    current_spacing: np.ndarray
    original_shape: tuple[int, ...]
    history: dict[str, Any] = field(default_factory=dict)
    
    @classmethod
    def from_nifti(cls, image_data: np.ndarray, spacing: np.ndarray) -> InferenceContext:
        """Initialize from loaded NIfTI data (in nnUNet expected Z, Y, X layout if already transposed)."""
        # Ensure data is 4D (C, X, Y, Z) initially.
        if image_data.ndim == 3:
            data = image_data[np.newaxis, ...]
        else:
            data = image_data
            
        return cls(
            data=data,
            original_spacing=spacing.copy(),
            current_spacing=spacing.copy(),
            original_shape=data.shape,
        )


class BaseTransform(ABC):
    """Base class for all pipeline preprocessing and postprocessing steps."""
    @abstractmethod
    def forward(self, ctx: InferenceContext, **kwargs) -> None:
        """Apply transform in-place to the context."""
        pass


class BasePredictor(ABC):
    """Base class for inference strategies."""
    @abstractmethod
    def predict(self, model_session: Any, ctx: InferenceContext, progress_queue: Any = None, **kwargs) -> np.ndarray:
        """Run inference on the current context data."""
        pass


class Registry:
    """Generic registry for pipeline components."""
    def __init__(self, name: str):
        self._name = name
        self._items: dict[str, Any] = {}

    def register(self, name: str):
        def decorator(cls):
            if name in self._items:
                raise ValueError(f"Name {name} already registered in {self._name}")
            self._items[name] = cls
            return cls
        return decorator

    def get(self, name: str) -> Any:
        if name not in self._items:
            raise KeyError(f"Name '{name}' not found in registry {self._name}. Available: {list(self._items.keys())}")
        return self._items[name]


TransformRegistry = Registry("Transforms")
PredictorRegistry = Registry("Predictors")
