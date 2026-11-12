// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FigureState, ImageType } from '@lo/artifact';
import { sanitizeSvg } from '@lo/markdown';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

import {
  bitmap,
  box,
  FakeIntersectionObserver,
  fakeWindow,
  type FakeBitmap,
  type FakeWindow,
} from '../../test/figures.ts';
import { decodes } from './decodes.ts';
import { Figure, type FigureProps } from './Figure.tsx';
import { TALLEST } from './image.ts';
import type { PartLink } from './svg.ts';

// The base is named first: under jsdom, Vite rewrites `new URL('…', import.meta.url)`.
const here = import.meta.url;
const repo = fileURLToPath(new URL('../../../../../', here));
const FIGURES = join(repo, 'testing/fixtures/artifacts/valid/figures/figures');

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let root: Root | undefined;
let host: HTMLElement;
let page: FakeWindow;
/** Each image's decode: a 1 by 1 bitmap, as every image these tests decode is laid out. */
let decode: Mock<(blob: Blob, options: ImageBitmapOptions) => Promise<FakeBitmap>>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  decode = vi.fn<(blob: Blob, options: ImageBitmapOptions) => Promise<FakeBitmap>>(async () =>
    bitmap(1, 1),
  );
  page = fakeWindow(decode);
});

afterEach(async () => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  await decodes.idle();
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect');
  document.body.replaceChildren();
  document.head.replaceChildren();
  page.undo();
});

function render(...figures: FigureProps[]): void {
  root ??= createRoot(host);
  const made = root;
  act(() => {
    made.render(
      <>
        {figures.map((props, index) => (
          <Figure key={index} {...props} />
        ))}
      </>,
    );
  });
}

/** The parts of `id`'s scope: `lo-fig3` of `lo-fig3-cost`. */
function scopeOf(id: string): string | undefined {
  return /^(lo-fig\d+)-/.exec(id)?.[1];
}

/** The type of image a file's name says. */
function typeOf(name: string): ImageType {
  const ending = name.slice(name.lastIndexOf('.') + 1);
  switch (ending) {
    case 'png':
    case 'gif':
    case 'webp':
      return ending;
    case 'jpg':
    case 'jpeg':
      return 'jpeg';
    default:
      throw new Error(`No image is named ${name}`);
  }
}

const flow = sanitizeSvg(readFileSync(join(FIGURES, 'flow.svg'), 'utf8')).svg!;
const ids = [...readFileSync(join(FIGURES, 'flow.svg'), 'utf8').matchAll(/id="([^"]+)"/g)].map(
  (match) => match[1]!,
);

/** The parts the check keeps of it: every id but its marker's. */
const PARTS = ['bucket', 'limiter', 'timeout'];

function svgFigure(parts: string[] = PARTS): FigureState {
  return { state: 'kept', type: 'svg', svg: flow, parts };
}

