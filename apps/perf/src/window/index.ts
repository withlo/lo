// The harness's page: the diff view of one pull request, filled in as the background process sends
// each file's diff and highlighting, then the moves. A large file's lines come from main when it's
// loaded, and its diff from the background process after them.

import { splitLines } from '@lo/diff';
import { DiffView, type Place } from '@lo/ui/code';

import type { Loaded, PullReply, Result } from '../shared/protocol.ts';

declare global {
  interface Window {
    /** What the preload exposes. */
    perf: {
      pull(): Promise<PullReply>;
      connect(): void;
      load(file: number): Promise<Loaded>;
      copy(text: string): Promise<void>;
    };
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
  {
    nonce,
    load: (file) => {
      void window.perf.load(file).then(
        (loaded) => view.addLines(file, lines(loaded.old), lines(loaded.new)),
        () => view.loadFailed(file),
      );
    },
    copyLink: (place) => {
      void linkTo(place).then((link) => window.perf.copy(link));
    },
  },
);

function lines(text: string | undefined): string[] {
  return text === undefined ? [] : splitLines(text);
}

/** GitHub's link to a line in the pull request's diff: the file's path hashed, and L or R. */
async function linkTo(place: Place): Promise<string> {
  const path = pull.files[place.file]!.path;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
  const side = place.side === 'old' ? 'L' : 'R';
  return `https://github.com/${pull.repo}/pull/${pull.number}/files#diff-${hash.join('')}${side}${place.line}`;
}

// For the measurements, which drive the page from outside.
Object.assign(window, { diffView: view });

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data !== 'perf:port') return;
  const [port] = event.ports;
  if (!port) return;
  port.addEventListener('message', ({ data }: MessageEvent<Result>) => {
    if (data.type === 'file') view.setResult(data.index, data.diff, data.tokens);
    else if (data.type === 'moves') {
      // The moves come last: everything has arrived.
      view.setMoves(data.moves);
      Object.assign(window, { diffLoaded: true });
    }
  });
  port.start();
});
window.perf.connect();
