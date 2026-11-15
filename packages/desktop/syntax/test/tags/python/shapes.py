"""Shapes and their areas."""

import math
import os.path as osp
from dataclasses import dataclass, field as make_field

from .base import Shape
from ..units import Metre, convert
from . import registry

MAX_RADIUS = 100
default_unit = Metre


@dataclass
class Circle(Shape):
    radius: float
    tags: list[str] = make_field(default_factory=list)
    count = 0

    def area(self) -> float:
        return math.pi * self.radius**2

    @property
    def diameter(self) -> float:
        doubled = self.radius * 2
        return convert(doubled, default_unit)


def largest(circles: list[Circle]) -> Circle | None:
    registry.record(osp.basename(__file__))
    return max(circles, key=Circle.area, default=None)