describe('an SVG figure', () => {
  test('is drawn in its frame, with its number and caption', () => {
    render({
      path: 'figures/flow.svg',
      figure: svgFigure([]),
      number: 2,
      caption: 'A request waits.',
    });
    const figure = host.querySelector('figure.lo-figure')!;
    const svg = figure.querySelector(':scope > .lo-figure__frame > svg')!;
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(figure.querySelector('figcaption')?.textContent).toBe('Figure 2. A request waits.');
    expect(figure.querySelectorAll('.lo-fig-link')).toHaveLength(0);
  });

  test('shown by two blocks, has a scope for each', () => {
    render(
      { path: 'figures/flow.svg', figure: svgFigure(), number: 1 },
      { path: 'figures/flow.svg', figure: svgFigure(), number: 2 },
    );
    const [first, second] = [...host.querySelectorAll('svg')].map((svg) =>
      [...svg.querySelectorAll('[id]')].map((element) => element.id),
    );
    expect(first!.length).toBe(ids.length);
    expect(second!.length).toBe(ids.length);
    expect(new Set([...first!, ...second!]).size).toBe(2 * ids.length);
    expect(new Set(first!.map(scopeOf)).size).toBe(1);
    expect(scopeOf(first![0]!)).toMatch(/^lo-fig\d+$/);
    expect(scopeOf(first![0]!)).not.toBe(scopeOf(second![0]!));
  });

  test('links only the parts the check kept for its block, with what they link to', () => {
    const follow = vi.fn<(part: PartLink) => void>();
    const [kept, ...others] = PARTS;
    render({
      path: 'figures/flow.svg',
      figure: svgFigure([kept!]),
      number: 1,
      parts: [
        { id: kept!, label: 'The term bucket' },
        ...others.map((id) => ({ id, label: `Not kept: ${id}` })),
      ],
      onFollow: follow,
    });
    const links = [...host.querySelectorAll('.lo-fig-link')];
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['The term bucket']);
    expect(links[0]!.getAttribute('tabindex')).toBe('0');
    act(() => {
      links[0]!.lastElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(follow).toHaveBeenCalledExactlyOnceWith({ id: kept, label: 'The term bucket' });
  });

  test('shows a part’s preview while it’s hovered or has focus', () => {
    render({
      path: 'figures/flow.svg',
      figure: svgFigure(),
      number: 1,
      parts: PARTS.map((id) => ({ id, label: `Go to ${id}` })),
      preview: (part) => <span>Lines of {part.id}</span>,
    });
    const [first, second] = [...host.querySelectorAll<SVGGElement>('.lo-fig-link')];
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
    act(() => {
      first!.lastElementChild!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(host.querySelector('[role="tooltip"]')?.textContent).toBe(`Lines of ${PARTS[0]}`);
    act(() => {
      first!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: host }));
    });
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
    act(() => {
      second!.focus();
    });
    expect(host.querySelector('[role="tooltip"]')?.textContent).toBe(`Lines of ${PARTS[1]}`);
    expect(host.querySelector('.lo-figpreview')?.parentElement?.tagName).toBe('FIGURE');
  });

  test('too tall to draw at the frame’s width is drawn narrower, so it’s 960 px tall at most', () => {
    const tall = sanitizeSvg(
      '<svg viewBox="0 0 100 800"><rect width="100" height="800"/></svg>',
    ).svg!;
    const wide = sanitizeSvg('<svg viewBox="0 0 860 320"><rect width="1" height="1"/></svg>').svg!;
    render(
      {
        path: 'figures/tall.svg',
        figure: { state: 'kept', type: 'svg', svg: tall, parts: [] },
        number: 1,
      },
      {
        path: 'figures/wide.svg',
        figure: { state: 'kept', type: 'svg', svg: wide, parts: [] },
        number: 2,
      },
    );
    const frames = [...host.querySelectorAll<HTMLElement>('.lo-figure__frame')];
    expect(frames.map((frame) => frame.style.getPropertyValue('--lo-fig-widest'))).toEqual([
      `${(TALLEST * 100) / 800}px`,
      `${(TALLEST * 860) / 320}px`,
    ]);
  });
});

/** A JPEG `width` by `height` as its header says, with Exif orientation `orientation`. */
function jpeg(width: number, height: number, orientation: number): Uint8Array<ArrayBuffer> {
  const tiff = [
    0x4d,
    0x4d,
    0,
    42,
    0,
    0,
    0,
    8,
    0,
    1,
    0x01,
    0x12,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const sof = [
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    0x11,
    0,
  ];
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    0,
    exif.length + 2,
    ...exif,
    ...sof,
    0xff,
    0xda,
    0,
    2,
    0xff,
    0xd9,
  ]);
}

