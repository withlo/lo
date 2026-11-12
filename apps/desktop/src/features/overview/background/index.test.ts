// The overview's jobs: the parse says what main reads for the checks, and the check reads
// `artifact.md` again and answers its readers only from what main read, leaving the rest unread.

import { BINARY_WINDOW, FIGURE_HEAD as CHECKS_FIGURE_HEAD, LIMITS, SIZE_ONLY } from '@lo/artifact';
import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_BYTES,
  contract,
  ENTRIES_LIMIT,
  FIGURE_HEAD,
  FIGURES_LIMIT,
  FILE_BYTES,
  SVG_BYTES,
  type CheckInput,
} from '../jobs.ts';
import { CODE_LIMIT, PATH_LIMIT, type Entry } from '../contract.ts';
import { jpeg } from '../test/images.ts';
import { runJob } from '../test/jobs.ts';
import { checkOverview, parseOverview } from './index.ts';

const COMMIT = 'a'.repeat(40);
const encoder = new TextEncoder();

/** An overview's text, with `body` after its header. */
function artifactOf(body: string): Uint8Array {
  return encoder.encode(
    `---\nformat: 1\npr: 7\ncommit: ${COMMIT}\n---\n\n## tl;dr\n\nIt reads.\n\n${body}`,
  );
}

/** The overview's commit: `artifact.md`, and `figures`, by path and size. */
function entriesOf(artifact: Uint8Array, figures: Record<string, number> = {}): Entry[] {
  return [
    { path: 'artifact.md', kind: 'file', size: artifact.length, id: 'b'.repeat(40) },
    ...Object.entries(figures).map(([path, size]): Entry => ({
      path,
      kind: 'file',
      size,
      id: 'c'.repeat(40),
    })),
  ];
}

/** `overview.check`'s input for `artifact`, with what main read of its code and figures. */
function inputOf(artifact: Uint8Array, rest: Partial<CheckInput> = {}): CheckInput {
  return { artifact, entries: entriesOf(artifact), pr: 7, figures: [], code: null, ...rest };
}

const LINES = encoder.encode('one\ntwo\nthree\n');

/** Whether `overview.check` takes `value`. */
function parse(value: unknown): boolean {
  return contract.jobs.check.input.safeParse(value).success;
}

describe('the limits the jobs take things to', () => {
  it('are the checks’ own', () => {
    expect(ARTIFACT_BYTES).toBe(LIMITS.size + 3);
    expect(FILE_BYTES).toBe(SIZE_ONLY);
    expect(FIGURES_LIMIT).toBe(LIMITS.figures);
    expect(ENTRIES_LIMIT).toBe(LIMITS.entries + 2);
    expect(CODE_LIMIT).toBe(LIMITS.targets);
    expect(PATH_LIMIT).toBe(LIMITS.argument);
    expect(FIGURE_HEAD).toBe(CHECKS_FIGURE_HEAD);
    expect(SVG_BYTES).toBe(LIMITS.svg);
  });
});

describe('overview.parse', () => {
  it('says what main reads: each file once, in the order first named, and each figure once', () => {
    const { parsed, code, figures } = parseOverview(
      artifactOf(
        [
          'See [the file](code:src/b.ts).',
          '',
          ':::code src/a.ts#L1-L2',
          ':::',
          '',
          ':::code src/b.ts#L2',
          ':::',
          '',
          ':::figure figures/flow.svg',
          'The flow.',
          ':::',
          '',
          ':::figure figures/flow.svg',
          'Again.',
          ':::',
          '',
        ].join('\n'),
      ),
    );
    expect(parsed.header?.commit).toBe(COMMIT);
    expect(code).toEqual([
      { path: 'src/b.ts', lines: true },
      { path: 'src/a.ts', lines: true },
    ]);
    expect(figures).toEqual(['figures/flow.svg']);
  });

  it('reads no figure past the limit on them', () => {
    const body = Array.from(
      { length: LIMITS.figures + 5 },
      (_, n) => `:::figure figures/f${n}.svg\nFigure ${n}.\n:::\n`,
    ).join('\n');
    expect(parseOverview(artifactOf(body)).figures).toHaveLength(LIMITS.figures);
  });

  it('takes bytes, and refuses more than the checks read', async () => {
    const reply = await runJob('overview.parse', { artifact: artifactOf('') });
    expect(reply).toMatchObject({ parsed: { header: { pr: 7 } } });
    await expect(
      runJob('overview.parse', { artifact: new Uint8Array(ARTIFACT_BYTES + 1) }),
    ).rejects.toThrow('invalid');
    await expect(runJob('overview.parse', { artifact: 'text' })).rejects.toThrow('invalid');
  });
});

