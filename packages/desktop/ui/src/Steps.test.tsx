import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { Steps, type StepItem } from './Steps.tsx';

/** A stack made partway: a base branch changed, the stack stopped, and one never sent. */
const steps: StepItem[] = [
  { key: 'a', state: 'done', title: '#4797’s base: main → mira/cost-field' },
  { key: 'b', state: 'stopped', title: 'Create the stack', detail: 'GitHub answered 502.' },
  { key: 'c', state: 'skipped', title: 'Add #4803' },
  { key: 'd', state: 'now', title: 'Put #4797’s base back' },
  { key: 'e', state: 'todo', title: 'Then #4790’s' },
];

describe('Steps', () => {
  it('numbers the steps, in order, and marks the done, the stopped and the one now', () => {
    const markup = renderToStaticMarkup(<Steps steps={steps} label="Changes" />);
    expect(markup).toMatch(/^<ol aria-label="Changes" class="[^"]*steps[^"]*">/);
    const balls = [
      ...markup.matchAll(/<span class="[^"]*step-ball[^"]*" aria-hidden="true">([^<]*)</g),
    ];
    expect(balls.map(([, mark]) => mark)).toEqual(['✓', '!', '3', '4', '5']);
    // Only the step being done now is the current one.
    expect(markup.match(/aria-current="step"/g)).toHaveLength(1);
    expect(markup).toMatch(/<li class="[^"]*" aria-current="step">[^]*Put #4797’s base back/);
    // A screen reader hears how each stands, before the step.
    for (const said of ['Done: ', 'Stopped: ', 'Not done: ', 'Now: ', 'Not yet: ']) {
      expect(markup).toContain(`<span class="sr-only">${said}</span>`);
    }
    expect(markup).toContain('GitHub answered 502.');
    expect(markup.indexOf('#4797’s base')).toBeLessThan(markup.indexOf('Create the stack'));
  });

  it('draws each state with its own colors, and the design’s measures', async () => {
    const markup = renderToStaticMarkup(<Steps steps={steps} label="Changes" />);
    expect(markup).toContain('bg-success-bg text-success');
    expect(markup).toContain('bg-danger-bg text-danger');
    expect(markup).toContain('bg-accent text-on-accent');
    expect(markup).toMatch(/<li class="[^"]*text-fg-dim[^"]*"><span[^>]*>3</);
    const classes = [
      ...new Set(
        [...markup.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => (value ?? '').split(/\s+/)),
      ),
    ].filter((name) => name !== '');
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
    const flat = css.replaceAll(/\s+/g, ' ');
    // A 22 px ball, then the step; 10 px between steps and beside the ball.
    expect(flat).toContain(
      'grid-template-columns: calc(var(--lo-sp-20) + var(--lo-sp-2)) minmax(0, 1fr)',
    );
    expect(flat).toContain('gap: calc(var(--lo-sp-12) - var(--lo-sp-2))');
    expect(flat).toContain('box-shadow: inset 0 0 0 1.5px var(--lo-border-strong)');
  });
});
