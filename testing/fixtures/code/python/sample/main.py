"""Print a summary of a sentence."""

from __future__ import annotations

from .report import report
from .words import count_words

TEXT = "the quick brown fox jumps over the lazy dog"

if __name__ == "__main__":
    print("\n".join(report(TEXT, 20)))
    print(f"{count_words(TEXT)} words in all")
