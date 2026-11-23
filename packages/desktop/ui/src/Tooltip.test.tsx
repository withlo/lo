// @vitest-environment jsdom
// A tooltip's own forms, beyond a button's `hint`: a mark's name, and a name cut short.

import { afterEach, expect, test } from 'vitest';

import { cleanUp, render, tipOf } from '../test/dom.ts';
import { StatusItem } from './StatusBar.tsx';
import { Tooltip, TooltipGroup } from './Tooltip.tsx';

afterEach(cleanUp);

const PATH = 'src/graphql/cost/estimate.ts';

test('a name cut short shows whole as its tooltip, and only while it’s cut', () => {
  const host = render(
    <TooltipGroup>
      <Tooltip label={PATH} cut>
        <span className="truncate">{PATH}</span>
      </Tooltip>
    </TooltipGroup>,
  );
  const name = host.querySelector('span')!;
  // Drawn whole, it has nothing to say again.
  expect(tipOf(name)).toBeUndefined();
  expect(tipOf(name, { cut: true })).toBe(PATH);
});

test('a name with a part cut short, as a path whose folder ellipsizes, shows whole', () => {
  const host = render(
    <TooltipGroup>
      <Tooltip label={PATH} cut>
        <span>
          <span className="truncate">src/graphql/cost/</span>
          <b>estimate.ts</b>
        </span>
      </Tooltip>
    </TooltipGroup>,
  );
  const folder = host.querySelector('.truncate')!;
  expect(tipOf(host.querySelector('span')!)).toBeUndefined();
  Object.defineProperty(folder, 'clientWidth', { configurable: true, value: 40 });
  Object.defineProperty(folder, 'scrollWidth', { configurable: true, value: 80 });
  expect(tipOf(host.querySelector('span')!)).toBe(PATH);
});

test('a mark shows its name alone, with no key', () => {
  const host = render(
    <TooltipGroup>
      <Tooltip label="Added">
        <span role="img" aria-label="Added">
          A
        </span>
      </Tooltip>
    </TooltipGroup>,
  );
  expect(tipOf(host.querySelector('[role="img"]')!)).toBe('Added');
  expect(host.querySelector('[title]')).toBeNull();
});

test('a status item’s label cut short shows whole, and one with a command names it with its key', () => {
  const host = render(
    <TooltipGroup>
      <StatusItem>Indexing code · 1,204 / 3,880</StatusItem>
      <StatusItem
        hint="Submit review…"
        hintKeys={['⌘⏎']}
        hintShortcut="Meta+Enter"
        onClick={() => {}}
      >
        2 pending comments
      </StatusItem>
    </TooltipGroup>,
  );
  const [text, button] = [...host.querySelectorAll<HTMLElement>('footer *, span, button')].filter(
    (each) => each.parentElement === host,
  );
  expect(text?.tagName).toBe('SPAN');
  expect(tipOf(text!)).toBeUndefined();
  expect(tipOf(text!, { cut: true })).toBe('Indexing code · 1,204 / 3,880');
  expect(button?.tagName).toBe('BUTTON');
  expect(tipOf(button!)).toBe('Submit review…⌘⏎');
  expect(button?.getAttribute('aria-keyshortcuts')).toBe('Meta+Enter');
  expect(host.querySelector('[title]')).toBeNull();
});
