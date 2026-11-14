import { describe, expect, test } from 'vitest';

import { collect, textOf } from '../test/support.ts';
import { problems, walk } from '../test/walker.ts';
import { DEFAULT_LIMITS } from './limits.ts';
import { markdownTree, type MarkdownOptions } from './markdown.ts';
import type { Plugin } from './parser.ts';
import { plainText } from './text.ts';
import type { Block, Inline, Tree } from './tree.ts';

const PAGE = 'https://github.com/octo/repo/pull/1#discussion_r1';
const REPO = { owner: 'octo', name: 'repo' };
const MAX_DEPTH = DEFAULT_LIMITS.depth;
const MAX_LENGTH = DEFAULT_LIMITS.length;
const MAX_POST_IMAGES = DEFAULT_LIMITS.images;
/** An attachment's address, as an upload writes it into a post. */
const PNG = 'https://github.com/user-attachments/assets/cbe34088-7125-49ac-b6ed-ce17762af48a';

function tree(source: string, options: MarkdownOptions = {}): Tree {
  const made = markdownTree(source, { page: PAGE, repo: REPO, ...options });
  expect(problems(made)).toEqual([]);
  return made;
}

/** The inline content of the tree's only paragraph. */
function paragraph(made: Tree): Inline[] {
  expect(made.blocks).toHaveLength(1);
  const [block] = made.blocks;
  expect(block?.kind).toBe('paragraph');
  return block?.kind === 'paragraph' ? block.children : [];
}

function web(url: string, ...children: Inline[]): Inline {
  return { kind: 'link', target: { kind: 'web', url }, children };
}

function text(value: string): Inline {
  return { kind: 'text', value };
}

