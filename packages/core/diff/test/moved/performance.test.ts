// Finding moves stays fast on a large pull request. On a developer's machine each test has a tight
// time limit. CI's runners are slower and busier, so there the limit is far above the few
// milliseconds each takes: a slower machine passes, and a search that grows with the square of the
// lines doesn't.

import { expect, test } from 'vitest';

import { Moves } from '../../src/moved.ts';
import { type Changes, changes } from './support.ts';

const files = 200;
const moveCount = 100;
const blockLength = 20;
const noiseHunks = 4;
const noiseLines = 10;
/** Unchanged lines between hunks. */
const context = 5;

/** Lines that repeat all over a real diff. */
const common = [
  'return;',
  'const out = [];',
  'if (value === undefined) {',
  '} else {',
  'return undefined;',
  'return out;',
  'const value = read();',
  '@Injectable()',
  'constructor() {',
  'super();',
  'for (const item of items) {',
  'out.push(item);',
];
const punctuation = ['}', '});', ']', ')', ''];

/** A small deterministic random number generator, so the diff is the same on every run. */
class Random {
  #state: bigint;

  constructor(seed: number) {
    this.#state = BigInt(seed);
  }

  below(bound: number): number {
    this.#state = BigInt.asUintN(
      64,
      this.#state * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n,
    );
    return Number((this.#state >> 33n) % BigInt(bound));
  }
}

/**
 * A changed line that isn't part of a planted move: punctuation, a line common all over the diff, a
 * line found in a few places, or a line found only on its side of the diff.
 */
function noise(random: Random, side: string, file: number, line: number): string {
  const kind = random.below(20);
  if (kind < 5) return punctuation[random.below(punctuation.length)]!;
  if (kind < 8) return common[random.below(common.length)]!;
  if (kind < 13) {
    const n = random.below(1000);
    return `const shared${n} = lookup(${n});`;
  }
  return `const ${side}_${file}_${line} = compute(${line});`;
}

/** Lines no other line matches, around each planted block so its lineup stops at its edges. */
function guards(side: string, file: number, line: number): string[] {
  return [0, 1, 2].map((n) => `// ${side} guard ${file} ${line} ${n}`);
}

/** The block planted for move `k`, as deleted. */
function block(k: number): string[] {
  return Array.from({ length: blockLength }, (_, j) => {
    if (j % 7 === 2) return '    }';
    if (j % 7 === 4) return '';
    return `    const block_${k}_${j} = item.field${j}.compute(${k});`;
  });
}

/** Move `k`'s block as added: every third one re-indented, every third one with an edit. */
function blockMoved(k: number): string[] {
  const lines = block(k);
  if (k % 3 === 0) return lines.map((line) => `        ${line}`);
  if (k % 3 === 1) lines[blockLength / 2] = `    const block_${k}_edited = changed();`;
  return lines;
}

const sourceFile = (k: number): number => k;
const destinationFile = (k: number): number => (k * 37 + 11) % files;

/** A planted move: the file and first line where its block is deleted, and where it's added. */
interface Planted {
  from: [file: number, line: number];
  to: [file: number, line: number];
}

/**
 * A 20,000-line diff over 200 files: 100 blocks of 20 lines moved between files, a third of them
 * re-indented and a third edited, among hunks of other changed lines.
 */
function largeDiff(): { diff: Changes[]; planted: Planted[] } {
  const random = new Random(42);
  const diff = Array.from({ length: files }, (_, file) => changes(`src/file${file}.ts`));
  const planted: Planted[] = Array.from({ length: moveCount }, () => ({
    from: [0, 0],
    to: [0, 0],
  }));
  diff.forEach((file, index) => {
    let old = 1;
    let added = 1;
    for (let hunk = 0; hunk < noiseHunks; hunk++) {
      const deletedNoise = Array.from({ length: noiseLines }, (_, n) =>
        noise(random, 'old', index, old + n),
      );
      const addedNoise = Array.from({ length: noiseLines }, (_, n) =>
        noise(random, 'new', index, added + n),
      );
      file.delete(old, deletedNoise).add(added, addedNoise);
      old += noiseLines + context;
      added += noiseLines + context;

      const source = Array.from({ length: moveCount }, (_, k) => k).find(
        (k) => sourceFile(k) === index,
      );
      if (hunk === 1 && source !== undefined) {
        const deleted = [
          ...guards('old', index, old),
          ...block(source),
          ...guards('old', index, old + 100),
        ];
        file.delete(old, deleted);
        planted[source]!.from = [index, old + 3];
        old += deleted.length + context;
        added += context;
      }
      if (hunk === 2) {
        for (let k = 0; k < moveCount; k++) {
          if (destinationFile(k) !== index) continue;
          const lines = [
            ...guards('new', index, added),
            ...blockMoved(k),
            ...guards('new', index, added + 100),
          ];
          file.add(added, lines);
          planted[k]!.to = [index, added + 3];
          added += lines.length + context;
          old += context;
        }
      }
    }
  });
  return { diff, planted };
}

/** Fails a run on a developer's machine that took 100 ms or more, or one on CI that took a second. */
function expectFast(elapsed: number): void {
  expect(elapsed).toBeLessThan(process.env.CI ? 1000 : 100);
}

test('finds moves in a 20000 line diff within 100 ms', () => {
  const { diff, planted } = largeDiff();
  const lines = diff.reduce((total, file) => total + file.deleted.length + file.added.length, 0);
  expect(lines).toBeGreaterThanOrEqual(20_000);

  const start = performance.now();
  const moves = Moves.find(diff);
  const elapsed = performance.now() - start;

  planted.forEach(({ from, to }, k) => {
    const moved = moves.ofAdded(to[0], to[1]);
    expect(moved, `move ${k}`).toMatchObject({
      from: { file: from[0], first: from[1], last: from[1] + blockLength - 1 },
      to: { file: to[0], first: to[1], last: to[1] + blockLength - 1 },
    });
    expect(moved?.edits.length, `move ${k}`).toBe(k % 3 === 1 ? 1 : 0);
  });
  expectFast(elapsed);
});

test('a line repeated thousands of times stays fast', () => {
  // A table of the same line, with a few distinct lines in the middle, moved to another file.
  const table = [
    ...Array<string>(1500).fill('value = 0,'),
    'first = 1,',
    'second = 2,',
    'third = 3,',
    ...Array<string>(1500).fill('value = 0,'),
  ];
  const diff = [changes('a.ts').delete(1, table), changes('b.ts').add(1, table)];

  const start = performance.now();
  const moves = Moves.find(diff);
  const elapsed = performance.now() - start;

  expect(moves.all.map(({ from, to }) => [from.first, from.last, to.first, to.last])).toEqual([
    [1, 3003, 1, 3003],
  ]);
  expectFast(elapsed);
});

test('a long lineup with every other line edited stays fast', () => {
  // 20,000 lines that line up, with every other line edited: never two thirds matching.
  const old = Array.from({ length: 10_000 }, (_, n) => [
    `const kept${n} = ${n};`,
    `const old${n} = ${n};`,
  ]).flat();
  const added = Array.from({ length: 10_000 }, (_, n) => [
    `const kept${n} = ${n};`,
    `const new${n} = ${n};`,
  ]).flat();
  const diff = [changes('a.ts').delete(1, old), changes('b.ts').add(1, added)];

  const start = performance.now();
  const moves = Moves.find(diff);
  const elapsed = performance.now() - start;

  expect(moves.all).toEqual([]);
  expectFast(elapsed);
});
