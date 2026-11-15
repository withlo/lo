<?php

declare(strict_types=1);

namespace Sample;

/** Counts how often each word comes up. */
final class Tally
{
    /** @var array<string, int> */
    private array $counts = [];

    /** Adds one more sighting of `$word`, and returns how many have been seen. */
    public function add(string $word): int
    {
        $this->counts[$word] = ($this->counts[$word] ?? 0) + 1;

        return $this->counts[$word];
    }

    /** The word seen most often, or null before any. */
    public function top(): ?string
    {
        if ($this->counts === []) {
            return null;
        }
        arsort($this->counts);

        return (string) array_key_first($this->counts);
    }
}
