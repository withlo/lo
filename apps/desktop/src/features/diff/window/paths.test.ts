// @vitest-environment jsdom
import { createHash } from 'node:crypto';

import { createDiffView, type DiffView } from '@lo/ui/code';
import { diffText } from '@lo/diff';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { DiffState, FileText, FileVersions } from '../contract.ts';
import { diffFileOf, inOrder, shownPath } from './files.ts';
import { Loader } from './loader.ts';

const noRects = (): DOMRectList => Object.assign([], { item: () => null });

/** jsdom has no fonts, no resize observer and no layout: the view needs only that they exist. */
beforeAll(() => {
  if (!('fonts' in document)) {
    Object.defineProperty(document, 'fonts', {
      value: { addEventListener() {}, removeEventListener() {} },
    });
  }
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', { value: noRects });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: () => new DOMRect() });
  }
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

let view: DiffView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

const HEAD = 'a'.repeat(40);
/** A path over a kilobyte long, and one of 20 KB. */
const KILOBYTE = `src/${'k'.repeat(1100)}/a.ts`;
const TWENTY = `src/${'t'.repeat(20 * 1024)}/b.ts`;

/** A path as main sends it: one over 1,024 bytes with its digest. */
function treePath(text: string): FileVersions['path'] {
  const bytes = Buffer.from(text, 'utf8');
  return bytes.length > 1024
    ? { text, digest: createHash('sha256').update(bytes).digest('hex') }
    : { text };
}

function versions(path: string): FileVersions {
  return {
    path: treePath(path),
    previous: null,
    change: 'modified',
    additions: 1,
    deletions: 1,
    old: { blob: 'c'.repeat(40), size: 10 },
    new: { blob: 'd'.repeat(40), size: 10 },
    start: 'shown',
    generated: null,
    large: null,
    submodule: null,
    reach: 0,
  };
}

describe('files with long paths', () => {
  it('all show in the diff, their paths cut in the middle, and `]f` reaches each', async () => {
    const files = [versions('README.md'), versions(KILOBYTE), versions(TWENTY), versions('z.ts')];
    const loader = new Loader({
      texts: ({ files: places }) =>
        Promise.resolve(
          places.map((): FileText => ({ kind: 'texts', old: 'a\nb\n', new: 'a\nc\n' })),
        ),
      files: ({ files: jobs }) =>
        Promise.resolve(
          jobs.map(() => ({
            ok: true as const,
            diff: diffText('a\nb\n', 'a\nc\n'),
            tokens: {},
            changes: { deleted: [], added: [] },
          })),
        ),
      moves: () => Promise.resolve([]),
      highlight: ({ files: highlighted }) => Promise.resolve(highlighted.map(() => ({}))),
      // A left panel that lists only the short paths: the long ones still show, after them.
      order: () => ['z.ts', 'README.md'],
      log: () => undefined,
    });
    loader.setWhitespace(true);
    const state: DiffState = {
      id: 't1',
      at: HEAD,
      from: 'local',
      files,
      partial: false,
      problem: null,
    };
    loader.take(state);
    await expect.poll(() => loader.snapshot().ready).toBeDefined();
    const ready = loader.snapshot().ready!;
    const entries = inOrder(ready.entries, ['z.ts', 'README.md'], (key) => loader.ids.find(key));
    expect(entries.map((entry) => entry.versions.path.text)).toEqual([
      'z.ts',
      'README.md',
      KILOBYTE,
      TWENTY,
    ]);

    const diffFiles = entries.map((entry) => diffFileOf(entry, loader.shown(entry.id)));
    expect(diffFiles.every((file) => file.lines !== undefined)).toBe(true);
    expect(diffFiles[3]?.path.length).toBeLessThan(250);
    expect(diffFiles[3]?.path).toBe(shownPath(TWENTY));
    expect(shownPath(TWENTY)).toMatch(/^src\/t+…t+\/b\.ts$/);

    const parent = document.createElement('div');
    document.body.append(parent);
    view = createDiffView(
      parent,
      { files: diffFiles, layout: 'split', vimKeys: [], nonce: '' },
      {
        cursor() {},
        mode() {},
        file() {},
        jumped() {},
        load() {},
        menu() {},
      },
    );
    for (const file of diffFiles) {
      const shown = loader.shown(file.id);
      if (shown) view.setDiff(file.id, shown.diff);
    }
    const reached: string[] = [];
    view.reveal({ kind: 'file', file: entries[0]!.id });
    for (let step = 0; step < 3; step++) {
      view.jump('file', 1);
      const { target } = view.keyState();
      if (target.kind === 'header') reached.push(loader.ids.keyOf(target.file) ?? '?');
    }
    expect(reached.map((key) => (key.startsWith('\0#') ? 'digest' : key))).toEqual([
      'README.md',
      'digest',
      'digest',
    ]);
    // No key is long: a long path's is its digest.
    expect(entries.every((entry) => entry.key.length <= 1024)).toBe(true);
  });
});
