import { describe, expect, it } from 'vitest';

import { buildCss } from './stylesheet.ts';

interface Rule {
  readonly selector: string;
  readonly body: string;
}

/** The style rules in `css`, whatever layer holds them, each with the selector and what it sets. */
function rulesOf(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = '', body = '']) => ({
    selector: selector.trim().replace(/\s+/g, ' '),
    body: body.trim().replace(/\s+/g, ' '),
  }));
}

describe("Lo's focus style", () => {
  it('draws the design system’s ring for keyboard focus, and Chromium’s own for nothing', async () => {
    const rules = rulesOf(await buildCss([]));
    const bare = (selector: string) => rules.filter((rule) => rule.selector === selector);
    // Any element: the ring, and none of Chromium's outline.
    expect(bare(':focus').map((rule) => rule.body)).toEqual(['outline: none;']);
    expect(bare(':focus-visible').map((rule) => rule.body)).toEqual([
      'outline: none; box-shadow: var(--lo-ring);',
    ]);
    // Rows, options and tabs take the ring inside their edge.
    const inset = rules.find((rule) => rule.selector.includes('option'));
    expect(inset?.selector).toMatch(/:focus-visible$/);
    expect(inset?.body).toBe('box-shadow: var(--lo-ring-inset);');
  });

  it('draws none on what shows its focus inside: a list or tree by its row, a code view by its cursor', async () => {
    const rules = rulesOf(await buildCss([]));
    const none = rules.find((rule) => rule.selector.includes('aria-activedescendant'));
    expect(none?.selector).toContain('.cm-content');
    expect(none?.body).toBe('box-shadow: none;');
  });

  it('draws no ring for focus a click gives', async () => {
    const rules = rulesOf(await buildCss([]));
    // `:focus` alone is every focus, a click's included; only `:focus-visible` is the keyboard's.
    const drawn = rules.filter(
      (rule) => /:focus(?![-\w])/.test(rule.selector) && /shadow|outline: (?!none)/.test(rule.body),
    );
    expect(drawn).toEqual([]);
  });
});
