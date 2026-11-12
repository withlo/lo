// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { githubTree, markdownTree, type Block, type Inline, type Tree } from '@lo/markdown';

import { buildCss, hasRule } from '../../scripts/stylesheet.ts';
import { cleanUp, click, disallowed, ids, press, render } from '../../test/dom.ts';
import {
  Anchors,
  drawBlock,
  isMarkdownAttribute,
  Markdown,
  MARKDOWN_ELEMENTS,
  type Followed,
  type Rendering,
} from './index.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(cleanUp);

// The base is named first: under jsdom, Vite rewrites `new URL('…', import.meta.url)` into an
// address on its dev server.
const here = import.meta.url;
const HOSTILE = new URL('../../../../../testing/fixtures/markdown/hostile/', here);
const GITHUB = new URL('../../../../../testing/fixtures/markdown/github/', here);
const OPTIONS = {
  page: 'https://github.com/octo/repo/pull/1',
  repo: { owner: 'octo', name: 'repo' },
};

function tree(blocks: Block[], notes: Tree['notes'] = []): Tree {
  return { blocks, notes, diagnostics: [] };
}

const text = (value: string): Inline => ({ kind: 'text', value });
const paragraph = (...children: Inline[]): Block => ({ kind: 'paragraph', children });

/** One of each block, so a kind `@lo/markdown` adds fails to compile here until it has a sample. */
const BLOCKS: { [K in Block['kind']]: Extract<Block, { kind: K }> } = {
  paragraph: { kind: 'paragraph', children: [text('A paragraph.')] },
  heading: { kind: 'heading', level: 3, anchor: 'a-heading', children: [text('A heading')] },
  quote: { kind: 'quote', children: [paragraph(text('Quoted.'))] },
  alert: { kind: 'alert', type: 'warning', children: [paragraph(text('Careful.'))] },
  list: {
    kind: 'list',
    ordered: true,
    start: 3,
    tight: true,
    items: [
      { children: [paragraph(text('Third'))] },
      { checked: true, children: [paragraph(text('Done'))] },
      { checked: false, children: [paragraph(text('Not done'))] },
    ],
  },
  code: { kind: 'code', language: 'ts', text: 'const a = 1;\nconst b = 2;' },
  table: {
    kind: 'table',
    align: ['left', 'right'],
    head: [[text('Name')], [text('Count')]],
    rows: [[[text('apples')], [text('3')]]],
  },
  rule: { kind: 'rule' },
  details: {
    kind: 'details',
    open: false,
    summary: [text('More')],
    children: [paragraph(text('Behind the title.'))],
  },
  suggestion: { kind: 'suggestion', text: 'return 1;' },
  footnotes: {
    kind: 'footnotes',
    items: [{ name: 'note', number: 1, children: [paragraph(text('The note.'))] }],
  },
};

/** One of each inline node. */
const INLINES: { [K in Inline['kind']]: Extract<Inline, { kind: K }> } = {
  text: { kind: 'text', value: 'plain' },
  strong: { kind: 'strong', children: [text('strong')] },
  emphasis: { kind: 'emphasis', children: [text('emphasis')] },
  strike: { kind: 'strike', children: [text('struck')] },
  inlineCode: { kind: 'inlineCode', value: 'code()' },
  link: {
    kind: 'link',
    target: { kind: 'web', url: 'https://example.com/' },
    children: [text('a link')],
  },
  image: { kind: 'image', url: 'https://camo.githubusercontent.com/a', alt: 'a picture' },
  break: { kind: 'break' },
  sub: { kind: 'sub', children: [text('sub')] },
  sup: { kind: 'sup', children: [text('sup')] },
  kbd: { kind: 'kbd', children: [text('Ctrl')] },
  mention: { kind: 'mention', name: 'octocat', url: 'https://github.com/octocat' },
  footnoteReference: { kind: 'footnoteReference', name: 'note', number: 1 },
};

function everyKind(): Tree {
  return tree([...Object.values(BLOCKS), paragraph(...Object.values(INLINES))]);
}

