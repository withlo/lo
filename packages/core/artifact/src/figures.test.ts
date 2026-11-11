import { describe, expect, test } from 'vitest';

import {
  APP0,
  extension,
  frame,
  gif,
  jpeg,
  join,
  png,
  segment,
  sof,
  vp8x,
} from '../test/images.ts';
import { overviewFiles, repository, type Paths } from '../test/readers.ts';
import { overview, PREAMBLE_LINES } from '../test/support.ts';
import {
  checkArtifact,
  FIGURE_HEAD,
  LIMITS,
  parseArtifact,
  type CheckedArtifact,
  type CheckOptions,
  type FigureState,
  type FileAnswer,
  type OverviewFiles,
} from './index.ts';

const LINE = PREAMBLE_LINES + 1;
const COMMIT = '3f9c2e1d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e';
const MIB = 1024 * 1024;
const encoder = new TextEncoder();

/** The code the overviews here point at. */
const held: Paths = { 'src/a.ts': 'one\ntwo\nthree\n' };

/** A call the overview's reader was asked, of a figure. */
interface Asked {
  path: string;
  cap: number;
}

/**
 * An overview's commit holding `artifact.md` and `paths`, whose reader keeps what it's asked of
 * figures in `asked`, and answers `read`'s way where it says.
 */
function files(
  text: string,
  paths: Paths,
  read?: (path: string, cap: number, signal: AbortSignal) => unknown,
): OverviewFiles & { asked: Asked[] } {
  const commit = overviewFiles({ 'artifact.md': text, ...paths });
  const asked: Asked[] = [];
  return {
    asked,
    entries: commit.entries,
    read: async (path, cap, signal): Promise<FileAnswer> => {
      if (path !== 'artifact.md') asked.push({ path, cap });
      const answered: unknown = await read?.(path, cap, signal);
      if (answered === undefined) return commit.read(path, cap, signal);
      // Whatever the reader says, as a reader might say it, wrongly.
      const given: FileAnswer = JSON.parse('{}');
      return Object.assign(given, answered);
    },
  };
}

/** `body`, in an overview, checked in a commit that also holds `paths`. */
async function check(
  body: string,
  paths: Paths,
  read?: (path: string, cap: number, signal: AbortSignal) => unknown,
  options: CheckOptions = { pr: 4797 },
): Promise<CheckedArtifact & { asked: Asked[] }> {
  const text = overview(body);
  const commit = files(text, paths, read);
  const { readCode } = repository(COMMIT, held);
  const checked = await checkArtifact(parseArtifact(text), commit, readCode, options);
  return { ...checked, asked: commit.asked };
}

/** A block showing each of `paths`, in order, each four lines long. */
function shown(...paths: string[]): string {
  return paths.map((path) => `:::figure ${path}\nA figure.\n:::\n`).join('\n');
}

/** The findings, as `code@line`. */
function codes(checked: CheckedArtifact): string[] {
  return checked.findings.map(({ code, line }) => (line === undefined ? code : `${code}@${line}`));
}

/** Each figure's state, in order. */
function states(checked: CheckedArtifact): FigureState[] {
  return checked.outcome.kind === 'shown'
    ? checked.outcome.figures.map(({ figure }) => figure)
    : [];
}

/** Each figure's state, as `state` and its type or why. */
function summary(checked: CheckedArtifact): string[] {
  return states(checked).map((figure) =>
    figure.state === 'kept' ? `kept ${figure.type}` : `${figure.state} ${figure.why}`,
  );
}

const SVG = '<svg viewBox="0 0 860 120" xmlns="http://www.w3.org/2000/svg">';

