import tokens from '@lo/design/tokens.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';

import { fit, fitWidths, readSizes, type Layout } from './fit.ts';

/** The sizes as the window reads them from the tokens' variables. */
const sizes = readSizes({
  getPropertyValue: (name) =>
    tokens.size.tokens.find((token) => `--${token.name}` === name)?.value ?? '',
});

/** A layout with what's named open, at the default widths. */
function layout(open: { left?: boolean; threads?: boolean; beside?: boolean }): Layout {
  return {
    left: { open: open.left ?? false },
    threads: { open: open.threads ?? false },
    beside: open.beside ?? false,
  };
}

describe('readSizes', () => {
  it('reads the panels, a view, the reading view and the gap from the tokens', () => {
    expect(sizes).toEqual({
      left: { width: 300, min: 220, max: 480 },
      threads: { width: 340, min: 280, max: 560 },
      view: 340,
      reading: 904,
      gap: 8,
    });
  });
});

describe('fit', () => {
  it.each([
    ['720, left panel', 720, { left: true }, undefined, { left: 300, views: [420], away: [] }],
    [
      '720, code beside, both panels open',
      720,
      { left: true, threads: true, beside: true },
      'beside',
      { views: [356, 356], away: ['left', 'threads'] },
    ],
    [
      '720, both panels, threads asked last',
      720,
      { left: true, threads: true },
      'threads',
      { threads: 340, views: [380], away: ['left'] },
    ],
    [
      '1440, left, code beside',
      1440,
      { left: true, beside: true },
      'beside',
      { left: 300, views: [566, 566], away: [] },
    ],
    [
      '1440, all',
      1440,
      { left: true, threads: true, beside: true },
      'beside',
      { left: 300, threads: 340, views: [396, 396], away: [] },
    ],
    ['2560, left panel', 2560, { left: true }, undefined, { left: 300, views: [2260], away: [] }],
    [
      '2560, left, code beside',
      2560,
      { left: true, beside: true },
      'beside',
      { left: 300, views: [904, 1348], away: [] },
    ],
    [
      '2560, all',
      2560,
      { left: true, threads: true, beside: true },
      'beside',
      { left: 300, threads: 340, views: [904, 1008], away: [] },
    ],
  ] as const)('draws the layout table’s row: %s', (_row, width, open, asked, drawn) => {
    expect(fit(layout(open), width, asked, 'reading', sizes)).toMatchObject(drawn);
  });

  it('puts the view without focus away last, and never what was asked for last first', () => {
    const all = layout({ left: true, threads: true, beside: true });
    // Asked for the left panel last, the view without focus goes before it.
    expect(fit(all, 800, 'left', 'reading', sizes)).toMatchObject({
      left: 300,
      threads: undefined,
      views: [500],
      away: ['threads', 'code'],
    });
    expect(fit(all, 800, 'left', 'code', sizes).away).toEqual(['threads', 'reading']);
    // Still too narrow, what was asked for last goes too.
    expect(fit(all, 500, 'left', 'reading', sizes)).toMatchObject({
      left: undefined,
      views: [500],
      away: ['left', 'threads', 'code'],
    });
  });

  it('counts zoom: a 720 px window at 200 % is one view', () => {
    const all = layout({ left: true, threads: true, beside: true });
    expect(fit(all, 360, 'beside', 'code', sizes)).toMatchObject({
      left: undefined,
      threads: undefined,
      views: [360],
      away: ['left', 'threads', 'reading'],
    });
  });

  it('brings each back at its saved width once there’s room, shrinking the threads panel first', () => {
    const saved: Layout = {
      left: { open: true, width: 400 },
      threads: { open: true, width: 500 },
      beside: false,
    };
    expect(fit(saved, 800, 'threads', 'reading', sizes)).toMatchObject({
      left: undefined,
      threads: 460,
      views: [340],
      away: ['left'],
    });
    // Room for both at their minimum: the views keep theirs, the threads panel gives first.
    expect(fit(saved, 1000, 'threads', 'reading', sizes)).toMatchObject({
      left: 380,
      threads: 280,
      views: [340],
      away: [],
    });
    expect(fit(saved, 1300, 'threads', 'reading', sizes)).toMatchObject({
      left: 400,
      threads: 500,
      views: [400],
      away: [],
    });
  });

  it('keeps the reading view’s share of the middle once its edge is dragged', () => {
    const shared: Layout = { ...layout({ left: true, beside: true }), reading: 0.25 };
    // Each view keeps its minimum.
    expect(fit(shared, 1440, 'beside', 'reading', sizes).views).toEqual([340, 792]);
    expect(fit(shared, 2560, 'beside', 'reading', sizes).views).toEqual([563, 1689]);
  });

  it('says what can’t be drawn beside one view at its minimum', () => {
    const none = layout({});
    expect(fit(none, 600, undefined, 'reading', sizes).cramped).toEqual({
      left: false,
      threads: true,
      beside: true,
    });
    expect(fit(none, 680, undefined, 'reading', sizes).cramped).toEqual({
      left: false,
      threads: false,
      beside: true,
    });
  });
});

describe('fitWidths', () => {
  it('draws what’s open, a panel no narrower than its minimum, and the views under theirs past that', () => {
    const both = layout({ left: true, threads: true });
    expect(fitWidths(both, 720, sizes)).toMatchObject({
      left: 220,
      threads: 280,
      views: [220],
      away: [],
    });
  });

  it('takes a panel’s width within its limits', () => {
    const wide: Layout = { ...layout({}), left: { open: true, width: 900 } };
    expect(fitWidths(wide, 2560, sizes).left).toBe(480);
    const narrow: Layout = { ...layout({}), left: { open: true, width: 10 } };
    expect(fitWidths(narrow, 2560, sizes).left).toBe(220);
  });

  it('stops a panel’s edge where the views would go under their minimum', () => {
    expect(fitWidths(layout({ left: true }), 1440, sizes).edges.left).toEqual({
      min: 220,
      max: 480,
    });
    expect(fitWidths(layout({ left: true }), 720, sizes).edges.left).toEqual({
      min: 220,
      max: 380,
    });
    expect(fitWidths(layout({ left: true, threads: true }), 1000, sizes).edges).toEqual({
      left: { min: 220, max: 320 },
      threads: { min: 280, max: 360 },
      views: undefined,
    });
    expect(fitWidths(layout({ left: true, beside: true }), 1440, sizes).edges.views).toEqual({
      min: 340,
      max: 792,
    });
  });
});
