import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { Toast, ToastRegion } from './Toast.tsx';

const icon = (
  <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" />
  </svg>
);

/** A toast with all of its parts, as the design draws an update. */
const full = (
  <ToastRegion>
    <Toast
      tone="success"
      icon={icon}
      title="Lo 0.10 is ready"
      body="It installs when you quit, or now."
      actions={<button type="button">Restart now</button>}
    />
  </ToastRegion>
);

describe('Toast', () => {
  it('draws an icon, a title, a body and buttons, in the order the design puts them', () => {
    const markup = renderToStaticMarkup(full);
    const order = ['<svg', 'Lo 0.10 is ready', 'It installs when you quit', 'Restart now'];
    expect(order.map((part) => markup.indexOf(part))).toEqual(
      order.map((part) => markup.indexOf(part)).toSorted((a, b) => a - b),
    );
    expect(order.every((part) => markup.includes(part))).toBe(true);
    // The title is in the second column beside the icon; the body and buttons under it.
    expect(markup).toMatch(/<div class="font-semibold">Lo 0\.10 is ready<\/div>/);
    expect(markup).toMatch(/<div class="col-start-2 [^"]*text-small">It installs/);
    expect(markup).toMatch(/<div class="col-start-2 mt-8 flex gap-6"><button/);
  });

  it('colors the icon by its tone, and leaves out the body and buttons it hasn’t got', () => {
    const markup = renderToStaticMarkup(<Toast tone="danger" icon={icon} title="Nothing merged" />);
    expect(markup).toContain('class="flex-none text-danger"');
    expect(markup).not.toContain('col-start-2');
  });

  it('floats in a live region that is there with nothing in it', () => {
    const empty = renderToStaticMarkup(<ToastRegion />);
    expect(empty).toBe('<div role="status" aria-atomic="true" class="toast-floating"></div>');
  });

  it("only uses utilities that Lo's stylesheet has, and gives the design's measures", async () => {
    const markup = renderToStaticMarkup(full);
    const classes = [
      ...new Set(
        [...markup.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => (value ?? '').split(/\s+/)),
      ),
    ].filter((name) => name !== '' && !name.startsWith('lo-'));
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
    // 12 px above and below, 10 px at the end and 14 at the start, from Lo's steps; 16 px from the
    // right, 12 px above the status bar.
    const flat = css.replaceAll(/\s+/g, ' ');
    expect(flat).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
    expect(flat).toContain('gap: var(--lo-sp-2) var(--lo-sp-12)');
    expect(flat).toContain(
      'padding: var(--lo-sp-12) calc(var(--lo-sp-12) - var(--lo-sp-2)) var(--lo-sp-12) calc(var(--lo-sp-12) + var(--lo-sp-2))',
    );
    expect(flat).toContain('bottom: calc(var(--lo-statusbar-h) + var(--lo-sp-12))');
    expect(flat).toContain('right: var(--lo-sp-16)');
  });
});