describe('an SVG figure', () => {
  test('is kept as sanitizeSvg makes it, with the parts it can link', async () => {
    const checked = await check(
      ':::figure figures/a.svg\nA box.\n\n- [box](#tldr)\n- [label](code:src/a.ts#L1)\n:::\n',
      {
        'figures/a.svg': `${SVG}<rect id="box" width="10" height="5" fill="var(--fig-panel)"/><text id="label" fill="var(--fig-ink)">A</text></svg>`,
      },
    );
    expect(checked.findings).toEqual([]);
    expect(states(checked)).toEqual([
      {
        state: 'kept',
        type: 'svg',
        svg: {
          kind: 'element',
          name: 'svg',
          attributes: { viewBox: '0 0 860 120' },
          children: [
            {
              kind: 'element',
              name: 'rect',
              attributes: { id: 'box', width: '10', height: '5', fill: 'var(--fig-panel)' },
              children: [],
            },
            {
              kind: 'element',
              name: 'text',
              attributes: { id: 'label', fill: 'var(--fig-ink)' },
              children: [{ kind: 'text', value: 'A' }],
            },
          ],
        },
        parts: ['box', 'label'],
      },
    ]);
  });

  test('with a byte-order mark, a declaration, a doctype and comments, is kept', async () => {
    const svg = `﻿<?xml version="1.0"?>\n<!DOCTYPE svg>\n<!-- Drawn by hand. -->\n${SVG}<rect width="1" height="1"/></svg>\n`;
    const checked = await check(shown('figures/a.svg'), { 'figures/a.svg': svg });
    expect(checked.findings).toEqual([]);
    expect(summary(checked)).toEqual(['kept svg']);
  });

  test('that sanitizeSvg changes is left out, saying what it removed and where', async () => {
    const checked = await check(shown('figures/a.svg', 'figures/b.svg'), {
      'figures/a.svg': `${SVG}\n<script>alert(1)</script>\n<rect width="1" height="1"/></svg>`,
      'figures/b.svg': `${SVG}\n${'<rect width="1" height="1" onclick="alert(1)"/>\n'.repeat(120)}</svg>`,
    });
    expect(codes(checked)).toEqual([`figure-content@${LINE}`, `figure-content@${LINE + 4}`]);
    expect(checked.findings.map(({ message }) => message)).toEqual([
      "figures/a.svg holds what a figure can't, so it's left out: <script> on line 2 (a script). figures.md says what a figure may hold.",
      "figures/b.svg holds what a figure can't, so it's left out: onclick on <rect> on line 2 (a script); onclick on <rect> on line 3 (a script); onclick on <rect> on line 4 (a script); and 97 or more more. figures.md says what a figure may hold.",
    ]);
    expect(summary(checked)).toEqual(['leftOut content', 'leftOut content']);
  });

  test.each([
    [
      'elements',
      `${SVG}${'<rect/>'.repeat(4_100)}</svg>`,
      'has more elements, or attributes, than 4,096',
    ],
    ['depth', `${SVG}${'<g>'.repeat(40)}`, 'nests elements more than 32 deep'],
    [
      'numbers',
      `${SVG}<path d="M${'0 0 '.repeat(33_000)}"/></svg>`,
      'has more numbers than 65,536',
    ],
    [
      'drawn',
      `${SVG}<text>${'x'.repeat(200_000)}</text></svg>`,
      'would draw more than a figure may',
    ],
    ['aspect', '<svg viewBox="0 0 1 9"></svg>', 'is too tall or too wide to lay out'],
  ])('refused whole for its %s, is too large', async (_reason, svg, says) => {
    const checked = await check(shown('figures/a.svg'), { 'figures/a.svg': svg });
    expect(codes(checked)).toEqual([`figure-too-large@${LINE}`]);
    expect(checked.findings[0]?.message).toContain(`figures/a.svg ${says}`);
    expect(summary(checked)).toEqual(['leftOut tooLarge']);
  });

  test.each([
    ['nothing', ''],
    ['text', 'A drawing, in words.'],
    ['HTML', '<!doctype html><p>A page.</p>'],
    ['another root', '<g><rect/></g>'],
  ])('holding %s, is no SVG', async (_what, svg) => {
    const checked = await check(shown('figures/a.svg'), { 'figures/a.svg': svg });
    expect(codes(checked)).toEqual([`figure-type@${LINE}`]);
    expect(checked.findings[0]?.message).toBe(
      "figures/a.svg isn't an SVG: it has no <svg> element at its top.",
    );
  });

  test('not UTF-8, is left out, saying from which line', async () => {
    const svg = join(`${SVG}\n<text>\n`, [0xe9], '</text></svg>');
    const checked = await check(shown('figures/a.svg'), { 'figures/a.svg': svg });
    expect(codes(checked)).toEqual([`figure-encoding@${LINE}`]);
    expect(checked.findings[0]?.message).toBe(
      "figures/a.svg isn't UTF-8 from its line 3 on. Lo reads an SVG only as UTF-8.",
    );
    expect(summary(checked)).toEqual(['leftOut encoding']);
  });

  test('past 512 KiB, is too large, and read no further than its start', async () => {
    const at = `${SVG}${' '.repeat(LIMITS.svg - SVG.length - 6)}</svg>`;
    const past = `${at} `;
    expect(encoder.encode(at).length).toBe(LIMITS.svg);
    const checked = await check(shown('figures/at.svg', 'figures/past.svg'), {
      'figures/at.svg': at,
      'figures/past.svg': past,
    });
    expect(codes(checked)).toEqual([`figure-too-large@${LINE + 4}`]);
    expect(checked.findings[0]?.message).toBe(
      'figures/past.svg is larger than 512 KiB, the most an SVG figure may be.',
    );
    expect(checked.asked).toEqual([
      { path: 'figures/at.svg', cap: FIGURE_HEAD },
      { path: 'figures/at.svg', cap: LIMITS.svg },
      { path: 'figures/past.svg', cap: FIGURE_HEAD },
    ]);
  });

  test('is read whole at once when it fits in the first read', async () => {
    const checked = await check(shown('figures/a.svg'), { 'figures/a.svg': `${SVG}</svg>` });
    expect(checked.asked).toEqual([{ path: 'figures/a.svg', cap: FIGURE_HEAD }]);
  });
});

