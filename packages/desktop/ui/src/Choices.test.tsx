// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { Choices, type ChoiceItem } from './Choices.tsx';
import { LayoutPicture } from './pictures/LayoutPicture.tsx';
import { ThemePicture } from './pictures/ThemePicture.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

type Theme = 'dark' | 'light' | 'system';
type Layout = 'split' | 'inline';

const THEMES: ChoiceItem<Theme>[] = [
  { value: 'dark', title: 'Dark', picture: <ThemePicture theme="dark" /> },
  { value: 'light', title: 'Light', picture: <ThemePicture theme="light" /> },
  { value: 'system', title: 'System', picture: <ThemePicture theme="system" /> },
];

const LAYOUTS: ChoiceItem<Layout>[] = [
  { value: 'split', title: 'Side by side', picture: <LayoutPicture layout="split" /> },
  { value: 'inline', title: 'Inline', picture: <LayoutPicture layout="inline" /> },
];

/** Two groups drawn across, one over the other, as the welcome's look step has them. */
function Look({ chosen }: { chosen: string[] }) {
  const [theme, setTheme] = useState<Theme>('system');
  const [layout, setLayout] = useState<Layout>('split');
  return (
    <div data-lo-scope="welcome">
      <Choices
        across
        label="Theme"
        items={THEMES}
        value={theme}
        onChange={(value) => {
          chosen.push(value);
          setTheme(value);
        }}
      />
      <Choices
        across
        label="Diff layout"
        items={LAYOUTS}
        value={layout}
        onChange={(value) => {
          chosen.push(value);
          setLayout(value);
        }}
      />
    </div>
  );
}

function render(chosen: string[]): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<Look chosen={chosen} />));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

/** Presses `key` where focus is. */
function press(key: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

/** The card with focus, by its group and its title. */
const focused = () =>
  `${document.activeElement?.closest('[role="radiogroup"]')?.getAttribute('aria-label')}: ${document.activeElement?.textContent}`;

describe('Choices drawn across', () => {
  it('chooses along the row with ← and →, round the ends, and goes between groups with ↑ and ↓', () => {
    const chosen: string[] = [];
    const host = render(chosen);
    const system = [...host.querySelectorAll<HTMLElement>('[role="radio"]')][2];
    act(() => system?.focus());
    press('ArrowRight');
    expect(focused()).toBe('Theme: Dark');
    press('h');
    expect(focused()).toBe('Theme: System');
    press('l');
    press('l');
    expect(focused()).toBe('Theme: Light');
    // Down and up go to the chosen card of the group there, and choose nothing.
    press('ArrowDown');
    expect(focused()).toBe('Diff layout: Side by side');
    press('j');
    expect(focused()).toBe('Diff layout: Side by side');
    press('k');
    expect(focused()).toBe('Theme: Light');
    press('ArrowUp');
    expect(focused()).toBe('Theme: Light');
    expect(chosen).toEqual(['dark', 'system', 'dark', 'light']);
  });

  it('draws each card as its picture over its ball and title, and the pictures for no one to hear', async () => {
    const markup = renderToStaticMarkup(<Look chosen={[]} />);
    expect(markup).toMatch(/<div role="radiogroup" aria-label="Theme" data-choices="across"/);
    // Five pictures, each hidden from a screen reader, which hears the card's title.
    expect(markup.match(/aria-hidden="true" class="pointer-events-none relative/g)).toHaveLength(5);
    // The light and the dark window, pinned to their themes, twice each: System has both.
    expect(markup.match(/data-theme="dark"/g)).toHaveLength(2);
    expect(markup.match(/data-theme="light"/g)).toHaveLength(2);
    const classes = [
      ...new Set(
        [...markup.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => (value ?? '').split(/\s+/)),
      ),
    ].filter((name) => name !== '');
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
    // Cards share the row, each at least as wide as the token, and wrap where they can't be.
    expect(css.replaceAll(/\s+/g, ' ')).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(min(var(--lo-choice-min-w), 100%), 1fr))',
    );
  });
});