describe('Markdown', () => {
  it('draws every kind of block and inline node as its own element', () => {
    const page = render(<Markdown tree={everyKind()} />);
    const expected: Record<Block['kind'], string> = {
      paragraph: 'p',
      heading: 'h3',
      quote: 'blockquote',
      alert: 'div[role="note"]',
      list: 'ol[start="3"]',
      code: 'pre > code',
      table: 'table th.text-right',
      rule: 'hr',
      details: 'details.lo-fold > summary',
      suggestion: 'div > p + pre > code',
      footnotes: 'section[aria-label="Footnotes"] li',
    };
    expect(missing(page, expected)).toEqual([]);
    const inline: Record<Inline['kind'], string> = {
      text: 'p',
      strong: 'strong',
      emphasis: 'em',
      strike: 'del',
      inlineCode: 'p > code',
      link: 'a[role="link"]',
      image: 'a[role="link"]',
      break: 'br',
      sub: 'sub',
      sup: 'sup',
      kbd: 'kbd',
      mention: 'a[role="link"]',
      footnoteReference: 'sup > a[aria-label="Footnote 1"]',
    };
    expect(missing(page, inline)).toEqual([]);
    const words = page.textContent;
    for (const word of ['A paragraph.', 'Quoted.', 'Warning', 'Careful.', 'Third', 'apples']) {
      expect(words).toContain(word);
    }
    expect(words).toContain('a picture');
    expect(words).toContain('@octocat');
    expect(page.querySelector('pre')?.textContent).toBe('const a = 1;\nconst b = 2;');
    expect(page.querySelector('p + pre')?.textContent).toBe('return 1;');
    // A task's mark says whether it's done, in words.
    expect(
      [...page.querySelectorAll('li [role="img"]')].map((mark) => mark.getAttribute('aria-label')),
    ).toEqual(['Done', 'Not done']);
  });

  it('draws real Markdown, as GitHub writes it, in Lo’s own elements only', () => {
    const made = markdownTree(readFileSync(new URL('constructs.md', GITHUB), 'utf8'), OPTIONS);
    const page = render(<Markdown tree={made} />);
    expect(page.querySelectorAll('*').length).toBeGreaterThan(50);
    expect(disallowed(page.firstElementChild!, allowed)).toEqual([]);
  });

  it('keeps the newlines of text that stands in for what Lo doesn’t show as line breaks', () => {
    const page = render(<Markdown tree={tree([paragraph(text('one\ntwo\nthree'))])} />);
    expect(page.querySelector('p')?.innerHTML).toBe('one<br>two<br>three');
  });

  it('sets text only as text', () => {
    const page = render(
      <Markdown
        tree={tree([
          paragraph(text('<img src=x onerror=alert(1)>'), { kind: 'inlineCode', value: '<b>' }),
        ])}
      />,
    );
    expect(page.querySelector('img, b')).toBeNull();
    expect(page.querySelector('p')?.textContent).toBe('<img src=x onerror=alert(1)><b>');
  });

  it('says how the text is shown when it was cut or flattened', () => {
    const page = render(
      <Markdown tree={tree([paragraph(text('A.'))], ['cut', 'deep', 'nodes'])} />,
    );
    expect([...page.querySelectorAll('[role="note"]')].map((note) => note.textContent)).toEqual([
      'This is too long to show whole, so only its start is here.',
      'Some of this nests too deeply to show, so it shows as plain text.',
      'This holds too much to show whole, so the rest shows as plain text.',
    ]);
  });

  it('refuses a kind of node it doesn’t know, rather than drawing it', () => {
    const rendering: Rendering = {
      anchors: new Anchors('lo-mdtest', []),
      follow: () => undefined,
      extension: {},
      interactive: true,
    };
    // Nodes no tree holds, as a tree that came across from another process might.
    const node: Block = JSON.parse('{"kind":"script","children":[]}');
    expect(() => drawBlock(node, rendering)).toThrow(/"script"/);
    const inline = paragraph(JSON.parse('{"kind":"iframe"}'));
    expect(() => renderToStaticMarkup(<Markdown tree={tree([inline])} />)).toThrow(/"iframe"/);
  });
});

