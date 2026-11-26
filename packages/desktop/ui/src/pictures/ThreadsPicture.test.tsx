// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildCss, hasRule } from '../../scripts/stylesheet.ts';
import { ThreadsPicture, type PictureThreads } from './ThreadsPicture.tsx';

/** The picture of `threads`, as elements. */
function draw(threads: PictureThreads): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<ThreadsPicture threads={threads} />);
  const frame = host.firstElementChild;
  if (!(frame instanceof HTMLElement)) throw new Error('No picture.');
  return frame;
}

/** The code's rows, top to bottom: each row's cells' classes. */
function rows(frame: HTMLElement): string[][] {
  const code = frame.firstElementChild;
  return [...(code?.children ?? [])].map((row) =>
    [...row.children].map((cell) => cell.getAttribute('class') ?? ''),
  );
}

describe('ThreadsPicture', () => {
  it('draws the thread beside lines as its bubble with its popover open over the code, which stays', () => {
    const frame = draw('beside');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    const drawn = rows(frame);
    // Six lines, none moved: each its number, its lane and its code.
    expect(drawn).toHaveLength(6);
    expect(drawn.every((cells) => cells.length === 3)).toBe(true);
    // The bubble, amber, in the third line's lane; that line's number and lane are selected.
    const bubble = frame.querySelector('svg');
    expect(bubble?.getAttribute('class')).toContain('lo-i--xs');
    expect(bubble?.getAttribute('class')).toContain('text-warning');
    const third = frame.firstElementChild?.children[2];
    expect(third?.contains(bubble ?? null)).toBe(true);
    expect(
      drawn.map((cells) => cells.slice(0, 2).every((each) => each.includes('bg-selected'))),
    ).toEqual([false, false, true, false, false, false]);
    // The popover, laid over the code rather than in its flow.
    const popover = frame.lastElementChild;
    expect(popover?.getAttribute('class')).toContain('absolute');
    expect(popover?.getAttribute('class')).toContain('bg-bg-overlay');
  });

  it('draws the thread between lines in the flow, under its line, and selects nothing', () => {
    const frame = draw('between');
    const drawn = rows(frame);
    // The six lines and the thread after the third, with its own empty number and lane.
    expect(drawn).toHaveLength(7);
    expect(drawn[3]?.[2]).not.toContain('bg-diff');
    expect(frame.querySelectorAll('.bg-bg-raised')).toHaveLength(1);
    expect(drawn[3]?.slice(0, 2).every((each) => each.includes('bg-bg'))).toBe(true);
    expect(frame.querySelector('[class*="bg-selected"]')).toBeNull();
    expect(frame.querySelector('svg[class*="text-warning"]')).not.toBeNull();
    expect(frame.querySelector('.absolute.bg-bg-overlay')).toBeNull();
  });

  it('draws with classes the stylesheet has', async () => {
    const ways: PictureThreads[] = ['beside', 'between'];
    const markup = ways
      .map((threads) => renderToStaticMarkup(<ThreadsPicture threads={threads} />))
      .join('');
    const classes = [
      ...new Set(
        [...markup.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => (value ?? '').split(/\s+/)),
      ),
    ].filter((name) => name !== '' && !name.startsWith('lo-'));
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });
});
