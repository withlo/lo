/**
 * Figures written to get past the checks: every SVG `sanitizeSvg` is tested against, each shown as
 * an overview's figure, and images whose headers lie. Each is left out with an error unless it's
 * exactly what it says, and each is checked within budget.
 */

import { readdirSync, readFileSync } from 'node:fs';

import { sanitizeSvg } from '@lo/markdown';
import { describe, expect, test } from 'vitest';

import {
  checkArtifact,
  FIGURE_HEAD,
  LIMITS,
  parseArtifact,
  type CheckedArtifact,
  type FigureState,
  type FileAnswer,
  type OverviewFiles,
} from '../src/index.ts';
import { APP0, extension, frame, gif, jpeg, join, png, segment, sof, vp8x } from './images.ts';
import { overviewFiles, repository } from './readers.ts';
import { COMMIT, overview, PREAMBLE_LINES } from './support.ts';

const LINE = PREAMBLE_LINES + 1;
const encoder = new TextEncoder();

/** `sanitizeSvg`'s hostile figures, which this package reads but doesn't own. */
const HOSTILE = new URL('../../../../testing/fixtures/markdown/hostile/', import.meta.url);

/**
 * How long checking any one may take, in milliseconds. Each takes under 100 ms on a laptop; a CI
 * runner is some five times slower, and three times that is the margin.
 */
const BUDGET = 1_500;

/** `figure`, at `path`, shown in an overview and checked within budget, and what was read. */
async function shownAlone(
  path: string,
  figure: Uint8Array | string,
): Promise<{ checked: CheckedArtifact; figure: FigureState; caps: number[] }> {
  const text = overview(`:::figure ${path}\nA figure.\n:::\n`);
  const commit = overviewFiles({ 'artifact.md': text, [path]: figure });
  const caps: number[] = [];
  const files: OverviewFiles = {
    entries: commit.entries,
    read: (at, cap, signal) => {
      if (at === path) caps.push(cap);
      return commit.read(at, cap, signal);
    },
  };
  const started = performance.now();
  const checked = await checkArtifact(parseArtifact(text), files, repository(COMMIT, {}).readCode);
  const elapsed = performance.now() - started;
  expect(elapsed, `took ${elapsed} ms`).toBeLessThan(BUDGET);
  if (checked.outcome.kind !== 'shown') throw new Error(`${path} wasn't shown`);
  for (const { message } of checked.findings) {
    expect(message).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u);
  }
  return { checked, figure: checked.outcome.figures[0]!.figure, caps };
}

/** The errors, as `code@line`. */
function errors(checked: CheckedArtifact): string[] {
  return checked.findings
    .filter(({ severity }) => severity === 'error')
    .map(({ code, line }) => `${code}@${line}`);
}