/** An SVG of `bytes` bytes, drawing nothing. */
function sized(bytes: number): string {
  return `${SVG}${' '.repeat(bytes - SVG.length - 6)}</svg>`;
}

/** A reader that never answers. */
function never(): Promise<never> {
  return new Promise(() => {});
}

describe('the SVGs an overview shows', () => {
  test('are read up to 2 MiB together, in the order first shown', async () => {
    const big = sized(500 * 1024);
    const paths = ['a', 'b', 'c', 'd', 'e'].map((name) => `figures/${name}.svg`);
    // Shown last first, then in order, so the order they're first shown in decides.
    const checked = await check(
      shown(paths[4]!, ...paths),
      Object.fromEntries(paths.map((path) => [path, big])),
    );
    expect(summary(checked)).toEqual([
      'kept svg',
      'kept svg',
      'kept svg',
      'kept svg',
      'leftOut tooLarge',
      'kept svg',
    ]);
    expect(codes(checked)).toEqual([`figure-too-large@${LINE + 16}`]);
    expect(checked.findings[0]?.message).toBe(
      "figures/d.svg is past what's left of the 2 MiB of SVG Lo reads for an overview's figures, which the SVGs shown before it take up.",
    );
    // What's past the room isn't read past its start.
    expect(checked.asked.filter(({ path }) => path === 'figures/d.svg')).toEqual([
      { path: 'figures/d.svg', cap: FIGURE_HEAD },
    ]);
  });

  test('count each file once, however many blocks show it, and exactly to the limit', async () => {
    const quarter = sized(LIMITS.svgs / 4);
    const paths = ['a', 'b', 'c', 'd'].map((name) => `figures/${name}.svg`);
    const checked = await check(
      shown(...paths, ...paths, ...paths),
      Object.fromEntries(paths.map((path) => [path, quarter])),
    );
    expect(checked.findings).toEqual([]);
    expect(summary(checked)).toEqual(Array.from({ length: 12 }, () => 'kept svg'));
    expect(checked.asked).toHaveLength(8);
  });

  test('don’t count images, or what’s left out before being read whole', async () => {
    const paths = ['a', 'b', 'c', 'd'].map((name) => `figures/${name}.svg`);
    const checked = await check(shown('figures/shot.png', 'figures/huge.svg', ...paths), {
      'figures/shot.png': join(png(1, 1), new Uint8Array(3 * MIB)),
      'figures/huge.svg': sized(LIMITS.svg + 1),
      ...Object.fromEntries(paths.map((path) => [path, sized(LIMITS.svg)])),
    });
    expect(summary(checked)).toEqual([
      'kept png',
      'leftOut tooLarge',
      'kept svg',
      'kept svg',
      'kept svg',
      'kept svg',
    ]);
  });
});