/** Camo's address for `address`: a signature, then the address in hex. */
function camo(signature: string, address: string): string {
  const hex = [...new TextEncoder().encode(address)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `https://camo.githubusercontent.com/${signature}/${hex}`;
}

/** Recurses until the stack overflows. */
function deeper(): number {
  return deeper() + 1;
}

/** A plugin whose rule overflows the stack, whatever the text. */
const overflow: Plugin = (md) => {
  md.core.ruler.push('overflow', () => deeper() > 0);
};

/** A plugin that wraps every link's text in a second link. */
const wrap: Plugin = (md) => {
  md.core.ruler.push('wrap', (state) => {
    for (const block of state.tokens) {
      if (!block.children) continue;
      block.children = block.children.flatMap((token) => {
        if (token.type !== 'link_open') return [token];
        const inner = new state.Token('link_open', 'a', 1);
        inner.attrs = [['href', 'https://inner.example/']];
        return [token, inner];
      });
      block.children = block.children.flatMap((token) =>
        token.type === 'link_close' ? [new state.Token('link_close', 'a', -1), token] : [token],
      );
    }
    return true;
  });
};

describe('comments', () => {
  test('images become links to their address', () => {
    // An image Lo won't load is a link to where it is, by its alt text.
    const cat = tree('see ![a cat](https://example.com/cat.png) here');
    expect(paragraph(cat)).toEqual([
      text('see '),
      web('https://example.com/cat.png', text('a cat')),
      text(' here'),
    ]);
    expect(cat.diagnostics).toEqual([{ code: 'image', line: 1 }]);
    // By reference, in a link, after a `!` of its own, and a data URL, which is no web page.
    const made = tree(
      '![ref][1] [![inner](a.png)](https://example.com) !![x](data:image/svg+xml;base64,PHN2Zz4=)\n\n[1]: https://example.com/1.png',
    );
    expect(paragraph(made)).toEqual([
      web('https://example.com/1.png', text('ref')),
      text(' '),
      web('https://example.com/', text('inner')),
      text(' !x'),
    ]);
    expect(collect(made, 'image')).toEqual([]);
    // Text without an image is left alone.
    expect(paragraph(tree('no `![img](x)` here'))).toEqual([
      text('no '),
      { kind: 'inlineCode', value: '![img](x)' },
      text(' here'),
    ]);
  });

  /**
   * Markdown nested deeper than Lo lays out shows as text, which nests nothing: without that,
   * laying it out could overflow the stack. Nesting up to the cap stays Markdown.
   */
  test('deep nesting shows as text', () => {
    const bodies = [
      '>'.repeat(60_000),
      '- '.repeat(30_000) + 'x',
      '1. '.repeat(10_000),
      '> - '.repeat(10_000),
      `${'>'.repeat(MAX_DEPTH)} x`,
    ];
    // Each shows as its own text, and says why.
    expect(bodies.map((body) => tree(body))).toEqual(
      bodies.map((body) => ({
        blocks: [{ kind: 'paragraph', children: [text(body)] }],
        notes: ['deep'],
        diagnostics: [],
      })),
    );
    // `- - - …` alone is a rule, not a list.
    expect(tree('- '.repeat(30_000)).blocks).toEqual([{ kind: 'rule' }]);
    // At the cap: block quotes 15 deep, and the paragraph in them.
    const deepest = tree(`${'>'.repeat(MAX_DEPTH - 1)} x`);
    expect(deepest.notes).toEqual([]);
    expect(walk(deepest).depth).toBe(MAX_DEPTH);
    expect(textOf(deepest.blocks)).toBe('x');
    expect(walk(tree('- a\n  - b')).depth).toBe(5);
  });

  /** Only the first 64 Ki characters of a comment are read, cut at a character's start, and the tree says it was cut. */
  test('long comments are cut', () => {
    // Two UTF-16 units a character, so the cut counts characters, not units.
    const long = tree('😀'.repeat(MAX_LENGTH + 1));
    expect(long.notes).toEqual(['cut']);
    const shown = textOf(long.blocks);
    expect(Array.from(shown)).toHaveLength(MAX_LENGTH);
    expect(shown.isWellFormed()).toBe(true);
    expect(tree('short').notes).toEqual([]);
    expect(tree('a'.repeat(MAX_LENGTH)).notes).toEqual([]);
    expect(textOf(tree('a'.repeat(MAX_LENGTH + 1)).blocks)).toHaveLength(MAX_LENGTH);
  });

  /** A comment's body is Markdown with no image in it that Lo wouldn't load. A comment nested as deep as Lo lays out shows. */
  test('a comment renders as markdown without images', () => {
    const made = tree(
      '**Bold** and `code`\nnext line\n\n![svg](data:image/svg+xml;base64,PHN2Zz4=)',
    );
    expect(made.blocks).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'strong', children: [text('Bold')] },
          text(' and '),
          { kind: 'inlineCode', value: 'code' },
          { kind: 'break' },
          text('next line'),
        ],
      },
      // A data address is no web page, so the image is its alt text.
      { kind: 'paragraph', children: [text('svg')] },
    ]);
    expect(made.diagnostics).toEqual([{ code: 'image', line: 4 }]);
    const deepest = tree(`${'> '.repeat(MAX_DEPTH - 1)}x`);
    expect(deepest.notes).toEqual([]);
    expect(collect(deepest, 'quote')).toHaveLength(MAX_DEPTH - 1);
  });

  /**
   * A link in a comment goes only to a web page: one relative to the comment reads from its page,
   * as on GitHub, and a file or an app's link is its text, with a diagnostic saying why.
   */
  test('a click opens only web links', () => {
    const label = 'x'.repeat(80);
    const cases = [
      ['file:///Applications/Calculator.app', undefined],
      ['steam://run/1', undefined],
      // An image's link, too.
      ['data:image/png;base64,iVBORw0KGgo=', undefined],
      ['https://example.com/a', 'https://example.com/a'],
      ['../blob/main/a.ts', 'https://github.com/octo/repo/blob/main/a.ts'],
      ['#discussion_r2', 'https://github.com/octo/repo/pull/1#discussion_r2'],
    ] as const;
    expect(
      cases.map(([link]) => {
        const made = tree(`[${label}](${link})`);
        return [link, paragraph(made), made.diagnostics];
      }),
    ).toEqual(
      cases.map(([link, opens]) =>
        opens === undefined
          ? [link, [text(label)], [{ code: 'link', line: 1 }]]
          : [link, [web(opens, text(label))], []],
      ),
    );
  });
});