function followed() {
  const onFollow = vi.fn<(target: Followed, from: Element) => void>();
  const link = (url: string, words: string): Inline => ({
    kind: 'link',
    target: { kind: 'web', url },
    children: [text(words)],
  });
  const page = render(
    <Markdown
      tree={tree([
        paragraph(
          link('https://example.com/a', 'secure'),
          text(' '),
          link('http://example.com/b', 'plain'),
        ),
        paragraph({
          kind: 'image',
          url: 'https://user-images.githubusercontent.com/1/a.png',
          alt: '',
        }),
      ])}
      onFollow={onFollow}
    />,
  );
  return { page, onFollow };
}

/** A link to `url`, its text the address. */
const web = (url: string): Inline => ({
  kind: 'link',
  target: { kind: 'web', url },
  children: [text(url)],
});

describe('links', () => {
  it('hands an https:// page to whoever shows the text, by a click or ⏎, and has no address', () => {
    const { page, onFollow } = followed();
    const links = [...page.querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual(['secure', 'Image']);
    click(links[0]!);
    press(links[0]!, 'Enter');
    expect(onFollow.mock.calls.map(([target]) => target)).toEqual([
      { kind: 'web', url: 'https://example.com/a' },
      { kind: 'web', url: 'https://example.com/a' },
    ]);
    expect(onFollow.mock.calls[0]?.[1]).toBe(links[0]);
    // An image shows as a link to itself, and loads nothing.
    click(links[1]!);
    expect(onFollow).toHaveBeenLastCalledWith(
      { kind: 'web', url: 'https://user-images.githubusercontent.com/1/a.png' },
      links[1],
    );
    expect(page.querySelector('[href], [src], img')).toBeNull();
    // Links take focus, and say they're links.
    expect(links.every((link) => link.tabIndex === 0 && link.getAttribute('role') === 'link')).toBe(
      true,
    );
  });

  it('shows a plain http:// page as its text, which no key or click follows', () => {
    const { page, onFollow } = followed();
    const words = [...page.querySelectorAll('p')][0]!;
    expect(words.textContent).toBe('secure plain');
    expect([...words.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['secure']);
    click(words);
    expect(onFollow).not.toHaveBeenCalled();
  });

  it('never makes a link of an address that isn’t an https:// page, even one put in a tree', () => {
    const onFollow = vi.fn<(target: Followed, from: Element) => void>();
    const addresses = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'blob:https://example.com/x',
      'https://user:secret@example.com/',
      '//example.com/',
    ];
    const page = render(
      <Markdown
        tree={tree([
          paragraph(...addresses.map(web)),
          paragraph(
            ...addresses.map((url): Inline => ({ kind: 'image', url, alt: 'pic' })),
            ...addresses.map((url): Inline => ({ kind: 'mention', name: 'who', url })),
          ),
        ])}
        onFollow={onFollow}
      />,
    );
    expect(page.querySelector('a')).toBeNull();
    for (const element of page.querySelectorAll('*')) {
      for (const { value } of element.attributes) expect(value).not.toMatch(/:|\/\//);
    }
    for (const element of page.querySelectorAll('p')) click(element);
    expect(onFollow).not.toHaveBeenCalled();
    // Each shows as its words, which are only text.
    expect(page.querySelector('p')?.textContent).toBe(addresses.join(''));
  });

  it('leaves out ⏎ with a modifier, which is a key of Lo’s own', () => {
    const { page, onFollow } = followed();
    press(page.querySelector('a')!, 'Enter', { metaKey: true });
    expect(onFollow).not.toHaveBeenCalled();
  });
});

const heading = (anchor: string, words: string): Block => ({
  kind: 'heading',
  level: 2,
  anchor,
  children: [text(words)],
});
const toAnchor = (name: string, words: string): Inline => ({
  kind: 'link',
  target: { kind: 'anchor', name },
  children: [text(words)],
});
const scoped = (): Tree =>
  tree([
    heading('root', 'Root'),
    heading('lo-app', 'Lo app'),
    paragraph(toAnchor('lo-app', 'up'), text(' '), {
      kind: 'footnoteReference',
      name: 'root-1',
      number: 1,
    }),
    {
      kind: 'footnotes',
      items: [{ name: 'root-1', number: 1, children: [paragraph(text('Note.'))] }],
    },
  ]);

describe('anchors', () => {
  it('gives every anchor an id of the document’s own, never its name', () => {
    const page = render(<Markdown tree={scoped()} />);
    const found = ids(page);
    expect(found).toHaveLength(3);
    for (const id of found) {
      expect(id).toMatch(/^lo-md[\w-]+-a\d+$/);
      expect(['root', 'lo-app', 'root-1']).not.toContain(id);
    }
    expect(page.ownerDocument.getElementById('root')).toBeNull();
  });

  it('keeps two documents’ anchors apart, and follows each to its own', () => {
    const first = render(<Markdown tree={scoped()} />);
    const onFollow = vi.fn<(target: Followed, from: Element) => void>();
    const second = render(<Markdown tree={scoped()} onFollow={onFollow} />);
    const all = [...ids(first), ...ids(second)];
    expect(new Set(all).size).toBe(all.length);

    press(second.querySelector('a')!, 'Enter');
    expect(document.activeElement).toBe(second.querySelectorAll('h2')[1]);
    expect(onFollow).toHaveBeenCalledWith({ kind: 'anchor', name: 'lo-app' }, expect.anything());
    click(second.querySelector('sup a')!);
    expect(document.activeElement).toBe(second.querySelector('section li'));
    expect(first.contains(document.activeElement)).toBe(false);
  });

  it('shows a link to an anchor the document lacks as its text', () => {
    const page = render(<Markdown tree={tree([paragraph(toAnchor('nowhere', 'gone'))])} />);
    expect(page.querySelector('a')).toBeNull();
    expect(page.textContent).toBe('gone');
  });
});

describe('folds', () => {
  it('opens and closes by its title, with a click or ⏎, starting as the text says', () => {
    const page = render(
      <Markdown tree={tree([BLOCKS.details, { ...BLOCKS.details, open: true }])} />,
    );
    const [closed, open] = [...page.querySelectorAll('details')];
    expect([closed?.open, open?.open]).toEqual([false, true]);
    const summary = closed!.querySelector('summary')!;
    press(summary, 'Enter');
    expect(closed?.open).toBe(true);
    press(summary, 'Enter');
    expect(closed?.open).toBe(false);
    click(summary);
    expect(closed?.open).toBe(true);
    expect(closed?.textContent).toContain('Behind the title.');
  });
});

describe('hostile files', () => {
  const files = readdirSync(HOSTILE).filter(
    (name) => name.endsWith('.md') || name.endsWith('.html'),
  );

  it('there are some', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)('%s draws only what the allowlist has, and loads and runs nothing', (name) => {
    const source = readFileSync(new URL(name, HOSTILE), 'utf8');
    const made = name.endsWith('.html')
      ? githubTree({ html: source, markdown: 'fallback' }, OPTIONS)
      : markdownTree(source, OPTIONS);
    const head = document.head.innerHTML;
    const page = render(<Markdown tree={made} />);
    expect(disallowed(page, allowed)).toEqual([]);
    expect(page.querySelectorAll('[id]').length).toBe(
      page.querySelectorAll('[id^="lo-md"]').length,
    );
    // Nothing reached the document's head, such as a style sheet React hoists.
    expect(document.head.innerHTML).toBe(head);
  });
});

describe('styles', () => {
  it('uses only utilities Lo’s stylesheet has', async () => {
    const markup = renderToStaticMarkup(<Markdown tree={everyKind()} />);
    const classes = [
      ...new Set(
        [...markup.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => (value ?? '').split(/\s+/)),
      ),
    ].filter((name) => name !== '' && !name.startsWith('lo-'));
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });

  it('sets no style on any element', () => {
    const markup = renderToStaticMarkup(<Markdown tree={everyKind()} />);
    expect(markup).not.toMatch(/\sstyle=|<style/);
  });
});

/** The names of `selectors` that match nothing under `page`. */
function missing(page: Element, selectors: Record<string, string>): string[] {
  return Object.entries(selectors).flatMap(([name, selector]) =>
    page.querySelector(selector) ? [] : [name],
  );
}

/** The renderer's allowlist, with the element that holds a document. */
function allowed(element: string, attribute?: string): boolean {
  if (attribute === undefined) return Object.hasOwn(MARKDOWN_ELEMENTS, element);
  return isMarkdownAttribute(element, attribute);
}