describe('an SVG figure’s colors', () => {
  test('other than Lo’s are a warning, naming the first few', async () => {
    const checked = await check(shown('figures/a.svg', 'figures/b.svg', 'figures/c.svg'), {
      'figures/a.svg': `${SVG}<rect fill="#E11D48" stroke="rgb(1, 2, 3)"/><g color="red"><text fill="Black">A</text></g></svg>`,
      'figures/b.svg': `${SVG}<rect fill="none" stroke="currentColor" color="var(--fig-ink)"/><path stroke="transparent"/><marker id="m"><path fill="var(--fig-red-soft)"/></marker></svg>`,
      'figures/c.svg': `${SVG}<marker id="m"><path fill="#123"/></marker></svg>`,
    });
    expect(codes(checked)).toEqual([`figure-color@${LINE}`, `figure-color@${LINE + 8}`]);
    expect(checked.findings.map(({ severity, message }) => `${severity}: ${message}`)).toEqual([
      "warning: figures/a.svg draws in #e11d48, rgb(1,2,3), red and others, which won't follow the reader's theme. Draw in Lo's colors, var(--fig-*).",
      "warning: figures/c.svg draws in #123, which won't follow the reader's theme. Draw in Lo's colors, var(--fig-*).",
    ]);
    expect(summary(checked)).toEqual(['kept svg', 'kept svg', 'kept svg']);
  });
});

describe('an SVG figure’s parts', () => {
  const svg = `${SVG}
<defs><marker id="arrow"><path id="tip" d="M0 0L1 1"/></marker><title>Defined</title></defs>
<g id="group"><rect id="box"/></g>
<text id="label">The <tspan id="span">limiter</tspan></text>
<circle id="dot"/><ellipse id="oval"/><line id="edge"/><polyline id="trail"/><polygon id="area"/><path id="route"/>
</svg>`;

  test('name a shape, a group or a text in their own figure', async () => {
    const ids = ['group', 'box', 'label', 'dot', 'oval', 'edge', 'trail', 'area', 'route'];
    const list = ids.map((id) => `- [${id}](#tldr)\n`).join('');
    const checked = await check(`:::figure figures/a.svg\nParts.\n\n${list}:::\n`, {
      'figures/a.svg': svg,
    });
    expect(checked.findings).toEqual([]);
    expect(states(checked)[0]).toMatchObject({ state: 'kept', parts: ids });
  });

  test.each([
    [
      'the figure itself',
      '<svg id="all" viewBox="0 0 1 1"><rect/></svg>',
      'all',
      'the figure itself',
    ],
    ['its definitions', '<svg><defs id="defs"/></svg>', 'defs', "the figure's definitions"],
    ['a marker', '<svg><marker id="m"><path/></marker></svg>', 'm', 'a marker'],
    [
      'what a marker draws',
      '<svg><marker id="m"><g><path id="p"/></g></marker></svg>',
      'p',
      'inside a marker',
    ],
    [
      'a span inside text',
      '<svg><text>A <tspan id="s">b</tspan></text></svg>',
      's',
      'a span inside text',
    ],
  ])('can’t be %s', async (_label, figure, id, what) => {
    const checked = await check(`:::figure figures/a.svg\nParts.\n\n- [${id}](#tldr)\n:::\n`, {
      'figures/a.svg': figure,
    });
    expect(codes(checked)).toEqual([`figure-part-missing@${LINE + 3}`]);
    expect(checked.findings[0]?.message).toBe(
      `The part "${id}" is ${what} in figures/a.svg, which Lo can't link. Link a shape, a group or a text.`,
    );
    expect(states(checked)[0]).toMatchObject({ state: 'kept', parts: [] });
  });

  test('missing, in another case, in another figure or named twice, name nothing', async () => {
    const checked = await check(
      [
        ':::figure figures/a.svg\nA.\n\n- [box](#tldr)\n:::\n',
        ':::figure figures/b.svg\nB.\n\n- [box](#tldr)\n- [Dot](#tldr)\n- [none](#tldr)\n:::\n',
        ':::figure figures/c.svg\nC.\n\n- [twice](#tldr)\n:::\n',
      ].join('\n'),
      {
        'figures/a.svg': `${SVG}<rect id="box"/></svg>`,
        'figures/b.svg': `${SVG}<circle id="dot"/></svg>`,
        'figures/c.svg': `${SVG}<rect id="twice"/><rect id="twice"/></svg>`,
      },
    );
    expect(codes(checked)).toEqual([
      `figure-part-missing@${LINE + 9}`,
      `figure-part-missing@${LINE + 10}`,
      `figure-part-missing@${LINE + 11}`,
      `figure-content@${LINE + 14}`,
      `figure-part-missing@${LINE + 17}`,
    ]);
    expect(checked.findings[0]?.message).toBe(
      'The part "box" isn\'t an id in figures/b.svg. Give the element it means that id.',
    );
    expect(
      states(checked).map((figure) =>
        figure.state === 'kept' && figure.type === 'svg' ? figure.parts : figure,
      ),
    ).toEqual([['box'], [], { state: 'leftOut', why: 'content' }]);
  });

  test('of the same figure shown twice are each block’s own', async () => {
    const checked = await check(
      ':::figure figures/a.svg\nA.\n\n- [box](#tldr)\n:::\n\n:::figure figures/a.svg\nA.\n\n- [dot](#tldr)\n:::\n',
      { 'figures/a.svg': `${SVG}<rect id="box"/><circle id="dot"/></svg>` },
    );
    expect(checked.findings).toEqual([]);
    expect(
      states(checked).map(
        (figure) => figure.state === 'kept' && figure.type === 'svg' && figure.parts,
      ),
    ).toEqual([['box'], ['dot']]);
    expect(checked.asked).toHaveLength(1);
  });

  test('aren’t looked for in a figure that isn’t an SVG', async () => {
    const checked = await check(':::figure figures/a.svg\nA.\n\n- [box](#tldr)\n:::\n', {
      'figures/a.svg': png(1, 1),
    });
    expect(codes(checked)).toEqual([`figure-type@${LINE}`]);
  });
});

