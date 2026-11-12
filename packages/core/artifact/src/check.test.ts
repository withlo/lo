import { describe, expect, test } from 'vitest';

import { HEADER, overview, PREAMBLE_LINES } from '../test/support.ts';
import { listed, overviewFiles, repository, type Paths } from '../test/readers.ts';
import {
  ARTIFACT_READ,
  checkArtifact,
  LIMITS,
  parseArtifact,
  type CheckedArtifact,
  type CheckOptions,
  type TreeEntry,
} from './index.ts';

const LINE = PREAMBLE_LINES + 1;
const COMMIT = '3f9c2e1d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e';
const MIB = 1024 * 1024;

/** The code the overviews here point at. */
const held: Paths = { 'src/a.ts': 'one\ntwo\nthree\n' };

/** `text` as `artifact.md`, checked in a commit that also holds `paths` and `extra`. */
async function check(
  text: string,
  paths: Paths = {},
  extra: readonly TreeEntry[] = [],
  options: CheckOptions = { pr: 4797 },
): Promise<CheckedArtifact & { asked: number }> {
  const { readCode, asked } = repository(COMMIT, held);
  const files = overviewFiles({ 'artifact.md': text, ...paths }, extra);
  const checked = await checkArtifact(parseArtifact(text), files, readCode, options);
  return { ...checked, asked: asked.length };
}

/** The findings, as `code@line`, with `:file` for one about another of the commit's paths. */
function codes(checked: CheckedArtifact): string[] {
  return checked.findings.map(({ code, line, file }) => {
    const at = line === undefined ? code : `${code}@${line}`;
    return file === 'artifact.md' ? at : `${at}:${file}`;
  });
}

const encoder = new TextEncoder();

/** The smallest figure Lo draws: an SVG with a size. */
const SVG = '<svg viewBox="0 0 1 1"/>';

