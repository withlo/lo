// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { missingRules } from '../../test/classes.ts';
import { cleanUp, render } from '../../test/dom.ts';
import { OverviewSkeleton } from './index.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

/** The bars' widths in `element`, in order. */
const widths = (element: Element | null | undefined) =>
  [...(element?.querySelectorAll('.skeleton') ?? [])].map((bar) =>
    [...bar.classList].filter((name) => name.startsWith('w-')).join(' '),
  );

describe('OverviewSkeleton', () => {
  it('lays out the outline beside the article, which opens with the byline and the tl;dr', () => {
    const host = render(<OverviewSkeleton />);
    const outline = host.querySelector('.lo-ov-skeleton__toc');
    // The label, a row for each section with its ring, and the two buttons that move between blocks.
    expect(outline?.querySelectorAll('.lo-ov-skeleton__item')).toHaveLength(5);
    expect(outline?.querySelectorAll('.lo-ov-skeleton__foot .skeleton')).toHaveLength(2);
    const article = host.querySelector('.lo-ov-skeleton__article');
    const [byline, heading, lead] = article?.children ?? [];
    expect(byline?.className).toContain('lo-ov-skeleton__byline');
    expect(heading?.className).toContain('read-h2');
    // The tl;dr's paragraph is set larger, a bar for each of its lines.
    expect(lead?.className).toContain('read-lead');
    expect(widths(lead)).toEqual(['w-full', 'w-full', 'w-2/5']);
    // Its sections hold paragraphs and code blocks: a head over a bar on each line.
    expect(article?.querySelectorAll('.lo-ov-skeleton__heading')).toHaveLength(4);
    const code = article?.querySelectorAll('.lo-codeblock');
    expect(code).toHaveLength(2);
    expect(code?.[0]?.querySelectorAll('.lo-codeblock__head .skeleton')).toHaveLength(1);
    expect(code?.[0]?.querySelectorAll('.lo-codeblock__skeleton .cm-line')).toHaveLength(5);
    // It's a picture: nothing in it is read out, focused or pressed.
    expect(host.querySelectorAll('button, a, [tabindex], h2, p')).toHaveLength(0);
  });

  it('has a rule for each of its classes', async () => {
    const host = render(<OverviewSkeleton />);
    // The code's lines are laid out by the code view's own rules, as a code block's are.
    const missing = await missingRules(host);
    expect(missing.filter((name) => !name.startsWith('cm-'))).toEqual([]);
  });
});