describe('the timeline', () => {
  /**
   * Images stay images only from GitHub's image hosts. Any other becomes a link to its address,
   * by reference or not, nested in a link, after a `!` of its own, with a user name, relative, on
   * another port or over `http`; one that isn't a web page at all shows its alt text.
   */
  test('only web images stay images', () => {
    const shot = camo('fa621', 'https://e.com/shot.png');
    const signed =
      'https://private-user-images.githubusercontent.com/99793808/687140350-cbe34088-7125-49ac-b6ed-ce17762af48a.png?jwt=REDACTED';
    const old = 'https://user-images.githubusercontent.com/1/2-abc.png';
    const made = tree(
      `![shot](${PNG}) ![again](${PNG}) ![cat](https://example.com/cat.gif) ![proxied](${shot}) ![signed](${signed}) ![old](${old})\n\n` +
        '![data](data:image/svg+xml;base64,PHN2Zz4=) ![plain](http://camo.githubusercontent.com/a) ' +
        '![relative](a.png) ![port](https://camo.githubusercontent.com:8080/a) ' +
        '![user](https://me@camo.githubusercontent.com/a) ![sub](https://x.camo.githubusercontent.com/a) ' +
        '![ref][r] !![bang](file:///etc/passwd) [![inner](javascript:x)](https://example.com)\n\n' +
        '[r]: data:image/png;base64,AAAA',
    );
    expect(collect(made, 'image').map((image) => image.url)).toEqual([PNG, PNG, shot, signed, old]);
    const second = made.blocks[1];
    expect(second?.kind === 'paragraph' && second.children).toEqual([
      text('data '),
      web('http://camo.githubusercontent.com/a', text('plain')),
      text(' '),
      web('https://github.com/octo/repo/pull/a.png', text('relative')),
      text(' '),
      web('https://camo.githubusercontent.com:8080/a', text('port')),
      // A user name makes no web link either.
      text(' user '),
      web('https://x.camo.githubusercontent.com/a', text('sub')),
      text(' ref !bang '),
      web('https://example.com/', text('inner')),
    ]);
    // Text without images is left alone.
    expect(paragraph(tree('no `![img](data:x)` here'))[1]).toEqual({
      kind: 'inlineCode',
      value: '![img](data:x)',
    });
  });

  /** Text nested deeper than Lo lays out shows as text, with no image; a long one is cut, and keeps its images. */
  test('deep nesting and length are capped as in comments', () => {
    const deep = tree(`${'> '.repeat(MAX_DEPTH + 1)}![x](${PNG})`);
    expect(deep.notes).toEqual(['deep']);
    expect(collect(deep, 'image')).toEqual([]);
    expect(textOf(deep.blocks)).toContain('![x](');
    const long = tree(`![x](${PNG}) ${'a'.repeat(MAX_LENGTH)}`);
    expect(collect(long, 'image').map((image) => image.url)).toEqual([PNG]);
    expect(long.notes).toEqual(['cut']);
  });

  /** A post shows at most its first 30 images, counting an address each time it shows; the rest are links. */
  test('a post shows at most its first images', () => {
    let body = '';
    for (let n = 0; n < MAX_POST_IMAGES + 20; n++) {
      body += `![${n}](${camo('sig', 'https://e.com/g.gif')}?${n}) ![same](${PNG}) `;
    }
    const made = tree(body);
    const images = collect(made, 'image');
    expect(images).toHaveLength(MAX_POST_IMAGES);
    const addresses = [...new Set(images.map((image) => image.url))];
    expect(addresses).toHaveLength(MAX_POST_IMAGES / 2 + 1);
    expect(addresses[0]).toBe(`${camo('sig', 'https://e.com/g.gif')}?0`);
    expect(addresses[1]).toBe(PNG);
    const last = MAX_POST_IMAGES / 2 - 1;
    expect(images.some((image) => image.alt === String(last))).toBe(true);
    const past = MAX_POST_IMAGES / 2;
    const links = collect(made, 'link');
    expect(links.find((link) => textOf(link.children) === String(past))?.target).toEqual({
      kind: 'web',
      url: `${camo('sig', 'https://e.com/g.gif')}?${past}`,
    });
    expect(images.some((image) => image.alt === String(past))).toBe(false);
  });
});

