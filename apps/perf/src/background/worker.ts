// A worker thread: it diffs one file at a time, works out its changed lines for finding moves,
// and highlights both versions.

import { parentPort, workerData } from 'node:worker_threads';

import { changedLines, diffText, splitLines } from '@lo/diff';
import { diskLoader, Highlighter, languageOfPath } from '@lo/syntax';
import { z } from 'zod';

import type { Done, Job } from '../shared/protocol.ts';

const { syntaxFolder } = z.object({ syntaxFolder: z.string() }).parse(workerData);
const highlighter = await Highlighter.create(diskLoader(syntaxFolder));

/** The text as the documents hold it: its lines joined with `\n`. */
function documentText(text: string | undefined): string | undefined {
  return text === undefined ? undefined : splitLines(text).join('\n');
}

parentPort?.on('message', (job: Job) => {
  const diffStarted = performance.now();
  const diff = diffText(job.old, job.new);
  const changes = changedLines(
    { path: job.path, oldPath: job.previousPath, old: job.old, new: job.new },
    diff,
  );
  const diffMs = performance.now() - diffStarted;

  const highlightStarted = performance.now();
  const language = languageOfPath(job.path);
  const tokens: Done['tokens'] = {};
  for (const side of ['old', 'new'] as const) {
    const text = documentText(job[side]);
    if (!language || text === undefined) continue;
    const highlight = highlighter.highlight(language, text);
    if ('tokens' in highlight) tokens[side] = highlight.tokens;
  }
  const done: Done = {
    index: job.index,
    diff,
    changes,
    tokens,
    diffMs,
    highlightMs: performance.now() - highlightStarted,
    // WebAssembly memory never shrinks, and after a failure it can't be trusted.
    replace: !highlighter.usable,
  };
  parentPort?.postMessage(
    done,
    [tokens.old?.buffer, tokens.new?.buffer].filter((buffer) => buffer instanceof ArrayBuffer),
  );
});
