"""Counting words."""

from __future__ import annotations

from collections import Counter


def count_words(text: str) -> int:
    """Count the words in `text`: runs of characters between whitespace."""
    return len(text.split())


class Tally:
    """Counts how often each word comes up."""

    def __init__(self) -> None:
        self._counts: Counter[str] = Counter()

    def add(self, word: str) -> int:
        """Add one more sighting of `word`, and return how many have been seen."""
        self._counts[word] += 1
        return self._counts[word]

    def count(self, word: str) -> int:
        """How many times `word` has been seen."""
        return self._counts[word]

    def top(self) -> str | None:
        """The word seen most often, or None before any."""
        common = self._counts.most_common(1)
        return common[0][0] if common else None