describe('an image figure', () => {
  test.each([
    ['png', 'png', png(320, 180)],
    ['jpg', 'jpeg', jpeg(APP0, sof(640, 480))],
    ['jpeg', 'jpeg', jpeg(sof(1, 2))],
    ['gif', 'gif', gif(24, 12, [frame(0, 0, 24, 12)])],
    ['webp', 'webp', vp8x(800, 600)],
  ])('named .%s, is kept with its size, reading only its start', async (ending, type, bytes) => {
    const path = `figures/a.${ending}`;
    const checked = await check(shown(path), { [path]: join(bytes, new Uint8Array(MIB)) });
    expect(checked.findings).toEqual([]);
    expect(states(checked)).toMatchObject([{ state: 'kept', type }]);
    expect(checked.asked).toEqual([{ path, cap: FIGURE_HEAD }]);
  });

  test('whose header goes on past its start, is read whole', async () => {
    const photo = join(
      jpeg(APP0, segment(0xe1, new Uint8Array(20_000)), sof(30, 20)),
      new Uint8Array(MIB),
    );
    const loop = gif(5, 6, [extension(0xfe, new Uint8Array(20_000)), frame(0, 0, 5, 6)]);
    const checked = await check(shown('figures/a.jpg', 'figures/b.gif'), {
      'figures/a.jpg': photo,
      'figures/b.gif': loop,
    });
    expect(checked.findings).toEqual([]);
    expect(states(checked)).toEqual([
      { state: 'kept', type: 'jpeg', width: 30, height: 20 },
      { state: 'kept', type: 'gif', width: 5, height: 6 },
    ]);
    expect(checked.asked.map(({ cap }) => cap)).toEqual([
      FIGURE_HEAD,
      photo.length,
      FIGURE_HEAD,
      loop.length,
    ]);
  });

  test('is at most 16,384 pixels a side and 40 megapixels', async () => {
    const checked = await check(
      shown(
        'figures/side.png',
        'figures/area.png',
        'figures/wide.png',
        'figures/tall.gif',
        'figures/more.png',
      ),
      {
        'figures/side.png': png(16_384, 16_384 / 8),
        'figures/area.png': png(16_384, 2_441),
        'figures/wide.png': png(16_385, 1),
        'figures/tall.gif': gif(1, 16_385, [frame(0, 0, 1, 1)]),
        'figures/more.png': png(16_384, 2_442),
      },
    );
    expect(summary(checked)).toEqual([
      'kept png',
      'kept png',
      'leftOut tooLarge',
      'leftOut tooLarge',
      'leftOut tooLarge',
    ]);
    expect(checked.findings.map(({ message }) => message)).toEqual([
      'figures/wide.png is 16,385 by 1 pixels, and an image figure is at most 16,384 a side and 40 megapixels.',
      'figures/tall.gif is 1 by 16,385 pixels, and an image figure is at most 16,384 a side and 40 megapixels.',
      'figures/more.png is 16,384 by 2,442 pixels, and an image figure is at most 16,384 a side and 40 megapixels.',
    ]);
  });

  test('is at most 10 MiB, and past it, is read no further than its start', async () => {
    const checked = await check(shown('figures/at.png', 'figures/past.jpg'), {
      'figures/at.png': join(png(1, 1), new Uint8Array(LIMITS.image - png(1, 1).length)),
      'figures/past.jpg': join(
        jpeg(segment(0xe1, new Uint8Array(20_000)), sof(1, 1)),
        new Uint8Array(LIMITS.image),
      ),
    });
    expect(summary(checked)).toEqual(['kept png', 'leftOut tooLarge']);
    expect(checked.findings[0]?.message).toBe(
      'figures/past.jpg is larger than 10 MiB, the most an image figure may be.',
    );
    expect(checked.asked).toEqual([
      { path: 'figures/at.png', cap: FIGURE_HEAD },
      { path: 'figures/past.jpg', cap: FIGURE_HEAD },
    ]);
  });

  test('whose header is damaged or cut short, is left out', async () => {
    const checked = await check(shown('figures/a.png', 'figures/b.gif'), {
      'figures/a.png': png(1, 1).subarray(0, 30),
      'figures/b.gif': gif(1, 1, []),
    });
    expect(codes(checked)).toEqual([`figure-header@${LINE}`, `figure-header@${LINE + 4}`]);
    expect(checked.findings.map(({ message }) => message)).toEqual([
      "figures/a.png ends before its header does, so Lo can't tell its size.",
      "figures/b.gif has no frames, so Lo can't tell its size.",
    ]);
    expect(summary(checked)).toEqual(['leftOut header', 'leftOut header']);
  });
});