describe('constructs', () => {
  test('headings take GitHub anchors, unique in the document', () => {
    const made = tree(
      '# Hello, *World*!\n\n## Hello World\n\n### hello-world\n\n#### `code` & ünïcode_x',
    );
    expect(collect(made, 'heading').map((heading) => [heading.level, heading.anchor])).toEqual([
      [1, 'hello-world'],
      [2, 'hello-world-1'],
      [3, 'hello-world-2'],
      [4, 'code--ünïcode_x'],
    ]);
  });

  test('links to an anchor stay in the document', () => {
    const made = tree('# Intro\n\n[a](#intro) [b](#user-content-intro) [c](#Intro) [d](#missing)');
    const links = collect(made, 'link').map((link) => link.target);
    expect(links).toEqual([
      { kind: 'anchor', name: 'intro' },
      { kind: 'anchor', name: 'intro' },
      // Not a name in the document, so it's read from the page, as GitHub reads it.
      { kind: 'web', url: 'https://github.com/octo/repo/pull/1#Intro' },
      { kind: 'web', url: 'https://github.com/octo/repo/pull/1#missing' },
    ]);
    // With no page, a link to a name the document lacks is its text.
    const alone = markdownTree('[d](#missing)');
    expect(alone.blocks).toEqual([{ kind: 'paragraph', children: [text('d')] }]);
  });

  test('alerts are quotes that start with their marker', () => {
    const made = tree(
      ['note', 'TIP', 'Important', 'warning', 'caution']
        .map((type) => `> [!${type}]\n> Body of ${type}.`)
        .join('\n\n'),
    );
    expect(made.blocks.map((block) => (block.kind === 'alert' ? block.type : block.kind))).toEqual([
      'note',
      'tip',
      'important',
      'warning',
      'caution',
    ]);
    expect(made.blocks[0]).toEqual({
      kind: 'alert',
      type: 'note',
      children: [{ kind: 'paragraph', children: [text('Body of note.')] }],
    });
    // Not alerts, as GitHub renders them: another word, text on the marker's line, a marker in a
    // sentence, a marker with nothing after it, and a quote in a list or in another quote.
    const quotes = [
      '> [!DANGER]\n> x',
      '> [!NOTE] x',
      '> see [!NOTE]',
      '> [!NOTE]',
      '> [!NOTE]\n>',
      '- > [!TIP]\n  > in a list',
      '> > [!WARNING]\n> > nested',
    ];
    expect(
      quotes.map((body) => {
        const [first] = tree(body).blocks;
        return first?.kind === 'list' ? first.items[0]?.children[0]?.kind : first?.kind;
      }),
    ).toEqual(quotes.map(() => 'quote'));
    expect(collect(tree('> > [!WARNING]\n> > nested'), 'alert')).toEqual([]);
    // Alerts, as GitHub renders them: in lower case, and with a blank line after the marker.
    expect(tree('> [!note]\n> lower').blocks[0]).toEqual({
      kind: 'alert',
      type: 'note',
      children: [{ kind: 'paragraph', children: [text('lower')] }],
    });
    expect(tree('> [!TIP]\n>\n> after a blank line').blocks[0]).toEqual({
      kind: 'alert',
      type: 'tip',
      children: [{ kind: 'paragraph', children: [text('after a blank line')] }],
    });
  });

  test('task lists say which items are ticked', () => {
    const made = tree(
      '- [ ] open\n- [x] done\n- [X] also\n- [y] not a task\n- plain\n- [ ]\n- [x]',
    );
    const [list] = collect(made, 'list');
    expect(list?.items.map((item) => [item.checked, textOf(item.children)])).toEqual([
      [false, 'open'],
      [true, 'done'],
      [true, 'also'],
      [undefined, '[y] not a task'],
      [undefined, 'plain'],
      // With nothing after it, a marker is text, as on GitHub.
      [undefined, '[ ]'],
      [undefined, '[x]'],
    ]);
    expect(list?.items[4]).not.toHaveProperty('checked');
  });

  test('one tilde or two strike through, as on GitHub', () => {
    expect(paragraph(tree('~a~ ~~b~~ ~~~c~~~ ~d~~ ~~e~ a~b~c'))).toEqual([
      { kind: 'strike', children: [text('a')] },
      text(' '),
      { kind: 'strike', children: [text('b')] },
      text(' ~~~c~~~ ~d~~ ~~e~ a'),
      { kind: 'strike', children: [text('b')] },
      text('c'),
    ]);
  });

  test('lists keep their numbering and spacing', () => {
    expect(tree('3. a\n4. b').blocks[0]).toMatchObject({
      kind: 'list',
      ordered: true,
      start: 3,
      tight: true,
    });
    expect(tree('- a\n\n- b').blocks[0]).toMatchObject({
      kind: 'list',
      ordered: false,
      start: 1,
      tight: false,
    });
  });

  test('tables keep their alignment and cells', () => {
    const made = tree('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | **2** | 3 |');
    expect(made.blocks).toEqual([
      {
        kind: 'table',
        align: ['left', 'center', 'right', 'none'],
        head: [[text('a')], [text('b')], [text('c')], [text('d')]],
        rows: [[[text('1')], [{ kind: 'strong', children: [text('2')] }], [text('3')], []]],
      },
    ]);
  });

  test('code keeps its text, and its language when that is a plain name', () => {
    const made = tree(
      '```ts title="x"\nconst a = 1;\n```\n\n```c++\nx\n```\n\n```<script>\nx\n```\n\n    indented\n\n```suggestion\nnew line\n```',
    );
    expect(made.blocks).toEqual([
      { kind: 'code', language: 'ts', text: 'const a = 1;' },
      { kind: 'code', language: 'c++', text: 'x' },
      { kind: 'code', text: 'x' },
      { kind: 'code', text: 'indented' },
      { kind: 'suggestion', text: 'new line' },
    ]);
  });

  test('footnotes come at the end, in the order they are first referenced', () => {
    const made = tree('b[^b] a[^a] b again[^b]\n\n[^a]: Alpha.\n[^b]: Beta.\n[^unused]: Never.');
    expect(collect(made, 'footnoteReference')).toEqual([
      { kind: 'footnoteReference', name: 'fn-b', number: 1 },
      { kind: 'footnoteReference', name: 'fn-a', number: 2 },
      { kind: 'footnoteReference', name: 'fn-b', number: 1 },
    ]);
    expect(made.blocks.at(-1)).toEqual({
      kind: 'footnotes',
      items: [
        { name: 'fn-b', number: 1, children: [{ kind: 'paragraph', children: [text('Beta.')] }] },
        { name: 'fn-a', number: 2, children: [{ kind: 'paragraph', children: [text('Alpha.')] }] },
      ],
    });
    // A heading can't take a footnote's name.
    expect(collect(tree('# fn-a\n\nx[^a]\n\n[^a]: y'), 'heading')[0]?.anchor).toBe('fn-a-1');
    // GitHub has no inline footnotes.
    expect(collect(tree('x^[inline]'), 'footnoteReference')).toEqual([]);
    // Labels match whatever their case, as on GitHub, and name the footnote as its definition does.
    const cased = tree('x[^A] y[^a]\n\n[^a]: Lower.');
    expect(collect(cased, 'footnoteReference')).toEqual([
      { kind: 'footnoteReference', name: 'fn-a', number: 1 },
      { kind: 'footnoteReference', name: 'fn-a', number: 1 },
    ]);
    expect(collect(cased, 'footnotes')[0]?.items).toEqual([
      { name: 'fn-a', number: 1, children: [{ kind: 'paragraph', children: [text('Lower.')] }] },
    ]);
  });

  test('mentions and references link to GitHub', () => {
    const made = tree(
      '@octocat, @github/docs-team and email@example.com; #12, other/thing#3 and GH-4. a#5 &#6',
    );
    expect(paragraph(made)).toEqual([
      { kind: 'mention', name: 'octocat', url: 'https://github.com/octocat' },
      text(', '),
      {
        kind: 'mention',
        name: 'github/docs-team',
        url: 'https://github.com/orgs/github/teams/docs-team',
      },
      text(' and email@example.com; '),
      web('https://github.com/octo/repo/issues/12', text('#12')),
      text(', '),
      web('https://github.com/other/thing/issues/3', text('other/thing#3')),
      text(' and '),
      web('https://github.com/octo/repo/issues/4', text('GH-4')),
      text('. a#5 &#6'),
    ]);
    // Not in code or links, and `#123` needs a repository.
    expect(paragraph(tree('`@a #1` [@a #1](https://e.com)'))).toEqual([
      { kind: 'inlineCode', value: '@a #1' },
      text(' '),
      web('https://e.com/', text('@a #1')),
    ]);
    expect(paragraph(markdownTree('#1 @a'))).toEqual([
      text('#1 '),
      { kind: 'mention', name: 'a', url: 'https://github.com/a' },
    ]);
    // Names GitHub doesn't allow stay text.
    expect(paragraph(tree('@-a @a- @a--b @' + 'a'.repeat(40) + ' #0 #99999999999'))).toEqual([
      text('@-a @a- @a--b @' + 'a'.repeat(40) + ' #0 #99999999999'),
    ]);
    // A repository that isn't one is no context.
    expect(paragraph(markdownTree('#1', { repo: { owner: '../evil', name: 'x' } }))).toEqual([
      text('#1'),
    ]);
  });

  test('autolinks are web addresses and www names, as on GitHub', () => {
    expect(
      paragraph(tree('see https://e.com/a, www.e.com and e.com or <https://e.com/b>')),
    ).toEqual([
      text('see '),
      web('https://e.com/a', text('https://e.com/a')),
      text(', '),
      web('http://www.e.com/', text('www.e.com')),
      text(' and e.com or '),
      web('https://e.com/b', text('https://e.com/b')),
    ]);
  });

  test('raw html shows as its text, its comments left out', () => {
    const made = tree(
      '<div align="center">\n<b>x</b>\n</div>\n\nA <span onclick="x()">y</span> <!-- hidden --> z\n\n<!-- a comment -->',
    );
    expect(made.blocks).toEqual([
      { kind: 'paragraph', children: [text('<div align="center">\n<b>x</b>\n</div>')] },
      {
        kind: 'paragraph',
        children: [text('A <span onclick="x()">y</span>  z')],
      },
    ]);
    expect(made.diagnostics).toEqual([
      { code: 'html', line: 1 },
      { code: 'html', line: 5 },
      { code: 'html', line: 5 },
      { code: 'html', line: 5 },
      { code: 'html', line: 7 },
    ]);
  });

  test('only what an HTML parser reads as a comment is left out', () => {
    // `<!--` in an attribute's value is no comment, and GitHub shows the text around it.
    const quoted = tree('<div title="<!--">visible<span title="-->">x</span></div>\n\nafter');
    expect(textOf(quoted.blocks)).toBe(
      '<div title="<!--">visible<span title="-->">x</span></div>after',
    );
    // A comment left open runs to the end, and GitHub shows nothing after it.
    expect(tree('para\n\n<!-- open\n\nhidden too').blocks).toEqual([
      { kind: 'paragraph', children: [text('para')] },
    ]);
    // Nor is one in a script, though GitHub shows no script either.
    expect(textOf(tree('<script>a <!-- b --> c</script>').blocks)).toBe(
      '<script>a <!-- b --> c</script>',
    );
  });

  test('a newline breaks the line unless told otherwise', () => {
    expect(paragraph(tree('a\nb'))).toEqual([text('a'), { kind: 'break' }, text('b')]);
    expect(paragraph(tree('a\nb', { breaks: false }))).toEqual([text('a b')]);
    expect(paragraph(tree('a  \nb', { breaks: false }))).toEqual([
      text('a'),
      { kind: 'break' },
      text('b'),
    ]);
  });

  test('a long address is refused, and so is any past the limit on addresses', () => {
    const long = `https://e.com/${'x'.repeat(9_000)}`;
    expect(paragraph(tree(`[a](${long})`))).toEqual([text('a')]);
    // One address named by reference a thousand times fills the limit, and the rest are text.
    const address = `https://e.com/${'x'.repeat(4_000)}`;
    const made = tree(`[a]: ${address}\n\n${'[a] '.repeat(1_000)}`);
    const links = collect(made, 'link');
    expect(links).toHaveLength(Math.floor(DEFAULT_LIMITS.addresses / address.length));
    expect(walk(made).addresses).toBeLessThanOrEqual(DEFAULT_LIMITS.addresses);
    // The limits hold for addresses as normalized, which percent-encoding makes longer.
    expect(paragraph(tree(`[a](https://e.com/${'é'.repeat(1_400)})`))).toEqual([text('a')]);
    const encoded = `[a](https://e.com/${'é'.repeat(20)})`;
    expect(paragraph(tree(encoded, { limits: { addresses: 100 } }))).toEqual([text('a')]);
    expect(collect(tree(encoded, { limits: { addresses: 200 } }), 'link')).toHaveLength(1);
  });

  test('past the node limit, the rest shows as its text', () => {
    const made = tree('para one\n\n' + 'x *y* '.repeat(20) + '\n\nlast', { limits: { nodes: 20 } });
    expect(made.notes).toEqual(['nodes']);
    expect(made.blocks).toEqual([
      { kind: 'paragraph', children: [text('para one')] },
      { kind: 'paragraph', children: [text(`${'x *y* '.repeat(20)}\n\nlast`)] },
    ]);
  });

  test('the limits hold for the tree as built, not as parsed', () => {
    // Raw HTML becomes a paragraph and its text, and an image Lo won't load a link and its text:
    // two nodes for one token, and a level deeper.
    const limits = { nodes: 1_000 };
    for (const body of ['<a>\n\n'.repeat(2_000), '![a](https://e.com/x.png) '.repeat(2_000)]) {
      const made = tree(body, { limits });
      expect(walk(made, { ...DEFAULT_LIMITS, ...limits }).nodes).toBeLessThanOrEqual(limits.nodes);
      expect(made.notes).toEqual(['nodes']);
    }
    for (const body of [
      `${'>'.repeat(MAX_DEPTH)}<div>`,
      `${'>'.repeat(MAX_DEPTH - 1)} ![a](https://e.com/x.png)`,
    ]) {
      const made = tree(body);
      expect(walk(made).depth).toBeLessThanOrEqual(MAX_DEPTH);
      expect(made.notes).toEqual(['deep']);
      expect(made.blocks).toEqual([{ kind: 'paragraph', children: [text(body)] }]);
    }
  });

  test('only the part nested too deep shows as its text', () => {
    // Emphasis nests without end in Markdown; the paragraph before it still shows as built.
    const deep = `${'*a **a '.repeat(3_000)}b${' a** a*'.repeat(3_000)}`;
    const made = tree(`Normal *text*.\n\n${deep}`);
    expect(made.notes).toEqual(['deep']);
    expect(made.blocks).toEqual([
      {
        kind: 'paragraph',
        children: [text('Normal '), { kind: 'emphasis', children: [text('text')] }, text('.')],
      },
      { kind: 'paragraph', children: [text(deep)] },
    ]);
  });

  test('the tree never holds more nodes than the limit', () => {
    const body = [
      '# Title',
      'Some *text* and a [link](https://e.com/).',
      '- a\n- b',
      '> quote',
      '| a | b |\n|---|---|\n| c | d |',
      'x[^1]\n\n[^1]: Note.',
    ].join('\n\n');
    const over = [];
    for (let nodes = 1; nodes <= 80; nodes++) {
      const made = markdownTree(body, { page: PAGE, limits: { nodes } });
      const walked = walk(made, { ...DEFAULT_LIMITS, nodes: Math.max(nodes, 16) });
      if (walked.problems.length > 0) over.push([nodes, walked.nodes, walked.problems[0]]);
    }
    expect(over).toEqual([]);
  });

  test('past the node limit, footnotes are left out and their references are text', () => {
    const notes = Array.from({ length: 20 }, (_, n) => `[^${n}]: Note ${n}.`).join('\n');
    const references = Array.from({ length: 20 }, (_, n) => `[^${n}]`).join(' ');
    const made = tree(`${references}\n\n${notes}`, { limits: { nodes: 60 } });
    expect(made.notes).toEqual(['nodes']);
    const kept = collect(made, 'footnotes')[0]?.items.map((item) => item.name) ?? [];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(20);
    expect(collect(made, 'footnoteReference').map((reference) => reference.name)).toEqual(kept);
    expect(textOf(made.blocks[0])).toContain(`[^${kept.length}]`);
    // What doesn't fit still shows, as its text.
    expect(textOf(made.blocks.at(-1))).toContain('Note 19.');
  });

  test('footnotes take time in proportion to the text', () => {
    // Thousands of footnotes, each defined and referenced once.
    const count = 60_000;
    const references = Array.from({ length: count }, (_, n) => `[^${n}]`).join('');
    const definitions = Array.from({ length: count }, (_, n) => `[^${n}]: x`).join('\n');
    const started = performance.now();
    markdownTree(`${references}\n\n${definitions}`, {
      limits: { length: 1_048_576, nodes: 1_048_576, addresses: 1 << 26 },
    });
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  test('a footnote defined before the text is cut still shows', () => {
    const body = `[^early]: Defined early.\n\n${'x '.repeat(10)}[^early]\n\n${'*y* '.repeat(200)}`;
    const made = tree(body, { limits: { nodes: 30 } });
    expect(made.notes).toEqual(['nodes']);
    expect(textOf(made.blocks)).toContain('Defined early.');
  });

  test('a link never holds another link', () => {
    const made = tree('[x](https://outer.example/)', { syntax: { plugins: [wrap] } });
    expect(paragraph(made)).toEqual([web('https://outer.example/', text('x'))]);
  });

  test('text that overflows the stack anyway shows as plain text', () => {
    const made = markdownTree('# Still *shown*', { syntax: { plugins: [overflow] } });
    expect(made.notes).toEqual(['deep']);
    expect(made.blocks).toEqual([{ kind: 'paragraph', children: [text('# Still *shown*')] }]);
    // It says only that, and that the text was cut, whatever the first try found.
    const cut = markdownTree('x '.repeat(40), {
      syntax: { plugins: [overflow] },
      limits: { length: 10, nodes: 1 },
    });
    expect(cut.notes).toEqual(['cut', 'deep']);
  });

  test('diagnostics stop at their cap', () => {
    expect(tree('<b>'.repeat(1_000)).diagnostics).toHaveLength(100);
  });

  test('limits that make no sense fall back to the defaults', () => {
    const depths = [0, -1, 1.5, Number.NaN, Infinity];
    expect(
      depths.map(
        (depth) => markdownTree(`${'> '.repeat(MAX_DEPTH + 1)}x`, { limits: { depth } }).notes,
      ),
    ).toEqual(depths.map(() => ['deep']));
    // Nor can a limit be raised past its ceiling.
    const made = markdownTree(`${'> '.repeat(100)}x`, { limits: { depth: 1_000_000 } });
    expect(made.notes).toEqual(['deep']);
  });
});

describe('extensions', () => {
  interface Callout {
    kind: 'callout';
    children: Block<Overview>[];
  }
  interface Term {
    kind: 'term';
    name: string;
  }
  interface Overview {
    block: Callout;
    inline: Term;
    target: { kind: 'code'; path: string };
  }

  /** `:::` fences around blocks, and `{term}` in text. */
  const syntax: MarkdownOptions<Overview>['syntax'] = {
    plugins: [
      (md) => {
        md.block.ruler.before('fence', 'callout', (state, start, end, silent) => {
          const line = state.src.slice(
            state.bMarks[start]! + state.tShift[start]!,
            state.eMarks[start],
          );
          if (line !== ':::') return false;
          if (silent) return true;
          let close = start + 1;
          while (close < end) {
            const at = state.src.slice(
              state.bMarks[close]! + state.tShift[close]!,
              state.eMarks[close],
            );
            if (at === ':::') break;
            close += 1;
          }
          const open = state.push('callout_open', 'div', 1);
          open.map = [start, close + 1];
          state.md.block.tokenize(state, start + 1, close);
          state.push('callout_close', 'div', -1);
          state.line = Math.min(close + 1, end);
          return true;
        });
        md.inline.ruler.push('term', (state, silent) => {
          if (state.src[state.pos] !== '{') return false;
          const end = state.src.indexOf('}', state.pos);
          if (end === -1) return false;
          if (!silent) state.push('term', '', 0).content = state.src.slice(state.pos + 1, end);
          state.pos = end + 1;
          return true;
        });
      },
    ],
    blocks: { callout_open: (_token, children) => ({ kind: 'callout', children }) },
    inlines: { term: (token) => ({ kind: 'term', name: token.content }) },
    link: (href) => (href.startsWith('code:') ? { kind: 'code', path: href.slice(5) } : undefined),
  };

  test('an extension adds its own blocks, inlines and links', () => {
    const made = markdownTree<Overview>(
      ':::\nA {cache} in [x](code:src/a.ts) and [y](javascript:z)\n:::',
      {
        syntax,
      },
    );
    expect(made.blocks).toEqual([
      {
        kind: 'callout',
        children: [
          {
            kind: 'paragraph',
            children: [
              text('A '),
              { kind: 'term', name: 'cache' },
              text(' in '),
              { kind: 'link', target: { kind: 'code', path: 'src/a.ts' }, children: [text('x')] },
              text(' and y'),
            ],
          },
        ],
      },
    ]);
  });

  test('a handler that declines leaves its token’s children in its place', () => {
    const made = markdownTree<Overview>(
      ':::\n![a](https://camo.githubusercontent.com/a) <b>\n:::',
      {
        syntax: { ...syntax, blocks: { callout_open: () => undefined } },
      },
    );
    expect(made.blocks).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'image', url: 'https://camo.githubusercontent.com/a', alt: 'a' },
          text(' <b>'),
        ],
      },
    ]);
    // Each was mapped once: one image, one diagnostic.
    expect(made.diagnostics).toEqual([{ code: 'html', line: 2 }]);
  });

  test("an extension's blocks count toward the depth limit", () => {
    const made = markdownTree<Overview>(`:::\n${'> '.repeat(MAX_DEPTH)}x\n:::`, { syntax });
    expect(made.notes).toEqual(['deep']);
    expect(made.blocks).toEqual([
      { kind: 'paragraph', children: [text(`:::\n${'> '.repeat(MAX_DEPTH)}x\n:::`)] },
    ]);
  });
});

