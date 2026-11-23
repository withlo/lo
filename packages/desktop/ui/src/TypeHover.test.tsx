// @vitest-environment jsdom
// The type hover card: a signature, the docs a language server wrote drawn through `@lo/markdown`
// with their images as links, where the answer came from, and what the card says while the server
// is still starting.

import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { markdownTree, type Tree } from '@lo/markdown';

import { buildCss, declarations } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, focus, render } from '../test/dom.ts';
import { hoverLinks } from './hoverDocs.ts';
import { TypeHover, TypeHoverWaiting, type HighlightCode } from './TypeHover.tsx';

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

/** The end of a press: what the browser does with a button that lets go. */
function release(): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
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

  it('shows a link and an image in the docs as their words and where they go, with nothing to follow', () => {
    const host = render(<TypeHover signature={SIGNATURE} docs={DOCS} source={TYPESCRIPT} />);
    const card = host.querySelector('[role="tooltip"]')!;
    // An image is only its words: a hover loads nothing, and holds nothing to press.
    expect(host.querySelector('img, picture, source')).toBeNull();
    expect(card.querySelector('a, [role="link"]')).toBeNull();
    // Each says where it goes, as code the reader can read: the words of a link can say anything.
    expect(card.textContent).toContain(
      'A chart of the cost (https://user-images.githubusercontent.com/1/chart.png)',
    );
    expect(card.textContent).toContain('See the limits (https://example.com/limits).');
    expect([...card.querySelectorAll('code')].map((code) => code.textContent).slice(-2)).toEqual([
      'https://user-images.githubusercontent.com/1/chart.png',
      'https://example.com/limits',
    ]);
  });

  it('shows where a link goes however it is written, and says an address once', () => {
    const docs = markdownTree(
      [
        '[github.com](https://evil\u0435xample.com/x) and [plain](http://example.com/a).',
        'Bare https://example.com/b and <https://example.com/c> and [here](#top).',
      ].join('\n\n'),
    );
    const host = render(<TypeHover signature={SIGNATURE} docs={docs} source={TYPESCRIPT} />);
    const text = host.textContent ?? '';
    // A lookalike host reads as punycode, and a page Lo won't open still shows where it goes.
    expect(text).toContain('github.com (https://xn--evilxample-nsi.com/x)');
    expect(text).toContain('plain (http://example.com/a)');
    // A link whose words are its address doesn't say it twice, and an anchor has none to say.
    expect(text).toContain('Bare https://example.com/b and https://example.com/c and here.');
  });

  it('lists the links it shows for a key to open, the ones Lo can open, each address once', () => {
    expect(hoverLinks(DOCS)).toEqual([
      {
        text: 'A chart of the cost',
        url: 'https://user-images.githubusercontent.com/1/chart.png',
        image: true,
      },
      { text: 'the limits', url: 'https://example.com/limits', image: false },
    ]);
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
    // Nothing has a `tabindex` of any kind, so `Tab` goes past the card and a click can't focus it.
    expect(card.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(tabStops(card)).toEqual([]);
    expect(card.hasAttribute('tabindex')).toBe(false);
  });

  it('has nothing in it that can take focus, so asking each part to changes nothing', () => {
    const host = render(
      <>
        <button type="button" id="elsewhere">
          Elsewhere
        </button>
        <TypeHover signature={SIGNATURE} docs={HEAVY} source={TYPESCRIPT} />
        <TypeHoverWaiting server="TypeScript" />
      </>,
    );
    const elsewhere = host.querySelector<HTMLElement>('#elsewhere')!;
    focus(elsewhere);
    for (const part of host.querySelectorAll<HTMLElement>('[role="tooltip"] *')) part.focus();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('gives focus back to where it was once a click in it is over, and keeps what was selected', () => {
    const host = render(
      <>
        <button type="button" id="elsewhere">
          Elsewhere
        </button>
        <TypeHover signature={SIGNATURE} docs={DOCS} source={TYPESCRIPT} />
        <TypeHoverWaiting server="TypeScript" />
      </>,
    );
    const elsewhere = host.querySelector<HTMLElement>('#elsewhere')!;
    // What the browser does with a press on text: the button loses focus, and the press selects.
    const press = (target: Element) => {
      act(() => {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        elsewhere.blur();
      });
    };
    const paragraph = host.querySelector('.typehover-docs p')!;
    focus(elsewhere);
    press(paragraph);
    expect(document.activeElement).toBe(document.body);
    // The press is still on, so it can still select.
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    release();
    expect(document.activeElement).toBe(elsewhere);
    expect(document.getSelection()?.toString()).toContain('What estimateCost found');

    // The waiting card too, and a press that began with nothing focused changes nothing.
    document.getSelection()?.removeAllRanges();
    focus(elsewhere);
    press(host.querySelector('[role="tooltip"]:last-child')!);
    release();
    expect(document.activeElement).toBe(elsewhere);
    act(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    press(paragraph);
    release();
    expect(document.activeElement).toBe(document.body);
  });

  it('scrolls its parts by the wheel, which is all that reaches them, and lets it through at the ends', () => {
    const host = render(<TypeHover signature={SIGNATURE} docs={HEAVY} source={TYPESCRIPT} />);
    const part = host.querySelector<HTMLElement>('.typehover-docs')!;
    let top = 0;
    Object.defineProperties(part, {
      scrollHeight: { value: 300 },
      clientHeight: { value: 100 },
      scrollTop: {
        get: () => top,
        set: (value: number) => {
          top = value;
        },
      },
    });
    const wheel = (deltaY: number) => {
      const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
      act(() => {
        part.dispatchEvent(event);
      });
      return event;
    };
    expect(wheel(60).defaultPrevented).toBe(true);
    expect(top).toBe(60);
    // Past the end it stops there, and at the end the wheel goes on to what is behind.
    expect(wheel(500).defaultPrevented).toBe(true);
    expect(top).toBe(200);
    expect(wheel(40).defaultPrevented).toBe(false);
    expect(wheel(-500).defaultPrevented).toBe(true);
    expect(top).toBe(0);
    expect(wheel(-40).defaultPrevented).toBe(false);
  });

  it('colours a code block in the docs with the runs the caller gives, and only colours it', () => {
    const docs = markdownTree('```ts\nconst a = 1;\n```');
    const highlight = vi.fn<HighlightCode>(({ text }) =>
      text === 'const a = 1;'
        ? [
            { text: 'const', token: 'keyword' },
            { text: ' a = ' },
            { text: '1', token: 'number' },
            { text: ';' },
          ]
        : undefined,
    );
    const host = render(
      <TypeHover signature={SIGNATURE} docs={docs} source={TYPESCRIPT} highlight={highlight} />,
    );
    expect(highlight).toHaveBeenCalledWith({ text: 'const a = 1;', language: 'ts' });
    const code = host.querySelector('pre code')!;
    expect(code.textContent).toBe('const a = 1;');
    expect([...code.querySelectorAll('span')].map((span) => span.className)).toEqual([
      'lo-syn-keyword',
      'lo-syn-number',
    ]);
    // It is still only text: nothing in the card can be pressed.
    expect(tabStops(host.querySelector('[role="tooltip"]')!)).toEqual([]);
  });

  it('leaves a code block plain when the runs do not add up to its text, or there are none', () => {
    const docs = markdownTree('```\nlet x;\n```');
    const wrong = render(
      <TypeHover
        signature={SIGNATURE}
        docs={docs}
        source={TYPESCRIPT}
        highlight={() => [{ text: 'let', token: 'keyword' }]}
      />,
    );
    expect(wrong.querySelector('pre code')?.textContent).toBe('let x;');
    expect(wrong.querySelector('pre [class^="lo-syn"]')).toBeNull();
    const none = render(<TypeHover signature={SIGNATURE} docs={docs} source={TYPESCRIPT} />);
    expect(none.querySelector('pre code')?.textContent).toBe('let x;');
    // A code block shows a hidden character in it too, as a name does.
    const hidden = render(
      <TypeHover
        signature={SIGNATURE}
        docs={markdownTree('```\nfo\u200Bo\n```')}
        source={TYPESCRIPT}
      />,
    );
    expect(hidden.querySelector('pre code')?.textContent).toBe('foU+200Bo');
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
    // Code wraps, and a table the Markdown scrolls on its own is clipped here and shares its width.
    const docs = card.querySelector('.typehover-docs')!;
    expect(docs.querySelector('pre')?.className).toContain('whitespace-pre-wrap');
    expect(docs.querySelector('div.overflow-x-auto > table')).not.toBeNull();
    const css = squash(await buildCss(['typehover-docs', 'wrap-anywhere']));
    expect(css).toContain('.wrap-anywhere { overflow-wrap: anywhere; }');
    expect(css).toContain('.typehover-docs pre { white-space: pre-wrap; }');
    expect(css).toContain('.typehover-docs table { width: 100%; table-layout: fixed; }');
    expect(css).toContain('.typehover-docs .overflow-x-auto { overflow-x: clip; }');
  });

  it('reads each paragraph of the docs in the direction of its own text', () => {
    const docs = markdownTree('English first.\n\n\u05E9\u05DC\u05D5\u05DD\n\nA third.');
    const host = render(<TypeHover signature={SIGNATURE} docs={docs} source={TYPESCRIPT} />);
    const paragraphs = [...host.querySelectorAll('.typehover-docs p')];
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.map((paragraph) => paragraph.getAttribute('dir'))).toEqual([
      'auto',
      'auto',
      'auto',
    ]);
  });

  it('keeps the format characters that scripts and emoji need in the docs, and shows the rest', () => {
    const kept = ['\u200E', '\u200F', '\u061C', '\u200D', '\u200C'];
    const prose = `a${kept.join('b')}z`;
    const shown = [
      '\u202A',
      '\u202B',
      '\u202C',
      '\u202D',
      '\u202E',
      '\u2066',
      '\u2067',
      '\u2068',
      '\u2069',
    ];
    const docs = markdownTree(
      `${prose}\n\n${shown.map((mark) => `x${mark}y`).join(' ')}\n\nzero\u200Bwidth tag\u{E0041}s`,
    );
    const host = render(<TypeHover signature={SIGNATURE} docs={docs} source={TYPESCRIPT} />);
    const [first, second, third] = [...host.querySelectorAll('.typehover-docs p')];
    // Right-to-left text and emoji sequences keep what they are written with.
    expect(first?.textContent).toBe(prose);
    // Everything that reorders text around it, the embeddings, overrides and isolates, is shown.
    expect(second?.textContent).toBe(
      'xU+202Ay xU+202By xU+202Cy xU+202Dy xU+202Ey xU+2066y xU+2067y xU+2068y xU+2069y',
    );
    expect([...second!.querySelectorAll('code')]).toHaveLength(9);
    // So is what hides: a zero-width space, a tag character.
    expect(third?.textContent).toBe('zeroU+200Bwidth tagU+E0041s');
    expect(host.querySelector('.typehover-docs')?.textContent).not.toMatch(
      /[\u202A-\u202E\u2066-\u2069\u200B]/,
    );
  });

  it('shows each format character in a signature, a source and a path as its code point', () => {
    const host = render(
      <TypeHover
        signature={[{ text: 'const evil\u202Elive: string' }, { text: ' = 1', token: 'keyword' }]}
        docs={markdownTree('Open `evil\u202Elive` or [evil\u2066live](https://example.com/x).')}
        source={{ kind: 'server', name: 'Type\u200BScript' }}
        location={{ path: 'src/evil\u202Egnp.ts', line: 3 }}
      />,
    );
    const text = host.textContent ?? '';
    expect(text).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B]/);
    expect(text).not.toContain('\uFFFD');
    // In the signature, each shows as a badge of its own and none is dropped.
    expect(host.querySelector('[role="tooltip"]')?.firstElementChild?.textContent).toBe(
      'const evilU+202Elive: string = 1',
    );
    expect(host.querySelector('[title="U+202E right-to-left override"]')).not.toBeNull();
    // Code has no room for a badge, so its mark is spelled out; prose between draws one as code.
    expect(text).toContain(
      'Open evil\u2039U+202E\u203Alive or evilU+2066live (https://example.com/x)',
    );
    expect(text).toContain('TypeU+200BScript');
    expect(text).toContain('src/evilU+202Egnp.ts:3');
    const plain = render(<TypeHover signature={'a\u202Eb'} source={TYPESCRIPT} />);
    expect(plain.textContent).toContain('aU+202Eb');
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

  it('shows docs alone when there’s no signature, as a hover that’s only prose', () => {
    const host = render(<TypeHover docs={DOCS} source={TYPESCRIPT} keys={{ close: ['Esc'] }} />);
    const card = host.querySelector('[role="tooltip"]')!;
    expect(card.children).toHaveLength(2);
    expect(card.firstElementChild?.className).not.toContain('code-small');
    expect(card.firstElementChild?.textContent).toContain('What estimateCost found');
    expect(foot(host)).toBe('TypeScriptEsc Close');
  });

  it('says why a language server didn’t answer beside the syntax index that did', () => {
    const host = render(
      <TypeHover
        signature="export interface Line {"
        source={{ kind: 'syntax' }}
        fallback="TypeScript is starting"
      />,
    );
    expect(foot(host)).toBe('Code index · TypeScript is starting');
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
    expect(foot(host)).toBe('Code indexsrc/graphql/cost/estimate.ts:18gd Definition');
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
    expect(declarations(css, 'typehover-part')).toBe('max-height: 12lh; overflow: hidden;');
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

  it('shows the format characters in the names it was given', () => {
    const host = render(
      <TypeHoverWaiting
        server={'Type\u200BScript'}
        known={{ name: 'ta\u202Eke', kind: 'method' }}
      />,
    );
    expect(host.textContent).toBe(
      'TypeU+200BScript is still starting. The syntax index knows taU+202Eke as a method.',
    );
    expect(host.querySelector('code')?.textContent).toBe('taU+202Eke');
  });

  it('says only that it is starting when the syntax index has nothing', () => {
    const host = render(<TypeHoverWaiting server="Python" />);
    expect(host.textContent).toBe('Python is still starting.');
  });
});