describe('sanitizeSvg’s hostile figures', () => {
  const files = readdirSync(HOSTILE).filter((name) => name.endsWith('.svg'));

  test('there are some', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  test.each(files)('%s is left out, with an error', async (name) => {
    const { checked, figure } = await shownAlone(
      'figures/a.svg',
      readFileSync(new URL(name, HOSTILE)),
    );
    expect(figure).toEqual({ state: 'leftOut', why: 'content' });
    expect(errors(checked)).toEqual([`figure-content@${LINE}`]);
  });

  /** One of `generated-svg.json`'s inputs: its name, its parts and why it's refused whole. */
  interface Generated {
    name: string;
    parts: [string, number][];
    refused?: string;
  }

  const generated: Generated[] = JSON.parse(
    readFileSync(new URL('generated-svg.json', HOSTILE), 'utf8'),
  ).inputs;

  function textOf({ parts }: Generated): string {
    return parts
      .map(([part, times]) =>
        part.includes('{i}')
          ? Array.from({ length: times }, (_, i) => part.replaceAll('{i}', String(i))).join('')
          : part.repeat(times),
      )
      .join('');
  }

  test('there are generated ones too', () => {
    expect(generated.length).toBeGreaterThanOrEqual(20);
  });

  test.each(generated.map((input) => [input.name, input] as const))(
    '%s is kept only as sanitizeSvg keeps it whole',
    async (_name, input) => {
      const bytes = encoder.encode(textOf(input));
      const { checked, figure, caps } = await shownAlone('figures/a.svg', bytes);
      // Past the limit, it's read no further than its start. Within it, it's read as UTF-8, where
      // a lone surrogate was written as U+FFFD, and kept only when nothing was removed.
      const past = bytes.length > LIMITS.svg;
      const made = past ? undefined : sanitizeSvg(new TextDecoder().decode(bytes));
      const whole = made?.svg !== undefined && made.removed.length === 0;
      expect(caps).toEqual(
        past || bytes.length <= FIGURE_HEAD ? [FIGURE_HEAD] : [FIGURE_HEAD, bytes.length],
      );
      expect(figure).toEqual(
        whole
          ? { state: 'kept', type: 'svg', svg: made.svg, parts: [] }
          : { state: 'leftOut', why: past || made?.svg === undefined ? 'tooLarge' : 'content' },
      );
      expect(errors(checked)).toHaveLength(whole ? 0 : 1);
      // Whatever sanitizeSvg refuses whole is left out.
      expect(input.refused === undefined || !whole).toBe(true);
    },
  );
});

describe('images whose headers lie', () => {
  const html = '<!doctype html><html><script>alert(document.cookie)</script></html>';

  test.each([
    ['a PNG of 65,535 by 65,535', 'a.png', png(65_535, 65_535)],
    ['a PNG of 100,000 a side', 'a.png', png(100_000, 100_000)],
    [
      'a GIF whose first frame is far larger than its screen',
      'a.gif',
      gif(1, 1, [frame(0, 0, 65_535, 65_535)]),
    ],
    [
      'a GIF whose first frame, past its start, is far larger than its screen',
      'a.gif',
      gif(1, 1, [extension(0xfe, new Uint8Array(10_000)), frame(65_000, 0, 1, 1)]),
    ],
    ['a JPEG of 65,500 by 65,500', 'a.jpg', jpeg(APP0, sof(65_500, 65_500))],
    [
      'a JPEG whose size, past its start, is 65,500 by 65,500',
      'a.jpg',
      jpeg(APP0, segment(0xe1, new Uint8Array(60_000)), sof(65_500, 65_500)),
    ],
    ['a WebP of 16,777,216 a side', 'a.webp', vp8x(16_777_216, 16_777_216)],
  ])('%s is too large', async (_what, name, bytes) => {
    const { checked, figure } = await shownAlone(`figures/${name}`, bytes);
    expect(figure).toEqual({ state: 'leftOut', why: 'tooLarge' });
    expect(errors(checked)).toEqual([`figure-too-large@${LINE}`]);
  });

  test('a PNG cut short anywhere is left out, and never taken for another type', async () => {
    const whole = png(10, 10);
    for (let length = 0; length < 33; length++) {
      const { figure } = await shownAlone('figures/a.png', whole.subarray(0, length));
      expect(figure, `${length} bytes`).toEqual({
        state: 'leftOut',
        why: length < 8 ? 'type' : 'header',
      });
    }
  });

  test('a PNG’s signature followed by HTML is left out', async () => {
    const { checked, figure } = await shownAlone(
      'figures/a.png',
      join(png(1, 1).subarray(0, 8), html),
    );
    expect(figure).toEqual({ state: 'leftOut', why: 'header' });
    expect(errors(checked)).toEqual([`figure-header@${LINE}`]);
  });

  test('a PNG’s whole header followed by HTML is only ever a PNG of its size', async () => {
    const { checked, figure, caps } = await shownAlone(
      'figures/a.png',
      join(png(1, 1).subarray(0, 33), html),
    );
    expect(checked.findings).toEqual([]);
    expect(figure).toEqual({ state: 'kept', type: 'png', width: 1, height: 1 });
    expect(caps).toEqual([FIGURE_HEAD]);
  });

  test.each([
    ['HTML named .svg', 'a.svg', html, 'type'],
    ['HTML named .png', 'a.png', html, 'type'],
    [
      'an SVG named .gif',
      'a.gif',
      '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
      'type',
    ],
    ['a PNG named .svg', 'a.svg', png(1, 1), 'type'],
    ['a GIF that starts with an SVG', 'a.svg', join('GIF89a', '<svg onload="alert(1)"/>'), 'type'],
    ['an SVG after a PNG’s header', 'a.svg', join(png(1, 1), '<svg/>'), 'type'],
  ])('%s is left out', async (_what, name, bytes, why) => {
    const { figure } = await shownAlone(`figures/${name}`, bytes);
    expect(figure).toEqual({ state: 'leftOut', why });
  });

  test('an animated GIF of 100,000 frames is read for its header alone', async () => {
    const frames = Array.from({ length: 100_000 }, () => frame(0, 0, 1, 1));
    const bytes = gif(1, 1, frames);
    const { figure, caps } = await shownAlone('figures/a.gif', bytes);
    expect(figure).toEqual({ state: 'kept', type: 'gif', width: 1, height: 1 });
    expect(caps).toEqual([FIGURE_HEAD]);
  });

  test('a file the listing says is a figure, and the reader holds as something else, is unread', async () => {
    const text = overview(':::figure figures/a.png\nA figure.\n:::\n');
    const commit = overviewFiles({ 'artifact.md': text, 'figures/a.png': png(1, 1) });
    const files: OverviewFiles = {
      entries: commit.entries,
      read: async (path, cap, signal): Promise<FileAnswer> =>
        path === 'artifact.md' ? commit.read(path, cap, signal) : { kind: 'notFile', is: 'link' },
    };
    const checked = await checkArtifact(
      parseArtifact(text),
      files,
      repository(COMMIT, {}).readCode,
    );
    expect(checked.outcome).toMatchObject({
      kind: 'shown',
      figures: [{ figure: { state: 'unread', why: 'failed' } }],
    });
  });
});

describe('the costliest figures an overview can hold', () => {
  /**
   * How long checking them may take, in milliseconds: three times the slowest run on a Linux CI
   * runner, some five times a laptop's (about 350 ms).
   */
  const LIMIT = 6_000;

  test('are checked within budget', async () => {
    // SVGs up to the most read together, each of the costliest kind there is to sanitize: a path
    // of hundreds of thousands of closes, with a marker at each.
    const svg = `<svg><marker id="m"><circle r="1"/></marker><path d="M0 0${'z'.repeat(400_000)}" marker-mid="url(#m)"/></svg>`;
    const svgs = Math.floor(LIMITS.svgs / svg.length);
    // Images whose headers go on past their start, each read whole and walked to its size, as
    // many as the commit holds: 4-byte segments, the shortest a JPEG has, before its size.
    const images = LIMITS.figures - svgs;
    const room = LIMITS.commit - LIMITS.svgs - 16 * 1024;
    const segments = Math.floor(room / images / 4) - 8;
    const photo = jpeg(
      new Uint8Array(segments * 4).map((_, at) => [0xff, 0xe0, 0, 2][at % 4]!),
      sof(9, 9),
    );
    const paths: Record<string, Uint8Array | string> = {};
    const blocks: string[] = [];
    for (let n = 0; n < LIMITS.figures; n++) {
      const path = n < svgs ? `figures/f${n}.svg` : `figures/f${n}.jpg`;
      paths[path] = n < svgs ? svg : photo;
      blocks.push(`:::figure ${path}\nFigure ${n}.\n:::\n`);
    }
    const text = overview(blocks.join('\n'));
    const files = overviewFiles({ 'artifact.md': text, ...paths });
    const parsed = parseArtifact(text);
    expect(parsed.findings).toEqual([]);

    const started = performance.now();
    const checked = await checkArtifact(parsed, files, repository(COMMIT, {}).readCode);
    const elapsed = performance.now() - started;
    expect(checked.outcome.kind).toBe('shown');
    const states = checked.outcome.kind === 'shown' ? checked.outcome.figures : [];
    expect(states.filter(({ figure }) => figure.state === 'kept')).toHaveLength(images);
    expect(new Set(checked.findings.map(({ code }) => code))).toEqual(
      new Set(['figure-too-large']),
    );
    expect(elapsed, `took ${elapsed} ms`).toBeLessThan(LIMIT);
  });
});
