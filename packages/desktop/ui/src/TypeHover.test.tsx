// @vitest-environment jsdom
// The type hover card: a signature, the docs a language server wrote drawn through `@lo/markdown`
// with their images as links, where the answer came from, and what the card says while the server
// is still starting.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { markdownTree } from '@lo/markdown';

import { buildCss, declarations } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, click, render } from '../test/dom.ts';
import { TypeHover, TypeHoverWaiting } from './TypeHover.tsx';
import type { Followed } from './markdown/index.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const SIGNATURE = 'const report: CostReport';
const TYPESCRIPT = { kind: 'server', name: 'TypeScript' } as const;
const DOCS = markdownTree(
  [
    "What `estimateCost` found: the query's total cost and each field's share.",
    '',
    '![A chart of the cost](https://user-images.githubusercontent.com/1/chart.png)',
    '',
    'See [the limits](https://example.com/limits).',
  ].join('\n'),
);

function foot(host: HTMLElement): string {
  return host.querySelector('[role="tooltip"] > :last-child')?.textContent ?? '';
}

describe('TypeHover', () => {
  it('shows the signature as code, and the docs under it, with where they came from', () => {
    const host = render(
      <TypeHover signature={SIGNATURE} docs={DOCS} source={TYPESCRIPT} keys={{ close: ['Esc'] }} />,
    );
    const card = host.querySelector('[role="tooltip"]')!;
    expect(card.firstElementChild?.textContent).toBe(SIGNATURE);
    expect(card.firstElementChild?.className).toContain('code-small');
    expect(card.textContent).toContain("What estimateCost found: the query's total cost");
    expect(card.querySelector('code')?.textContent).toBe('estimateCost');
    expect(foot(host)).toBe('TypeScriptEsc Close');
  });

  it('draws a signature that is already highlighted as it is given', () => {
    const host = render(
      <TypeHover
        signature={
          <>
            <span className="lo-syn-keyword">const</span> report
          </>
        }
        source={TYPESCRIPT}
      />,
    );
    expect(host.querySelector('.lo-syn-keyword')?.textContent).toBe('const');
    expect(host.querySelector('[role="tooltip"]')?.firstElementChild?.textContent).toBe(
      'const report',
    );
  });

  it('shows an image in the docs as a link to it, and loads nothing', () => {
    const onFollow = vi.fn<(target: Followed, from: Element) => void>();
    const host = render(
      <TypeHover signature={SIGNATURE} docs={DOCS} source={TYPESCRIPT} onFollow={onFollow} />,
    );
    expect(host.querySelector('img, picture, source')).toBeNull();
    const links = [...host.querySelectorAll('a')];
    const image = links.find((link) => link.textContent === 'A chart of the cost');
    expect(image).toBeDefined();
    // A link has no address on the page: following it hands the target to the caller.
    expect(image?.hasAttribute('href')).toBe(false);
    click(image!);
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(onFollow.mock.calls[0]?.[0]).toEqual({
      kind: 'web',
      url: 'https://user-images.githubusercontent.com/1/chart.png',
    });
  });

  it('says a language server found no docs, and where the word is declared', () => {
    const host = render(
      <TypeHover
        signature="(method) TokenBucket.take(points: number): boolean"
        source={TYPESCRIPT}
        location={{ path: 'packages/ratelimit/src/bucket.ts', line: 52 }}
        keys={{ definition: ['g', 'd'], close: ['Esc'] }}
      />,
    );
    expect(foot(host)).toBe(
      'TypeScript · No doc comment' +
        'packages/ratelimit/src/bucket.ts:52' +
        'gd Definition' +
        'Esc Close',
    );
    // With nothing under the signature, the foot has its own hairline.
    const card = host.querySelector('[role="tooltip"]')!;
    expect(card.children).toHaveLength(2);
  });

  it('empty docs say no doc comment too, and leave the card as short', () => {
    const host = render(
      <TypeHover signature={SIGNATURE} docs={markdownTree('')} source={TYPESCRIPT} />,
    );
    expect(host.querySelector('[role="tooltip"]')?.children).toHaveLength(2);
    expect(foot(host)).toBe('TypeScript · No doc comment');
  });

  it('labels the syntax index’s answer by its name, and says nothing of docs it has none of', () => {
    const host = render(
      <TypeHover
        signature="export function estimateCost("
        source={{ kind: 'syntax' }}
        location={{ path: 'src/graphql/cost/estimate.ts', line: 18 }}
        keys={{ definition: ['g', 'd'] }}
      />,
    );
    expect(foot(host)).toBe('Syntax indexsrc/graphql/cost/estimate.ts:18gd Definition');
    expect(host.textContent).not.toContain('No doc comment');
  });

  it('shows the keys it was given, and none it wasn’t', () => {
    const bare = render(<TypeHover signature={SIGNATURE} docs={DOCS} source={TYPESCRIPT} />);
    expect(bare.querySelector('[role="tooltip"] > :last-child kbd')).toBeNull();
    const keyed = render(
      <TypeHover
        signature={SIGNATURE}
        docs={DOCS}
        source={TYPESCRIPT}
        keys={{ definition: ['g', 'd'], close: ['Esc'] }}
      />,
    );
    expect([...keyed.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual([
      'g',
      'd',
      'Esc',
    ]);
  });

  it('is not a stop for focus, and says so to a screen reader as a tooltip', () => {
    const host = render(<TypeHover signature={SIGNATURE} source={TYPESCRIPT} />);
    const card = host.querySelector('[role="tooltip"]')!;
    expect(card.hasAttribute('tabindex')).toBe(false);
    expect(card.querySelector('button, input, [tabindex]')).toBeNull();
  });

  it('is 480 px wide, and no wider than the window', async () => {
    const css = await buildCss(['typehover', 'typehover-part']);
    expect(declarations(css, 'typehover')).toBe(
      'width: 480px; max-width: calc(100vw - var(--lo-sp-32));',
    );
    expect(declarations(css, 'typehover-part')).toBe('max-height: 12lh; overflow-y: auto;');
    const host = render(<TypeHover signature={SIGNATURE} docs={DOCS} source={TYPESCRIPT} />);
    // Its signature and its docs each scroll rather than grow the card past what it can show.
    expect(host.querySelectorAll('.typehover-part')).toHaveLength(2);
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <>
        <TypeHover
          signature={SIGNATURE}
          docs={DOCS}
          source={TYPESCRIPT}
          location={{ path: 'a.ts', line: 1 }}
          keys={{ definition: ['g', 'd'], close: ['Esc'] }}
        />
        <TypeHover signature={SIGNATURE} source={{ kind: 'syntax' }} />
        <TypeHoverWaiting server="TypeScript" known={{ name: 'take', kind: 'method' }} />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});

describe('TypeHoverWaiting', () => {
  it('says the server is still starting, and what the syntax index knows of the word', () => {
    const host = render(
      <TypeHoverWaiting server="TypeScript" known={{ name: 'take', kind: 'method' }} />,
    );
    const card = host.querySelector('[role="tooltip"]')!;
    expect(card.textContent).toBe(
      'TypeScript is still starting. The syntax index knows take as a method.',
    );
    expect(card.querySelector('code')?.textContent).toBe('take');
    // The wait is a ring turning, and says nothing to a screen reader the words don't.
    expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('writes “an” before a kind that starts with a vowel', () => {
    const host = render(
      <TypeHoverWaiting server="Go" known={{ name: 'Reader', kind: 'interface' }} />,
    );
    expect(host.textContent).toBe(
      'Go is still starting. The syntax index knows Reader as an interface.',
    );
  });

  it('says only that it is starting when the syntax index has nothing', () => {
    const host = render(<TypeHoverWaiting server="Python" />);
    expect(host.textContent).toBe('Python is still starting.');
  });
});
