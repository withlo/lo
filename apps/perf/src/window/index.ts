// The harness's page: the diff view of one pull request, filled in as the background process sends
// each file's diff and highlighting, then the moves.

import { splitLines } from '@lo/diff';

import type { PullReply, Result } from '../shared/protocol.ts';
import { DiffView } from '../view/view.ts';

declare global {
  interface Window {
    /** What the preload exposes. */
    perf: { pull(): Promise<PullReply>; connect(): void };
  }
}

const { pull, nonce } = await window.perf.pull();
// Every face the view draws loads before it measures a line: one that loaded later would change
// the width of text already measured, and so where lines wrap, behind the editors' backs.
await Promise.all(
  ['400 13px "Fragment Mono"', 'italic 400 13px "Fragment Mono"', '400 13px "Host Grotesk"'].map(
    (font) => document.fonts.load(font),
  ),
);
const root = document.getElementById('root');
if (!root) throw new Error('The page has no root.');
const view = new DiffView(
  root,
  pull.files.map((file) => ({
    ...file,
    oldLines: file.old === undefined ? [] : splitLines(file.old),
    newLines: file.new === undefined ? [] : splitLines(file.new),
  })),
  pull.threads,
  { nonce },
);

// For the measurements, which drive the page from outside.
Object.assign(window, { diffView: view });

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data !== 'perf:port') return;
  const [port] = event.ports;
  if (!port) return;
  port.addEventListener('message', ({ data }: MessageEvent<Result>) => {
    if (data.type === 'file') view.setResult(data.index, data.diff, data.tokens);
    else if (data.type === 'moves') view.setMoves(data.moves);
  });
  port.start();
});
window.perf.connect();
