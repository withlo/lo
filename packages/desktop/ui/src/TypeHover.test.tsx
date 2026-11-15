// @vitest-environment jsdom
// The type hover card: a signature, the docs a language server wrote drawn through `@lo/markdown`
// with their images as links, where the answer came from, and what the card says while the server
// is still starting.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { markdownTree, type Tree } from '@lo/markdown';

import { buildCss, declarations } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, render } from '../test/dom.ts';
import { TypeHover, TypeHoverWaiting } from './TypeHover.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const SIGNATURE = 'const report: CostReport';
const TYPESCRIPT = { kind: 'server', name: 'TypeScript' } as const;

/** CSS on one line, its runs of space as one space. */
function squash(css: string): string {
  return css.replace(/\s+/g, ' ');
}
const DOCS = markdownTree(
  [
    "What `estimateCost` found: the query's total cost and each field's share.",
    '',
    '![A chart of the cost](https://user-images.githubusercontent.com/1/chart.png)',
    '',
    'See [the limits](https://example.com/limits).',
  ].join('\n'),
);

/** Docs with every part of Markdown that takes focus or scrolls on its own. */
const HEAVY_TEXT = markdownTree(
  [
    'See [the limits](https://example.com/limits)[^1] and ![A chart](https://user-images.githubusercontent.com/1/chart.png).',
    '```ts\nconst estimate = estimateCost(schema, document, { operationName: "Pull", weights });\n```',
    '| field | cost |\n| --- | --- |\n| a_name_much_too_long_for_its_share_of_the_card | 1 |',
    '[^1]: A note on the limits.',
  ].join('\n\n'),
);
const HEAVY: Tree = {
  ...HEAVY_TEXT,
  blocks: [
    ...HEAVY_TEXT.blocks,
    // What `githubTree` makes of a `<details>` block.
    {
      kind: 'details',
      open: false,
      summary: [{ kind: 'text', value: 'Details' }],
      children: [
        { kind: 'paragraph', children: [{ kind: 'text', value: 'The fold holds more text.' }] },
      ],
    },
  ],
};

/** What a keyboard can land on inside `root`: a stop for `Tab`, a link, a button, a fold's title. */
const STOPS = 'a, button, input, select, textarea, summary, [contenteditable], [tabindex]';

/** The stops in `root` that `Tab` reaches: those with a `tabindex` of 0 or more, or none to need one. */
function tabStops(root: Element): Element[] {
  return [...root.querySelectorAll(STOPS)].filter((stop) => {
    const index = stop.getAttribute('tabindex');
    return index === null || Number(index) >= 0;
  });
}

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

  it('colours a signature’s stretches by their tokens', () => {
    const host = render(
      <TypeHover
        signature={[
          { text: 'const', token: 'keyword' },
          { text: ' report: ' },
          { text: 'CostReport', token: 'type' },
        ]}
        source={TYPESCRIPT}
      />,
    );
    expect(host.querySelector('.lo-syn-keyword')?.textContent).toBe('const');
    expect(host.querySelector('.lo-syn-type')?.textContent).toBe('CostReport');
    expect(host.querySelector('[role="tooltip"]')?.firstElementChild?.textContent).toBe(
      'const report: CostReport',
    );
  });

  it('shows a link and an image in the docs as their words, with nothing to follow', () => {
    const host = render(<TypeHover signature={SIGNATURE} docs={DOCS} source={TYPESCRIPT} />);
    const card = host.querySelector('[role="tooltip"]')!;
    // An image is only its words: a hover loads nothing, and holds nothing to press.
    expect(host.querySelector('img, picture, source')).toBeNull();
    expect(card.querySelector('a, [role="link"]')).toBeNull();
    expect(card.textContent).toContain('A chart of the cost');
    expect(card.textContent).toContain('See the limits.');
  });

  it('holds nothing a keyboard can land on, whatever the docs hold', () => {
    const host = render(
      <TypeHover
        signature={`export function ${'estimate'.repeat(30)}(schema: GraphQLSchema): CostReport`}
        docs={HEAVY}
        source={TYPESCRIPT}
        location={{ path: 'a.ts', line: 1 }}
      />,
    );
    const card = host.querySelector('[role="tooltip"]')!;
    // The docs held a link, a footnote link, an image, a fold, code and a table.
    expect(card.textContent).toContain('the limits');
    expect(card.textContent).toContain('Details');
    expect(card.querySelector('pre')).not.toBeNull();
    expect(card.querySelector('table')).not.toBeNull();
    // A part that scrolls can't be a stop: it is told it isn't one, so `Tab` goes past the card.
    for (const part of card.querySelectorAll('.typehover-part')) {
      expect(part.getAttribute('tabindex')).toBe('-1');
    }
    expect(tabStops(card)).toEqual([]);
    // Nor does the card itself take focus.
    expect(card.hasAttribute('tabindex')).toBe(false);
  });

  it('draws a fold as its title over what it holds, open, since a card has no way to open one', () => {
    const host = render(<TypeHover signature={SIGNATURE} docs={HEAVY} source={TYPESCRIPT} />);
    const card = host.querySelector('[role="tooltip"]')!;
    expect(card.querySelector('details, summary')).toBeNull();
    expect(card.textContent).toContain('DetailsThe fold holds more text.');
  });

  it('wraps the docs and the signature to the card instead of scrolling them sideways', async () => {
    const host = render(<TypeHover signature={SIGNATURE} docs={HEAVY} source={TYPESCRIPT} />);
    const card = host.querySelector('[role="tooltip"]')!;
    const parts = card.querySelectorAll('.typehover-part');
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part.classList.contains('wrap-anywhere')).toBe(true);
    // Code and tables, which the Markdown scrolls on its own, are clipped and wrapped here.
    const docs = card.querySelector('.typehover-docs')!;
    expect(docs.querySelector('pre.overflow-x-auto')).not.toBeNull();
    expect(docs.querySelector('div.overflow-x-auto > table')).not.toBeNull();
    const css = squash(await buildCss(['typehover-docs', 'wrap-anywhere']));
    expect(css).toContain('.wrap-anywhere { overflow-wrap: anywhere; }');
    expect(css).toContain('.typehover-docs pre { white-space: pre-wrap; }');
    expect(css).toContain('.typehover-docs table { width: 100%; table-layout: fixed; }');
    expect(css).toContain('.typehover-docs .overflow-x-auto { overflow-x: clip; }');
  });

  it('shows the control characters in what a server wrote', () => {
    const host = render(
      <TypeHover
        signature={[{ text: 'const evil\u202Elive: string' }, { text: ' = 1', token: 'keyword' }]}
        docs={markdownTree('Open `evil\u202Elive` or [evil\u2066live](https://example.com/x).')}
        source={{ kind: 'server', name: 'Type\u202EScript' }}
        location={{ path: 'src/evil\u202Egnp.ts', line: 3 }}
      />,
    );
    const text = host.textContent ?? '';
    expect(text).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    expect(text).toContain('const evil\uFFFDlive: string = 1');
    expect(text).toContain('Open evil\uFFFDlive or evil\uFFFDlive.');
    expect(text).toContain('Type\uFFFDScript');
    expect(text).toContain('src/evil\uFFFDgnp.ts:3');
    // A plain string signature shows them too.
    const plain = render(<TypeHover signature={'a\u202Eb'} source={TYPESCRIPT} />);
    expect(plain.textContent).toContain('a\uFFFDb');
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
    expect(tabStops(card)).toEqual([]);
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