/** A text's words on one line, with its raw HTML as the words GitHub shows for it. */
const words = (markdown: string) => plainText(markdownTree(markdown, { html: 'words' }));

describe('raw HTML as words', () => {
  test('a tag gives its text, a summary and its details theirs, and an image its alt text', () => {
    expect(
      words(
        'A <b>bold</b>move, <kbd>Ctrl</kbd>+<i>c</i> and<br>a <a href="https://e.com">link</a>',
      ),
    ).toBe('A boldmove, Ctrl+c and a link');
    expect(words('<details><summary>Stack trace</summary>\n\nat main (a.ts:1)\n\n</details>')).toBe(
      'Stack trace at main (a.ts:1)',
    );
    expect(words('<details>\n<summary>Stack trace</summary>\n\nat main (a.ts:1)\n</details>')).toBe(
      'Stack trace at main (a.ts:1)',
    );
    expect(words('See <img width="10" src="x.png" alt="the chart"> and <img src="y.png">.')).toBe(
      'See the chart and image .',
    );
    expect(words('<img src="y.png" alt="  ">')).toBe('image');
    expect(words('<p align="center"><img src="y.png" alt="logo"></p>')).toBe('logo');
  });

  test('what GitHub never shows, and a comment, give nothing', () => {
    expect(words('<script>alert(1)</script>\n\n<style>p{}</style>\n\nb <!-- c -->')).toBe('b');
  });

  test('text that is no HTML shows as typed: a less-than sign, an escape and an entity', () => {
    expect(words('if a<b then return')).toBe('if a<b then return');
    expect(words('x<y here, and z>w')).toBe('x<y here, and z>w');
    expect(words('a < b, 1 <3 2 and 3 > 2')).toBe('a < b, 1 <3 2 and 3 > 2');
    expect(words('&lt;b&gt;bold&lt;/b&gt;')).toBe('<b>bold</b>');
    expect(words('\\<b\\>bold\\</b\\>')).toBe('<b>bold</b>');
    expect(words('Tom &amp; Jerry')).toBe('Tom & Jerry');
  });

  test('code stays as written, in a line or a block', () => {
    expect(words('Use `<div>` or:\n\n```html\n<b>x</b>\n```')).toBe('Use <div> or: <b>x</b>');
  });

  test('without the option, raw HTML shows as its text, as written', () => {
    expect(plainText(markdownTree('a <b>b</b>'))).toBe('a <b>b</b>');
    expect(plainText(markdownTree('a <b>b</b>', { html: 'text' }))).toBe('a <b>b</b>');
  });

  test('HTML that builds more elements than a limit is left as it is written', () => {
    const html = `<div>${'<i>'.repeat(5_000)}`;
    expect(plainText(markdownTree(html, { html: 'words' }))).toBe(html);
  });
});