describe('an image figure', () => {
  test('is drawn on a canvas laid out from its checked size, turned as its Exif data says', () => {
    render(
      {
        path: 'figures/photo.jpg',
        figure: { state: 'kept', type: 'jpeg', width: 1200, height: 4000 },
        bytes: jpeg(1200, 4000, 1),
        number: 1,
      },
      {
        path: 'figures/turned.jpg',
        figure: { state: 'kept', type: 'jpeg', width: 4000, height: 1200 },
        bytes: jpeg(4000, 1200, 6),
        number: 2,
      },
      {
        path: 'figures/shot.png',
        figure: { state: 'kept', type: 'png', width: 320, height: 180 },
        bytes: Uint8Array.from(readFileSync(join(FIGURES, 'shot.png'))),
        number: 3,
      },
    );
    const frames = [...host.querySelectorAll<HTMLElement>('.lo-figure__frame')];
    expect(frames.map((frame) => frame.style.getPropertyValue('--lo-fig-aspect'))).toEqual([
      '1200 / 4000',
      '1200 / 4000',
      '320 / 180',
    ]);
    // No taller than 960 px, and no wider than the image.
    expect(frames.map((frame) => frame.style.getPropertyValue('--lo-fig-widest'))).toEqual([
      '288px',
      '288px',
      '320px',
    ]);
    for (const frame of frames) {
      expect(frame.children).toHaveLength(1);
      expect(frame.firstElementChild?.tagName).toBe('CANVAS');
      expect(frame.firstElementChild?.getAttribute('role')).toBe('img');
    }
  });

  test('without its bytes yet, is laid out from its header, and nothing is decoded', () => {
    render({
      path: 'figures/a.png',
      figure: { state: 'kept', type: 'png', width: 2, height: 1 },
      number: 1,
    });
    expect(
      host
        .querySelector<HTMLElement>('.lo-figure__frame')
        ?.style.getPropertyValue('--lo-fig-aspect'),
    ).toBe('2 / 1');
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('a figure that can’t be shown', () => {
  const cases: [FigureState, string][] = [
    [{ state: 'leftOut', why: 'missing' }, "figures/a.png isn't in the overview's commit."],
    [{ state: 'leftOut', why: 'notFile' }, "figures/a.png isn't a file."],
    [{ state: 'leftOut', why: 'type' }, "figures/a.png isn't the type its name says."],
    [
      { state: 'leftOut', why: 'header' },
      "figures/a.png has a damaged header, so Lo can't tell its size.",
    ],
    [
      { state: 'leftOut', why: 'encoding' },
      "figures/a.png isn't UTF-8, which an SVG figure must be.",
    ],
    [
      { state: 'leftOut', why: 'content' },
      "figures/a.png holds what a figure can't, such as a script, a style or an outside image.",
    ],
    [{ state: 'leftOut', why: 'tooLarge' }, 'figures/a.png is larger than a figure may be.'],
    [{ state: 'unread', why: 'failed' }, "figures/a.png couldn't be read."],
    [{ state: 'unread', why: 'stopped' }, 'figures/a.png took too long to read.'],
    // From another process, a state Lo doesn't know.
    [JSON.parse('{"state": "other"}'), "figures/a.png couldn't be read."],
  ];

  test.each(cases)('%o says why', (figure, why) => {
    render({ path: 'figures/a.png', figure, number: 3, caption: 'The dashboard.' });
    const shown = host.querySelector('figure.lo-figure--broken')!;
    expect(shown.querySelector('.lo-figure__frame p')?.textContent).toBe(
      `Figure 3 can't be shown. ${why}`,
    );
    expect(shown.querySelector('figcaption')?.textContent).toBe('Figure 3. The dashboard.');
  });

  test('a kept SVG whose tree has no svg at its root is one', () => {
    render({
      path: 'figures/a.svg',
      figure: {
        state: 'kept',
        type: 'svg',
        svg: { kind: 'element', name: 'g', attributes: {}, children: [] },
        parts: [],
      },
      number: 1,
    });
    expect(host.querySelector('.lo-figure--broken p')?.textContent).toContain(
      "holds what a figure can't",
    );
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(join(repo, 'design/css/overview.css'), 'utf8');

  test('clips a figure to its box, and caps its height at the tallest Lo draws', () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    render(
      { path: 'figures/flow.svg', figure: svgFigure([]), number: 1 },
      {
        path: 'figures/shot.png',
        figure: { state: 'kept', type: 'png', width: 320, height: 180 },
        bytes: Uint8Array.from(readFileSync(join(FIGURES, 'shot.png'))),
        number: 2,
      },
    );
    for (const drawn of host.querySelectorAll(
      '.lo-figure__frame > svg, .lo-figure__frame > canvas',
    )) {
      const computed = getComputedStyle(drawn);
      expect(computed.overflow).toBe('hidden');
      expect(computed.maxHeight).toBe(`${TALLEST}px`);
    }
    expect(
      host.querySelectorAll('.lo-figure__frame > svg, .lo-figure__frame > canvas'),
    ).toHaveLength(2);
  });

  test('lets nothing in a figure draw outside it, and draws it no wider than keeps it within', () => {
    expect(css).not.toMatch(/overflow:\s*visible/);
    const rule =
      /\.lo-figure__frame > svg:not\(\.lo-i\),\s*\.lo-figure__frame > canvas \{([^}]*)\}/.exec(
        css,
      )?.[1];
    expect(rule).toMatch(/max-width: var\(--lo-fig-widest, 100%\);/);
    expect(rule).toMatch(/max-height: 960px;/);
    expect(rule).toMatch(/overflow: hidden;/);
  });
});

describe('no figure is ever given a URL', () => {
  test('nothing makes one, and nothing in the page holds one', async () => {
    const svgs = readdirSync(FIGURES).filter((name) => name.endsWith('.svg'));
    const images = readdirSync(FIGURES).filter((name) => !name.endsWith('.svg'));
    // Every figure is near the screen, and each canvas 1 pixel wide.
    FakeIntersectionObserver.near = true;
    box(HTMLCanvasElement.prototype, 1);
    render(
      ...svgs.map((name, index) => ({
        path: `figures/${name}`,
        figure: {
          state: 'kept',
          type: 'svg',
          svg: sanitizeSvg(readFileSync(join(FIGURES, name), 'utf8')).svg!,
          parts: PARTS,
        } as const,
        number: index + 1,
        parts: PARTS.map((id) => ({ id, label: id })),
      })),
      ...images.map((name, index) => ({
        path: `figures/${name}`,
        figure: { state: 'kept', type: typeOf(name), width: 1, height: 1 } as const,
        bytes: Uint8Array.from(readFileSync(join(FIGURES, name))),
        number: svgs.length + index + 1,
      })),
      { path: 'figures/gone.png', figure: { state: 'leftOut', why: 'missing' }, number: 99 },
    );
    await act(() => decodes.idle());
    expect(page.createObjectURL).not.toHaveBeenCalled();
    expect(
      host.querySelectorAll('img, image, iframe, object, embed, use, a, link, source'),
    ).toHaveLength(0);
    expect(host.querySelectorAll('canvas')).toHaveLength(images.length);
    const attributes = [...host.querySelectorAll('*')].flatMap((element) =>
      [...element.attributes].map(({ name, value }) => ({ element, name, value })),
    );
    expect(attributes.filter(({ name }) => /^(?:src|srcset|href|xlink:href)$/.test(name))).toEqual(
      [],
    );
    expect(
      attributes.filter(({ value }) => /(?:blob|data|https?|file|lo-[a-z]+):/i.test(value)),
    ).toEqual([]);
    // Only the frame is styled, and only with its figure's size.
    const styles = attributes.filter(({ name }) => name === 'style');
    expect(styles.length).toBeGreaterThan(0);
    expect(
      styles.filter(
        ({ element, value }) =>
          element.className !== 'lo-figure__frame' ||
          !/^(?: ?--lo-fig-(?:widest|aspect): [\d. /]+(?:px)?;)+$/.test(value),
      ),
    ).toEqual([]);
    // Each image went to its decoder as a Blob of its type, and nowhere else, and was drawn.
    expect(decode.mock.calls.map(([blob]) => blob.type)).toEqual(
      images.map((name) => `image/${typeOf(name)}`),
    );
    expect(page.drawImage).toHaveBeenCalledTimes(images.length);
  });

  test('the figures’ code makes no URL, image element or request', () => {
    const folder = fileURLToPath(new URL('./', here));
    const sources = readdirSync(folder).filter(
      (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name),
    );
    expect(sources.toSorted()).toEqual([
      'Figure.tsx',
      'decodes.ts',
      'image.ts',
      'index.ts',
      'svg.ts',
    ]);
    const forbidden =
      /createObjectURL|new Image\b|<img|'img'|\.src\b|srcset|innerHTML|outerHTML|insertAdjacentHTML|DOMParser|fetch\(|XMLHttpRequest|blob:|data:|navigat|window\.open|location/;
    const found = sources.filter((name) =>
      // Without comments, which may say what the code never does.
      forbidden.test(
        readFileSync(join(folder, name), 'utf8').replaceAll(/\/\/.*|\/\*[\s\S]*?\*\//g, ''),
      ),
    );
    expect(found).toEqual([]);
  });
});
