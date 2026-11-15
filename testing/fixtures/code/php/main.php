<?php

declare(strict_types=1);

use Sample\Report;
use Sample\Words;

spl_autoload_register(static function (string $class): void {
    require __DIR__ . '/src/' . substr($class, strlen('Sample\\')) . '.php';
});

$text = 'the quick brown fox jumps over the lazy dog';
echo Report::summarize($text), "\n";
echo Words::countWords($text), " words in all\n";
