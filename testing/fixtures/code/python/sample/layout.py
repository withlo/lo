"""Laying text out."""

from __future__ import annotations


def wrap(text: str, width: int) -> list[str]:
    """Split `text` into lines of at most `width` characters, breaking between words."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        if line != "" and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = word if line == "" else f"{line} {word}"
    if line != "":
        lines.append(line)
    return lines