describe('a figure’s type', () => {
  const bytes = {
    svg: encoder.encode(`${SVG}</svg>`),
    png: png(1, 1),
    jpeg: jpeg(sof(1, 1)),
    gif: gif(1, 1, [frame(0, 0, 1, 1)]),
    webp: vp8x(1, 1),
  } as const;
  const names = { svg: 'an SVG', png: 'a PNG', jpeg: 'a JPEG', gif: 'a GIF', webp: 'a WebP' };
  const endings = { svg: '.svg', png: '.png', jpeg: '.jpg or .jpeg', gif: '.gif', webp: '.webp' };
  const named = ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'] as const;
  const types = ['svg', 'png', 'jpeg', 'gif', 'webp'] as const;
  const cases = named.flatMap((ending) => types.map((is) => [ending, is] as const));

  test.each(cases)('named .%s, holding %s, is read from its bytes', async (ending, is) => {
    const path = `figures/a.${ending}`;
    const checked = await check(shown(path), { [path]: bytes[is] });
    const type = ending === 'jpg' ? 'jpeg' : ending;
    const message =
      is === 'svg'
        ? `${path} isn't ${names[type]}: Lo reads a figure's type from its first bytes, and these aren't ${names[type]}'s.`
        : `${path} is ${names[is]}, not ${names[type]}. Name it with ${endings[is]}.`;
    expect({
      findings: checked.findings.map(({ message: said }) => said),
      figures: summary(checked),
    }).toEqual(
      type === is
        ? { findings: [], figures: [`kept ${is}`] }
        : { findings: [message], figures: ['leftOut type'] },
    );
    expect(codes(checked)).toEqual(type === is ? [] : [`figure-type@${LINE}`]);
  });
});

