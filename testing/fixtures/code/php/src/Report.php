<?php

declare(strict_types=1);

namespace Sample;

/** Summaries of a text. */
final class Report
{
    /** A summary of `$text`: how many words it has, and the one that comes up most. */
    public static function summarize(string $text): string
    {
        $tally = new Tally();
        foreach (preg_split('/\s+/', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $word) {
            $tally->add(strtolower($word));
        }
        $total = Words::countWords($text);

        return sprintf('%d words, mostly "%s"', $total, $tally->top() ?? '');
    }
}