describe('the commit', () => {
  test('holds artifact.md and figures directly in figures/', async () => {
    const checked = await check(overview(':::figure figures/a.svg\nA.\n:::\n'), {
      'figures/a.svg': SVG,
      'figures/b.png': new Uint8Array(8),
    });
    expect(checked.findings).toEqual([]);
    expect(checked.outcome.kind).toBe('shown');
  });

  test('without artifact.md, the overview is invalid', async () => {
    const files = overviewFiles({ 'figures/a.svg': '<svg/>' });
    const checked = await checkArtifact(undefined, files, repository(COMMIT, held).readCode);
    expect(checked.outcome).toEqual({ kind: 'invalid' });
    expect(codes(checked)).toEqual(['artifact-missing']);
  });

  test('artifact.md in another case is no artifact.md, and says so', async () => {
    const text = overview('');
    const files = overviewFiles({ 'Artifact.md': text });
    const checked = await checkArtifact(
      parseArtifact(text),
      files,
      repository(COMMIT, held).readCode,
    );
    expect(checked.outcome).toEqual({ kind: 'invalid' });
    expect(codes(checked)).toEqual(['artifact-missing', 'tree-extra:Artifact.md']);
    expect(checked.findings[0]?.message).toContain('It has Artifact.md');
  });

  test.each(['link', 'folder', 'submodule'] as const)(
    'artifact.md as a %s is invalid, whatever was parsed in its place',
    async (kind) => {
      const files = overviewFiles({ 'artifact.md': { kind } });
      // A parse of what a link points at, which is never the overview's text.
      const checked = await checkArtifact(
        parseArtifact(overview('[a](code:src/missing.ts)\n')),
        files,
        repository(COMMIT, held).readCode,
      );
      expect(checked.outcome).toEqual({ kind: 'invalid' });
      expect(codes(checked)).toEqual(['artifact-not-file']);
    },
  );

  test('artifact.md there but not read is invalid, unless the listing says it’s too large', async () => {
    const files = overviewFiles({ 'artifact.md': overview('') });
    const checked = await checkArtifact(undefined, files, repository(COMMIT, held).readCode);
    expect(checked.outcome).toEqual({ kind: 'invalid' });
    expect(codes(checked)).toEqual(['unreadable']);
    // Too large to read, it's too large, by the listing, with its byte-order mark allowed for.
    for (const [size, outcome] of [
      [ARTIFACT_READ, 'invalid'],
      [ARTIFACT_READ + 1, 'tooLarge'],
    ] as const) {
      const large = overviewFiles({ 'artifact.md': { kind: 'file', size } });
      const read = await checkArtifact(undefined, large, repository(COMMIT, held).readCode);
      expect(read.outcome.kind).toBe(outcome);
      expect(codes(read)).toEqual([outcome === 'invalid' ? 'unreadable' : 'too-large']);
    }
  });

  test('artifact.md the listing says is too large to read is too large, whatever was parsed', async () => {
    // A parse of its start, or of anything else, read past the listing's word.
    const parsed = parseArtifact(overview('[a](code:src/a.ts#L1)\n'));
    expect(parsed.findings).toEqual([]);
    for (const newer of [false, true]) {
      const text = newer ? HEADER.replace('format: 1', 'format: 2') : '';
      const files = overviewFiles({ 'artifact.md': { kind: 'file', size: ARTIFACT_READ + 1 } });
      const checked = await checkArtifact(
        newer ? parseArtifact(text) : parsed,
        files,
        repository(COMMIT, held).readCode,
      );
      expect(checked.outcome).toMatchObject({ kind: 'tooLarge', what: 'text' });
      expect(codes(checked)).toEqual(['too-large']);
    }
  });

  test('a listing a reader got wrong is refused, never thrown', async () => {
    // A path that isn't bytes, as no reader should list.
    const wrong: TreeEntry[] = JSON.parse('[{ "path": "artifact.md", "kind": "file" }]');
    const files = { ...overviewFiles({}), entries: wrong };
    const checked = await checkArtifact(undefined, files, repository(COMMIT, held).readCode);
    expect(checked.outcome).toEqual({ kind: 'invalid' });
    expect(codes(checked)).toEqual(['unreadable']);
  });

  test('anything else is reported once, at its outermost path, and the overview still shows', async () => {
    const checked = await check(overview(''), {
      'README.md': 'Hi.',
      'docs/a/b.md': 'B.',
      'docs/c.md': 'C.',
      'figures/sub/a.svg': '<svg/>',
      'figures/sub/b.svg': '<svg/>',
      'figures/notes.txt': 'Notes.',
      'figures/flow.SVG': '<svg/>',
      'figures/.svg': '<svg/>',
      'figures/link.svg': { kind: 'link', size: 11 },
      'figures/module.png': { kind: 'submodule' },
      'figures/folder.png': { kind: 'folder' },
    });
    expect(checked.outcome.kind).toBe('shown');
    expect(codes(checked).toSorted()).toEqual(
      [
        'tree-extra:README.md',
        'tree-extra:docs',
        'tree-extra:figures/sub',
        'tree-extra:figures/notes.txt',
        'tree-extra:figures/flow.SVG',
        'tree-extra:figures/.svg',
        'tree-extra:figures/link.svg',
        'tree-extra:figures/module.png',
        'tree-extra:figures/folder.png',
      ].toSorted(),
    );
    expect(checked.findings.map(({ message }) => message)).toContain(
      'figures/link.svg is a link. figures/ holds only files.',
    );
  });

  test('what the commit holds is reported the same, whatever order it’s listed in', async () => {
    const text = overview(':::figure figures/a.svg\nA.\n:::\n');
    const entries: TreeEntry[] = [
      'z.md',
      'figures/A.svg',
      'b/c.md',
      'figures/sub/x.svg',
      'a.md',
      'figures/a.SVG',
    ].map((path) => ({ path: encoder.encode(path), kind: 'file', size: 1 }));
    const forward = await check(text, {}, entries);
    const backward = await check(text, {}, entries.toReversed());
    expect(backward.findings).toEqual(forward.findings);
    expect(codes(forward)).toEqual([
      'tree-extra:a.md',
      'tree-extra:b',
      'tree-extra:figures/a.SVG',
      'tree-extra:figures/sub',
      'tree-extra:z.md',
      `figure-missing@${LINE}`,
    ]);
    expect(forward.findings.at(-1)?.message).toContain('It has figures/A.svg');
  });

  test('figures itself is a folder', async () => {
    const checked = await check(overview(''), { figures: { kind: 'link', size: 4 } });
    expect(codes(checked)).toEqual(['tree-extra:figures']);
    expect(checked.findings[0]?.message).toBe(
      "figures is a link. It's the folder the figures sit directly in.",
    );
  });

  test('a path that isn’t UTF-8, or isn’t plain, is reported harmlessly', async () => {
    const odd = [
      Uint8Array.of(0x66, 0x69, 0x67, 0xff, 0x2e, 0x73, 0x76, 0x67),
      encoder.encode('.git/config'),
      encoder.encode('figures/a‮gvs.png'),
      encoder.encode('figures/\x1b[2J.svg'),
    ];
    const checked = await check(
      overview(''),
      {},
      odd.map((path) => listed(path, 'file', 1)),
    );
    expect(checked.findings.map(({ code }) => code)).toEqual(Array(4).fill('tree-extra'));
    for (const { file, message } of checked.findings) {
      expect(file + message).not.toMatch(/[\p{Cc}\p{Cf}\u2028\u2029]/u);
    }
  });

  test('a path listed twice is a file only if it’s a file both times', async () => {
    const text = overview(':::figure figures/a.svg\nA.\n:::\n');
    const files = await check(text, { 'figures/a.svg': SVG }, [
      { path: encoder.encode('figures/a.svg'), kind: 'file', size: SVG.length },
    ]);
    expect(codes(files)).toEqual(['tree-extra:figures/a.svg']);
    expect(files.findings[0]?.message).toBe("figures/a.svg is in the overview's commit twice.");
    const twice = await check(text, { 'figures/a.svg': SVG }, [
      { path: encoder.encode('figures/a.svg'), kind: 'link', size: 11 },
    ]);
    expect(codes(twice)).toEqual(['tree-extra:figures/a.svg', `figure-not-file@${LINE}`]);
    const link = await check(text, {}, [
      { path: encoder.encode('figures/a.svg'), kind: 'link', size: 11 },
      { path: encoder.encode('figures/a.svg'), kind: 'file', size: SVG.length },
    ]);
    expect(codes(link)).toEqual(['tree-extra:figures/a.svg', `figure-not-file@${LINE}`]);
  });

  test('a figure is in the commit, as a file, its name in the same case', async () => {
    const text = overview(
      ':::figure figures/a.svg\nA.\n:::\n\n:::figure figures/b.svg\nB.\n:::\n\n:::figure figures/c.svg\nC.\n:::\n',
    );
    const checked = await check(text, {
      'figures/A.svg': '<svg/>',
      'figures/c.svg': { kind: 'link', size: 3 },
    });
    expect(codes(checked)).toEqual([
      'tree-extra:figures/c.svg',
      `figure-missing@${LINE}`,
      `figure-missing@${LINE + 4}`,
      `figure-not-file@${LINE + 8}`,
    ]);
    expect(checked.findings[1]?.message).toBe(
      "figures/a.svg isn't in the overview's commit. It has figures/A.svg: names match exactly, in the same case.",
    );
    // Figures are left for Lo to leave out: the overview still shows.
    expect(checked.outcome.kind).toBe('shown');
  });
});