describe('reading figures', () => {
  test('each is read once, however many blocks show it, in the order first shown', async () => {
    const checked = await check(
      shown('figures/b.png', 'figures/a.svg', 'figures/b.png', 'figures/a.svg'),
      { 'figures/a.svg': `${SVG}</svg>`, 'figures/b.png': png(2, 3) },
    );
    expect(checked.asked.map(({ path }) => path)).toEqual(['figures/b.png', 'figures/a.svg']);
    expect(summary(checked)).toEqual(['kept png', 'kept svg', 'kept png', 'kept svg']);
  });

  test('of a file not there, or not a file, is never asked', async () => {
    const text = overview(shown('figures/a.svg', 'figures/b.svg'));
    const commit = files(text, {});
    commit.entries = [
      ...commit.entries,
      { path: encoder.encode('figures/b.svg'), kind: 'link', size: 10 },
    ];
    const checked = await checkArtifact(
      parseArtifact(text),
      commit,
      repository(COMMIT, held).readCode,
    );
    expect(codes(checked)).toEqual([
      'tree-extra',
      `figure-missing@${LINE}`,
      `figure-not-file@${LINE + 4}`,
    ]);
    expect(summary(checked)).toEqual(['leftOut missing', 'leftOut notFile']);
    expect(commit.asked).toEqual([]);
  });

  test.each([
    [
      'throws',
      () => {
        throw new Error('no');
      },
    ],
    ['rejects', () => Promise.reject(new Error('no'))],
    ['answers nothing a reader answers', () => ({ kind: 'file' })],
    ['says the file is missing', () => ({ kind: 'missing' })],
    ['says the file is a link', () => ({ kind: 'notFile', is: 'link' })],
    ['says the commit is gone', () => ({ kind: 'noCommit' })],
    [
      'gives more bytes than it may',
      (_path: string, cap: number) => ({
        kind: 'file',
        size: cap + 2,
        bytes: new Uint8Array(cap + 1),
      }),
    ],
    ['gives a size that isn’t one', () => ({ kind: 'file', size: -1, bytes: new Uint8Array() })],
  ])('left unread when the reader %s, with no finding', async (_what, read) => {
    const checked = await check(
      shown('figures/a.svg', 'figures/b.png'),
      { 'figures/a.svg': `${SVG}</svg>`, 'figures/b.png': png(1, 1) },
      read,
    );
    expect(checked.findings).toEqual([]);
    expect(summary(checked)).toEqual(['unread failed', 'unread failed']);
  });

  test('left unread when the second read answers differently from the first', async () => {
    const svg = `${SVG}${' '.repeat(10_000)}</svg>`;
    const checked = await check(shown('figures/a.svg'), { 'figures/a.svg': svg }, (_path, cap) =>
      cap === FIGURE_HEAD ? undefined : { kind: 'file', size: cap + 1, bytes: new Uint8Array(cap) },
    );
    expect(summary(checked)).toEqual(['unread failed']);
    expect(checked.asked).toHaveLength(2);
  });

  test('left unread, with the rest, when the time is up or the caller stops', async () => {
    const timed = await check(
      shown('figures/a.svg', 'figures/b.svg'),
      { 'figures/a.svg': `${SVG}</svg>`, 'figures/b.svg': `${SVG}</svg>` },
      never,
      { timeout: 20 },
    );
    expect(timed.findings).toEqual([]);
    expect(summary(timed)).toEqual(['unread stopped', 'unread stopped']);

    const stop = new AbortController();
    stop.abort();
    const stopped = await check(
      shown('figures/a.svg'),
      { 'figures/a.svg': `${SVG}</svg>` },
      undefined,
      { signal: stop.signal },
    );
    expect(summary(stopped)).toEqual(['unread stopped']);
    expect(stopped.asked).toEqual([]);
  });

  test('of an invalid overview, still finds what’s wrong with its figures', async () => {
    const checked = await check(`${shown('figures/a.svg')}\n# A title\n`, {
      'figures/a.svg': png(1, 1),
    });
    expect(checked.outcome).toEqual({ kind: 'invalid' });
    expect(codes(checked)).toEqual([`figure-type@${LINE}`, `title-heading@${LINE + 4}`]);
  });
});
