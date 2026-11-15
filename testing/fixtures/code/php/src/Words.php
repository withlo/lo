<?php

declare(strict_types=1);

namespace Sample;

/** Counting words. */
final class Words
{
    /** Counts the words in `$text`: runs of characters between whitespace. */
    public static function countWords(string $text): int
    {
        return str_word_count($text);
    }
}