/** `count` figures of `size` bytes, as a commit lists them. */
function figures(count: number, size = 10): TreeEntry[] {
  return Array.from({ length: count }, (_, n) => listed(`figures/f${n}.png`, 'file', size));
}

test('past the limit on figures, the rest aren’t looked for in the commit', async () => {
  const blocks = Array.from(
    { length: LIMITS.figures + 1 },
    (_, n) => `:::figure figures/f${n}.png\nF.\n:::`,
  );
  // Every figure but the one past the limit is there.
  const checked = await check(overview(`${blocks.join('\n')}\n`), {}, figures(LIMITS.figures));
  expect(checked.findings.map(({ code }) => code)).toEqual(['figure-count']);
});

describe('the commit’s limits', () => {
  test('500 files and folders, counting the folders paths pass through', async () => {
    // artifact.md, figures and 498 figures.
    const at = await check(overview(''), {}, figures(498));
    expect(at.findings).toEqual([]);
    // Listing the folder doesn't count it twice.
    const withFolder = await check(overview(''), {}, [
      ...figures(498),
      { path: encoder.encode('figures'), kind: 'folder' },
    ]);
    expect(withFolder.findings).toEqual([]);
    const past = await check(overview(''), {}, figures(499));
    expect(codes(past)).toEqual(['tree-count']);
    expect(past.outcome).toMatchObject({ kind: 'tooLarge', what: 'entries' });
    expect(past.findings[0]?.message).toBe(
      "The overview's commit holds more than 500 files and folders, the most an overview may hold.",
    );
    expect(past.asked).toBe(0);
  });

  test('a path longer than any target is reported quickly', async () => {
    const long = encoder.encode(`figures/${'d'.repeat(1_000_000)}.png`);
    const started = performance.now();
    const checked = await check(overview(''), {}, [listed(long, 'file', 1)]);
    expect(performance.now() - started).toBeLessThan(100);
    expect(checked.outcome.kind).toBe('shown');
    expect(codes(checked)).toEqual([`tree-extra:figures/${'d'.repeat(40)}…`]);
    expect(checked.findings[0]?.message).toBe(
      "A path in the overview's commit is longer than 1,024 bytes, which no overview holds.",
    );
  });

  test('a path longer than any target counts each folder it passes through, quickly', async () => {
    const deep = encoder.encode(`${'d/'.repeat(1_000_000)}x.png`);
    const started = performance.now();
    const checked = await check(overview(''), {}, [listed(deep, 'file', 1)]);
    expect(performance.now() - started).toBeLessThan(100);
    expect(checked.outcome).toMatchObject({
      kind: 'tooLarge',
      what: 'entries',
      sizes: { entries: LIMITS.entries + 1 },
    });
    expect(codes(checked)).toEqual(['tree-count']);
  });

  test('a listing of files alone counts as one that lists their folders too', async () => {
    // A path past 1,024 bytes through 100 folders: with artifact.md, figures and its file, 102
    // files and folders besides the figures.
    const parts = Array.from({ length: 100 }, (_, n) => `folder${String(n).padStart(4, '0')}`);
    const long = `${parts.join('/')}/x.png`;
    expect(long.length).toBeGreaterThan(LIMITS.argument);
    const folders = parts.map((_, n) => listed(parts.slice(0, n + 1).join('/'), 'folder', 0));
    for (const [count, outcome] of [
      [397, 'shown'],
      [398, 'tooLarge'],
    ] as const) {
      const files = [...figures(count), listed(long, 'file', 1)];
      for (const entries of [files, [...files, ...folders]]) {
        const checked = await check(overview(''), {}, entries);
        expect(checked.outcome.kind).toBe(outcome);
      }
    }
  });

  test('long paths through the same long folder count it once', async () => {
    // Ten files in one folder whose name is past 1,024 bytes: with artifact.md, figures, the folder
    // and the one it's in, 500 files and folders, unless the long one counted more than once.
    const folder = `long/${'f'.repeat(2_000)}`;
    const paths = Array.from({ length: 10 }, (_, n) => listed(`${folder}/${n}.png`, 'file', 1));
    for (const extra of [[], [listed(folder, 'folder', 0)]]) {
      const at = await check(overview(''), {}, [...figures(486), ...paths, ...extra]);
      expect(at.outcome.kind).toBe('shown');
      const past = await check(overview(''), {}, [...figures(487), ...paths, ...extra]);
      expect(past.outcome).toMatchObject({ kind: 'tooLarge', what: 'entries' });
    }
  });

  test('a path through as many folders as fit in a target counts each', async () => {
    const deep = `${'d/'.repeat(LIMITS.entries)}x`;
    expect(deep.length).toBeLessThanOrEqual(LIMITS.argument);
    const checked = await check(overview(''), {}, [listed(deep, 'file', 1)]);
    // Counting stops just past the limit.
    expect(checked.outcome).toMatchObject({
      kind: 'tooLarge',
      what: 'entries',
      sizes: { entries: LIMITS.entries + 1 },
    });
  });

  test('of a listing of a million entries, one past the limit’s worth is read', async () => {
    const text = overview('');
    const figure = listed('figures/f.png', 'file', 10);
    // artifact.md last, where it's still found.
    const entries = [
      ...Array.from({ length: 1_000_000 }, () => figure),
      listed('artifact.md', 'file', text.length),
    ];
    const files = { ...overviewFiles({}), entries };
    const started = performance.now();
    const checked = await checkArtifact(
      parseArtifact(text),
      files,
      repository(COMMIT, held).readCode,
    );
    expect(performance.now() - started).toBeLessThan(250);
    expect(checked.outcome).toEqual({
      kind: 'tooLarge',
      what: 'entries',
      sizes: { entries: 501, bytes: 5_010, kinds: [{ kind: 'png', files: 501, bytes: 5_010 }] },
    });
  });

  test('50 MiB, as the listing gives the sizes', async () => {
    const text = overview('');
    const size = text.length;
    const at = await check(text, {
      'figures/big.png': { kind: 'file', size: LIMITS.commit - size },
    });
    expect(at.findings).toEqual([]);
    const past = await check(text, {}, [
      ...figures(31, 2 * MIB),
      listed('figures/flow.svg', 'file', 12 * MIB),
    ]);
    expect(codes(past)).toEqual(['tree-size']);
    expect(past.findings[0]?.message).toBe(
      "The overview's commit is 74.1 MiB, past the 50 MiB an overview may be. Most of it is 31 .png files, 62 MiB in all.",
    );
    expect(past.outcome).toEqual({
      kind: 'tooLarge',
      what: 'bytes',
      sizes: {
        bytes: 74 * MIB + size,
        entries: 34,
        kinds: [
          { kind: 'png', files: 31, bytes: 62 * MIB },
          { kind: 'svg', files: 1, bytes: 12 * MIB },
          { kind: 'artifact', files: 1, bytes: size },
        ],
      },
    });
  });

  test.each([undefined, Number.NaN, -1, Infinity, 1e300, 1.5])(
    'a file whose size the listing gives as %s is refused, since the commit can’t be measured',
    async (size) => {
      const checked = await check(overview(''), {}, [listed('figures/f.png', 'file', size)]);
      expect(checked.outcome).toEqual({ kind: 'invalid' });
      expect(codes(checked)).toEqual(['unreadable']);
      expect(checked.findings[0]?.message).toBe(
        "Lo couldn't tell how large figures/f.png is, so it couldn't check the overview's size.",
      );
      expect(checked.asked).toBe(0);
    },
  );

  test('a file of no size is 0 bytes, and counts', async () => {
    const checked = await check(overview(''), { 'figures/f.png': new Uint8Array() });
    expect(checked.outcome.kind).toBe('shown');
  });

  test('a folder or a submodule has no size, whatever the listing says', async () => {
    const checked = await check(overview(''), {
      figures: { kind: 'folder', size: LIMITS.commit },
      'figures/m.png': { kind: 'submodule', size: LIMITS.commit },
    });
    expect(codes(checked)).toEqual(['tree-extra:figures/m.png']);
  });
});

