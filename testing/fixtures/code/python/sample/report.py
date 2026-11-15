"""Summaries of a text."""

from __future__ import annotations

from .layout import wrap
from .words import Tally, count_words


def summarize(text: str) -> str:
    """Summarize `text`: how many words it has, and the one that comes up most."""
    tally = Tally()
    for word in text.split():
        tally.add(word.lower())
    total = count_words(text)
    return f'{total} words, mostly "{tally.top() or ""}"'


def report(text: str, width: int) -> list[str]:
    """The summary of `text`, wrapped to lines of at most `width` characters."""
    return wrap(summarize(text), width)