describe('overview.check', () => {
  const block = ':::code src/a.ts#L2-L3\n:::\n';

  it('checks the code main read, at the commit it read it at', async () => {
    const artifact = artifactOf(block);
    const read = { kind: 'file' as const, size: LINES.length, bytes: LINES };
    const checked = await checkOverview(
      inputOf(artifact, { code: { commit: COMMIT, files: [{ path: 'src/a.ts', answer: read }] } }),
    );
    expect(checked.outcome).toMatchObject({
      kind: 'shown',
      code: [{ code: { state: 'resolved' } }],
    });

    // Read at another commit, it isn't the overview's code.
    const elsewhere = await checkOverview(
      inputOf(artifact, {
        code: { commit: 'f'.repeat(40), files: [{ path: 'src/a.ts', answer: read }] },
      }),
    );
    expect(elsewhere.outcome).toMatchObject({
      kind: 'shown',
      code: [{ code: { state: 'unread' } }],
    });
  });

  it('leaves code unread before main has read it, or where it read less than the check reads', async () => {
    const artifact = artifactOf(block);
    const none = await checkOverview(inputOf(artifact));
    expect(none.outcome).toMatchObject({ kind: 'shown', code: [{ code: { state: 'unread' } }] });
    expect(none.findings).toEqual([]);

    // Only its start, of a file the check reads whole.
    const long = encoder.encode('line\n'.repeat(BINARY_WINDOW));
    const start = await checkOverview(
      inputOf(artifact, {
        code: {
          commit: COMMIT,
          files: [
            {
              path: 'src/a.ts',
              answer: { kind: 'file', size: long.length, bytes: long.subarray(0, BINARY_WINDOW) },
            },
          ],
        },
      }),
    );
    expect(start.outcome).toMatchObject({ kind: 'shown', code: [{ code: { state: 'unread' } }] });
  });

  it('judges a file past what the checks read by the size main gave', async () => {
    const checked = await checkOverview(
      inputOf(artifactOf(block), {
        code: {
          commit: COMMIT,
          files: [
            {
              path: 'src/a.ts',
              answer: { kind: 'file', size: SIZE_ONLY + 1, bytes: new Uint8Array() },
            },
          ],
        },
      }),
    );
    expect(checked.outcome).toMatchObject({
      kind: 'shown',
      code: [{ code: { state: 'broken', why: 'tooLarge' } }],
    });
  });

  it('judges a file whose download main stopped past what the checks read too large', async () => {
    const checked = await checkOverview(
      inputOf(artifactOf(block), {
        code: { commit: COMMIT, files: [{ path: 'src/a.ts', answer: { kind: 'tooLarge' } }] },
      }),
    );
    expect(checked.outcome).toMatchObject({
      kind: 'shown',
      code: [{ code: { state: 'broken', why: 'tooLarge' } }],
    });
    expect(checked.findings.map(({ code }) => code)).toEqual(['code-too-large']);
  });

  it('reads all of an image whose header goes on past its start, when main sent it', async () => {
    const photo = jpeg(30, 20, { before: 20_000, after: 1024 });
    const artifact = artifactOf(':::figure figures/a.jpg\nA photo.\n:::\n');
    const input = (bytes: Uint8Array) =>
      inputOf(artifact, {
        entries: entriesOf(artifact, { 'figures/a.jpg': photo.length }),
        figures: [{ path: 'figures/a.jpg', file: { kind: 'file', size: photo.length, bytes } }],
      });
    expect((await checkOverview(input(photo))).outcome).toMatchObject({
      kind: 'shown',
      figures: [{ figure: { state: 'kept', type: 'jpeg', width: 30, height: 20 } }],
    });
    // Sent its start alone, it's left unread, for the window to send all of it.
    expect((await checkOverview(input(photo.slice(0, FIGURE_HEAD)))).outcome).toMatchObject({
      kind: 'shown',
      figures: [{ figure: { state: 'unread', why: 'failed' } }],
    });
  });

  it('reads figures from what main read, and leaves one it couldn’t read unread', async () => {
    const svg = encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>');
    const artifact = artifactOf(
      ':::figure figures/a.svg\nA.\n:::\n\n:::figure figures/b.svg\nB.\n:::\n',
    );
    const checked = await checkOverview(
      inputOf(artifact, {
        entries: entriesOf(artifact, { 'figures/a.svg': svg.length, 'figures/b.svg': 9 }),
        figures: [
          { path: 'figures/a.svg', file: { kind: 'file', size: svg.length, bytes: svg } },
          { path: 'figures/b.svg', file: { kind: 'unread', why: 'GitHub was out of reach.' } },
        ],
      }),
    );
    expect(checked.outcome).toMatchObject({
      kind: 'shown',
      figures: [
        { figure: { state: 'kept', type: 'svg' } },
        { figure: { state: 'unread', why: 'failed' } },
      ],
    });
  });

  it('reads `artifact.md` itself, from the bytes main read', async () => {
    const checked = await runJob(
      'overview.check',
      inputOf(encoder.encode('## tl;dr\n\nNo header.\n')),
    );
    expect(checked).toMatchObject({ outcome: { kind: 'invalid' } });
  });

  it('takes nothing past what main reads', () => {
    const input = inputOf(artifactOf(''));
    expect(parse(input)).toBe(true);
    expect(
      parse({
        ...input,
        figures: Array.from({ length: FIGURES_LIMIT + 1 }, () => ({
          path: 'figures/a.png',
          file: { kind: 'missing' },
        })),
      }),
    ).toBe(false);
    expect(
      parse({
        ...input,
        code: {
          commit: COMMIT,
          files: [
            { path: 'a', answer: { kind: 'file', size: 1, bytes: new Uint8Array(FILE_BYTES + 1) } },
          ],
        },
      }),
    ).toBe(false);
    // A parse isn't something the check takes.
    expect(parse({ ...input, parsed: {} })).toBe(false);
  });
});
