// The overview's skeleton in Chromium itself, where it's laid out: jsdom lays nothing out. It stands
// where the overview will: its outline where the overview's is, or none in a narrow view, and its
// article at the same inset and measure, its pieces as far apart as the overview's, its code block
// as wide and as tall as one whose code is still to come, whose lines are each a code line tall.

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('skeleton.tsx', 'Skeleton', utilities);

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForSelector('#skeleton .lo-ov-skeleton');
  return page;
}

/** A box on the page, from its box's top left. */
interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the overview's pieces are, and the skeleton's, each from its box's top left, with both boxes
 * `width` wide: the outline's label and first section, the byline, the first two headings, the
 * tl;dr's paragraph and its line's height, the paragraph after the second heading, the first code
 * block and the paragraph after it, and the code block's lines.
 */
function places(page: Page, width: number) {
  return page.evaluate(async (wide) => {
    for (const box of document.querySelectorAll<HTMLElement>('#overview, #skeleton')) {
      box.style.width = `${wide}px`;
      box.style.height = '900px';
    }
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const of = (box: HTMLElement, element: Element | null | undefined): Place | undefined => {
      if (!element || element.getClientRects().length === 0) return undefined;
      const from = box.getBoundingClientRect();
      const at = element.getBoundingClientRect();
      return { x: at.x - from.x, y: at.y - from.y, width: at.width, height: at.height };
    };
    const overview = document.querySelector<HTMLElement>('#overview')!;
    const article = overview.querySelector('.lo-ov__article')!;
    const headings = article.querySelectorAll('h2');
    const paragraphs = article.querySelectorAll('p');
    const code = article.querySelector('.lo-codeblock');
    const lead = article.querySelector('.lo-lead');
    const skeleton = document.querySelector<HTMLElement>('#skeleton')!;
    const bars = skeleton.querySelectorAll('.lo-ov-skeleton__heading');
    const block = skeleton.querySelector('.lo-ov-skeleton__article > .lo-codeblock');
    const lines = (box: Element | null) =>
      [...(box?.querySelectorAll('.lo-codeblock__skeleton .cm-line') ?? [])].map((line) => {
        const row = line.getBoundingClientRect();
        const bar = line.querySelector('.skeleton')!.getBoundingClientRect();
        return { height: row.height, middle: bar.y + bar.height / 2 - row.y };
      });
    return {
      overview: {
        label: of(overview, overview.querySelector('.lo-toc__label')),
        section: of(overview, overview.querySelector('.lo-toc__item')),
        byline: of(overview, article.querySelector('.lo-ov-byline')),
        headings: [of(overview, headings[0]), of(overview, headings[1])],
        lead: of(overview, lead),
        leadLine: lead ? parseFloat(getComputedStyle(lead).lineHeight) : undefined,
        paragraph: of(overview, paragraphs[1]),
        code: of(overview, code),
        after: of(overview, paragraphs[2]),
        lines: lines(code),
      },
      skeleton: {
        label: of(skeleton, skeleton.querySelector('.lo-ov-skeleton__label')),
        section: of(skeleton, skeleton.querySelector('.lo-ov-skeleton__item')),
        byline: of(skeleton, skeleton.querySelector('.lo-ov-skeleton__byline')),
        headings: [of(skeleton, bars[0]), of(skeleton, bars[1])],
        lead: of(skeleton, bars[0]?.nextElementSibling),
        leadLine: of(skeleton, bars[0]?.nextElementSibling?.firstElementChild)?.height,
        paragraph: of(skeleton, bars[1]?.nextElementSibling),
        code: of(skeleton, block),
        after: of(skeleton, block?.nextElementSibling),
        lines: lines(block),
      },
    };
  }, width);
}

/** The room between `above`'s foot and `below`'s top. */
const gap = (above: Place | undefined, below: Place | undefined) =>
  above && below ? Math.round(below.y - (above.y + above.height)) : undefined;

/** A box's left edge and width, and its top unless `top` is false, to the pixel. */
const edges = (place: Place | undefined, top = true) =>
  place && {
    x: Math.round(place.x),
    width: Math.round(place.width),
    ...(top ? { y: Math.round(place.y) } : {}),
  };

/** How far apart each of the pieces is, and each piece's left edge and width. */
function layout(side: Awaited<ReturnType<typeof places>>['overview']) {
  const [first, second] = side.headings;
  return {
    label: edges(side.label),
    section: edges(side.section),
    byline: edges(side.byline),
    heading: { ...edges(first, false), height: first?.height, below: gap(side.byline, first) },
    lead: { x: edges(side.lead, false)?.x, below: gap(first, side.lead), line: side.leadLine },
    next: { below: gap(side.lead, second), height: second?.height },
    paragraph: { x: edges(side.paragraph, false)?.x, below: gap(second, side.paragraph) },
    code: { ...edges(side.code, false), below: gap(side.paragraph, side.code) },
    after: gap(side.code, side.after),
  };
}

test('stands where the overview will, at its insets and spacing, with or without its outline', async () => {
  const page = await open();
  for (const width of [1200, 800]) {
    const { overview, skeleton } = await places(page, width);
    expect(overview.code, `the overview's code block at ${width}`).toBeDefined();
    expect(layout(skeleton), `at ${width} px`).toEqual(layout(overview));
    // Under 980 px, the article takes the outline's room in both.
    if (width < 980) expect(skeleton.section).toBeUndefined();
    else expect(skeleton.section).toBeDefined();
  }
});

test('draws a code block’s code still to come as a bar in the middle of each code line', async () => {
  const page = await open();
  const { overview, skeleton } = await places(page, 1200);
  for (const lines of [overview.lines, skeleton.lines]) {
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line).toEqual({ height: 20, middle: 10 });
  }
  // Five lines of code to come: as tall in the skeleton as in the overview.
  expect(Math.round(skeleton.code?.height ?? 0)).toBe(Math.round(overview.code?.height ?? -1));
});