describe('the outcome', () => {
  test('a newer format is all that’s said, and nothing else is read', async () => {
    const text = `---\nformat: 2\npr: 1\ncommit: ${COMMIT}\n---\n:::chart\n`;
    const checked = await check(text, { 'notes.txt': 'x', ...held }, figuresPast());
    expect(checked.outcome).toEqual({ kind: 'newer', format: 2 });
    expect(codes(checked)).toEqual(['format-newer@2']);
    expect(checked.asked).toBe(0);
  });

  test('text past its limit is too large', async () => {
    const text = overview('a'.repeat(LIMITS.size));
    const checked = await check(text);
    expect(checked.outcome).toMatchObject({ kind: 'tooLarge', what: 'text' });
    expect(codes(checked)).toEqual(['too-large']);
    expect(checked.asked).toBe(0);
  });

  test('an invalid overview’s code is checked too, so all of it is reported', async () => {
    const checked = await check(overview(':::chart\n:::\n\n[a](code:src/b.ts#L1)\n'));
    expect(checked.outcome).toEqual({ kind: 'invalid' });
    expect(codes(checked)).toEqual([`block-unknown@${LINE}`, `code-missing@${LINE + 3}`]);
  });

  test('an invalid header leaves the code unread', async () => {
    const checked = await check(
      `---\nformat: 1\npr: x\ncommit: ${COMMIT}\n---\n\n## tl;dr\n\nA.\n`,
    );
    expect(checked.outcome).toEqual({ kind: 'invalid' });
    expect(codes(checked)).toEqual(['pr-invalid@3']);
    expect(checked.asked).toBe(0);
  });

  test('an overview on another pull request’s ref is invalid', async () => {
    const text = overview('[a](code:src/a.ts#L1)\n');
    const other = await check(text, {}, [], { pr: 4798 });
    expect(other.outcome).toEqual({ kind: 'invalid' });
    expect(codes(other)).toEqual(['pr-mismatch']);
    expect(other.findings[0]?.message).toBe(
      'The header says pr: 4797, and the overview is on pull request #4798.',
    );
    // With no pull request to compare, as when checking a folder, any is taken.
    expect((await check(text, {}, [], {})).outcome.kind).toBe('shown');
  });

  test('a shown overview has its header, each target’s code and each figure', async () => {
    const checked = await check(
      overview(
        ':::code src/a.ts#L1-L3\n:::\n\n[b](code:src/b.ts)\n\n:::figure figures/a.svg\nA.\n:::\n',
      ),
      { 'figures/a.svg': '<svg viewBox="0 0 10 10"><rect id="r"/></svg>' },
    );
    expect(checked.outcome).toEqual({
      kind: 'shown',
      header: { format: 1, pr: 4797, commit: COMMIT },
      code: [
        {
          reference: {
            target: { kind: 'code', path: 'src/a.ts', lines: { start: 1, end: 3 } },
            line: LINE,
            from: 'block',
          },
          code: { state: 'resolved' },
        },
        {
          reference: { target: { kind: 'code', path: 'src/b.ts' }, line: LINE + 3, from: 'link' },
          code: { state: 'broken', why: 'missing' },
        },
      ],
      figures: [
        {
          reference: { path: 'figures/a.svg', line: LINE + 5, parts: [] },
          figure: {
            state: 'kept',
            type: 'svg',
            svg: {
              kind: 'element',
              name: 'svg',
              attributes: { viewBox: '0 0 10 10' },
              children: [{ kind: 'element', name: 'rect', attributes: { id: 'r' }, children: [] }],
            },
            parts: [],
          },
        },
      ],
    });
    expect(codes(checked)).toEqual([`code-missing@${LINE + 3}`]);
  });

  test('warnings leave an overview shown', async () => {
    const checked = await check(`${HEADER}\n## tl;dr\n\nA <br> break.\n`);
    expect(checked.outcome.kind).toBe('shown');
    expect(codes(checked)).toEqual(['raw-html@9']);
  });
});

/** More entries than a commit may hold. */
function figuresPast(): TreeEntry[] {
  return figures(LIMITS.entries + 1, MIB);
}
