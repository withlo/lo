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

/** Where one side's pieces are, the overview's or the skeleton's. */
type Side = Awaited<ReturnType<Window['skeleton']['places']>>['overview'];

/** A box on the page, from its view's top left. */
type Place = NonNullable<Side['byline']>;

/** Where the overview's pieces are, and the skeleton's, with both views `width` wide. */
function places(page: Page, width: number) {
  return page.evaluate((wide) => window.skeleton.places(wide), width);
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
function layout(side: Side) {
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
