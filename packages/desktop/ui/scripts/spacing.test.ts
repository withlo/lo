import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { buildCss, declarations } from './stylesheet.ts';
import type { TokenFile } from './theme.ts';

const tokens: TokenFile = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve('@lo/design/tokens.json'), 'utf8'),
);

describe("Lo's spacing", () => {
  it('has a utility for a spacing step and none for a number beside it', async () => {
    const css = await buildCss(['p-4', 'p-17']);
    expect(declarations(css, 'p-4')).toBe('padding: var(--lo-sp-4);');
    expect(declarations(css, 'p-17')).toBeUndefined();
  });

  it.each(tokens.spacing.tokens.map(({ name }) => name.replace('lo-sp-', '')))(
    'makes step %s a size for padding, gaps, margins and boxes',
    async (step) => {
      const css = await buildCss([`p-${step}`, `gap-${step}`, `-ms-${step}`, `size-${step}`]);
      expect(declarations(css, `p-${step}`)).toBe(`padding: var(--lo-sp-${step});`);
      expect(declarations(css, `gap-${step}`)).toBe(`gap: var(--lo-sp-${step});`);
      expect(declarations(css, `-ms-${step}`)).toBe(
        `margin-inline-start: calc(var(--lo-sp-${step}) * -1);`,
      );
      expect(declarations(css, `size-${step}`)).toContain(`width: var(--lo-sp-${step});`);
    },
  );

  it('allows zero, which is no space rather than a step', async () => {
    const css = await buildCss(['p-0', 'min-w-0', 'inset-0', 'gap-0']);
    expect(declarations(css, 'p-0')).toBe('padding: 0px;');
    expect(declarations(css, 'min-w-0')).toBe('min-width: 0px;');
    expect(declarations(css, 'inset-0')).toBe('inset: 0px;');
    expect(declarations(css, 'gap-0')).toBe('gap: 0px;');
  });

  it.each([
    'p-1',
    'p-3',
    'p-17',
    'px-5',
    'gap-7',
    'gap-100',
    'ms-11',
    '-mt-9',
    'w-26',
    'h-30',
    'size-26',
    'min-w-120',
    'max-w-1234',
    'basis-280',
    'inset-10',
    'top-1',
    'p-0.5',
    'space-x-2.5',
  ])('makes nothing of the number in %s', async (className) => {
    expect(declarations(await buildCss([className]), className)).toBeUndefined();
  });

  it("keeps the design system's named sizes for widths, heights and the rest", async () => {
    const css = await buildCss([
      'h-tabbar-h',
      'size-control-h-sm',
      'w-panel-left-w',
      'max-w-read-measure',
      'max-w-tab-w',
      'min-w-tab-w-min',
      'basis-tab-w',
      'ps-window-inset-start',
    ]);
    expect(declarations(css, 'h-tabbar-h')).toBe('height: var(--lo-tabbar-h);');
    expect(declarations(css, 'size-control-h-sm')).toBe(
      'width: var(--lo-control-h-sm); height: var(--lo-control-h-sm);',
    );
    expect(declarations(css, 'w-panel-left-w')).toBe('width: var(--lo-panel-left-w);');
    expect(declarations(css, 'max-w-read-measure')).toBe('max-width: var(--lo-read-measure);');
    expect(declarations(css, 'max-w-tab-w')).toBe('max-width: var(--lo-tab-w);');
    expect(declarations(css, 'min-w-tab-w-min')).toBe('min-width: var(--lo-tab-w-min);');
    expect(declarations(css, 'basis-tab-w')).toBe('flex-basis: var(--lo-tab-w);');
    expect(declarations(css, 'ps-window-inset-start')).toBe(
      'padding-inline-start: var(--lo-window-inset-start);',
    );
  });
});
