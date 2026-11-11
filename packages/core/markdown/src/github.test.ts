import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { collect, textOf } from '../test/support.ts';
import { isRecord, problems, walk } from '../test/walker.ts';
import { githubTree, type Post } from './github.ts';
import { DEFAULT_LIMITS } from './limits.ts';
import { markdownTree } from './markdown.ts';
import type { Block, Inline, Tree } from './tree.ts';

const GITHUB = new URL('../../../../testing/fixtures/markdown/github/', import.meta.url);
const PAGE = 'https://github.com/rozed-dev/e2e/pull/23';
const MAX_RENDERED_HTML = DEFAULT_LIMITS.html;

function tree(post: Post | string, page = PAGE): Tree {
  const made = githubTree(typeof post === 'string' ? { html: post, markdown: '' } : post, { page });
  expect(problems(made)).toEqual([]);
  return made;
}

function text(value: string): Inline {
  return { kind: 'text', value };
}

function web(url: string, ...children: Inline[]): Inline {
  return { kind: 'link', target: { kind: 'web', url }, children };
}

/** Camo's address for `address`: a signature, then the address in hex. */
function camo(signature: string, address: string): string {
  const hex = [...new TextEncoder().encode(address)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `https://camo.githubusercontent.com/${signature}/${hex}`;
}

function fixture(name: string): string {
  return readFileSync(new URL(name, GITHUB), 'utf8');
}

/** The string `name` holds in `item`, which every captured item has. */
function field(item: unknown, name: string): string {
  const held = isRecord(item) ? item[name] : undefined;
  if (typeof held !== 'string') throw new Error(`a captured item has no ${name}`);
  return held;
}

/** The list `key` in the captured fixture `name`. */
function captured(name: string, key: string): unknown[] {
  const json: unknown = JSON.parse(fixture(name));
  const list = isRecord(json) ? json[key] : undefined;
  if (!Array.isArray(list)) throw new Error(`${name} has no ${key}`);
  return list;
}

/** A tree's blocks, footnote names aside: GitHub gives each post's a suffix of its own. */
function unsuffixed(made: Tree): unknown {
  return JSON.parse(JSON.stringify(made.blocks).replaceAll(/-[0-9a-f]{32}"/g, '"'));
}

/** The blocks between the heading `title` and the next heading of its level or above. */
function section(made: Tree, title: string): Block[] {
  const start = made.blocks.findIndex(
    (block) => block.kind === 'heading' && textOf(block.children) === title,
  );
  const heading = made.blocks[start];
  if (heading?.kind !== 'heading') throw new Error(`no section ${title}`);
  const end = made.blocks.findIndex(
    (block, index) => index > start && block.kind === 'heading' && block.level <= heading.level,
  );
  return made.blocks
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((block) => block.kind !== 'footnotes');
}

describe('the timeline', () => {
  /**
   * GitHub's rendering of a post says where each image loads from: camo for other hosts' images,
   * a signed address for an attachment, GitHub's own hosts as they are. Those show; any other is a
   * link, whatever `data-canonical-src` claims, and an `<img>` written in code is text.
   */
  test('images load from where github renders them', () => {
    const signed =
      'https://private-user-images.githubusercontent.com/99793808/687140350-cbe34088-7125-49ac-b6ed-ce17762af48a.png?jwt=REDACTED';
    const old = 'https://user-images.githubusercontent.com/1/2-abc.png';
    const cat = camo('fa622', 'https://e.com/cat.png?a=1&b=2');
    const centered = camo('fa621', 'https://e.com/center.png');
    const dog = camo('fa623', 'https://e.com/dog.png');
    const made = tree(
      `<p><a href="${signed}"><img width="859" alt="image" src="${signed}" style="max-width: 100%;"></a></p>
<p align="center"><a href="x"><img src="${centered}" data-canonical-src="https://e.com/center.png"></a></p>
<p><IMG SRC="${cat}" alt="ext" data-canonical-src="https://e.com/cat.png?a=1&amp;b=2"> <img src="${old}"> <img src="doc/logo.png"> <img src="https://evil.example/x.png" data-canonical-src="https://e.com/evil.png"></p>
<pre><code>&lt;img src="${dog}" data-canonical-src="https://e.com/dog.png"&gt;</code></pre>`,
    );
    expect(collect(made, 'image').map((image) => image.url)).toEqual([signed, centered, cat, old]);
    // GitHub links each image to itself, which is the image alone; a link elsewhere stays.
    expect(made.blocks[0]).toEqual({
      kind: 'paragraph',
      children: [{ kind: 'image', url: signed, alt: 'image' }],
    });
    expect(made.blocks[1]).toEqual({
      kind: 'paragraph',
      children: [
        web('https://github.com/rozed-dev/e2e/pull/x', { kind: 'image', url: centered, alt: '' }),
      ],
    });
    expect(made.blocks[2]).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'image', url: cat, alt: 'ext' },
        text(' '),
        { kind: 'image', url: old, alt: '' },
        text(' '),
        web(
          'https://github.com/rozed-dev/e2e/pull/doc/logo.png',
          text('https://github.com/rozed-dev/e2e/pull/doc/logo.png'),
        ),
        text(' '),
        web('https://evil.example/x.png', text('https://evil.example/x.png')),
      ],
    });
    expect(made.blocks[3]).toEqual({
      kind: 'code',
      text: `<img src="${dog}" data-canonical-src="https://e.com/dog.png">`,
    });
  });

  /** A rendering longer than Lo reads shows from the post's Markdown, where the image is a link. */
  test('a rendering past the limit serves nothing', () => {
    const shot = 'https://e.com/shot.png';
    const tag = `<p><img src="${camo('sig', shot)}" data-canonical-src="${shot}"></p>`;
    const markdown = `![shot](${shot})`;
    const fits = `${tag}${' '.repeat(MAX_RENDERED_HTML - tag.length)}`;
    expect(collect(tree({ html: fits, markdown }), 'image')).toHaveLength(1);
    const past = tree({ html: `${fits} `, markdown });
    expect(collect(past, 'image')).toEqual([]);
    expect(past.blocks).toEqual([{ kind: 'paragraph', children: [web(shot, text('shot'))] }]);
    // Counted in UTF-8, as GitHub sizes it: a three-byte character takes three.
    const wide = `${tag}${'€'.repeat(Math.ceil((MAX_RENDERED_HTML - tag.length) / 3))}`;
    expect(collect(tree({ html: wide, markdown }), 'image')).toEqual([]);
  });
});

describe("GitHub's rendering", () => {
  const constructs = tree(fixture('constructs.html'));

  test('every construct maps as GitHub renders it', () => {
    expect(
      collect(constructs, 'heading').map((heading) => [heading.level, heading.anchor]),
    ).toEqual([
      [1, 'every-construct'],
      [2, 'mentions-and-references'],
      [2, 'alerts'],
      [2, 'task-lists'],
      [2, 'code'],
      [2, 'footnotes'],
      [2, 'details'],
      [2, 'images-and-media'],
      [2, 'emoji'],
      [2, 'tables'],
      [2, 'raw-html'],
      [3, 'an-html-heading'],
      [2, 'headings'],
      [3, 'a-heading-with-code-and-emphasis'],
      [3, 'a-heading-with-code-and-emphasis-1'],
      [4, 'ünïcode--punctuation'],
      [5, 'five'],
      [6, 'six'],
    ]);
  });

  test('mentions and references', () => {
    const [mentions, references] = section(constructs, 'Mentions and references');
    expect(mentions).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'mention', name: 'rozed-bot', url: 'https://github.com/rozed-bot' },
        // GitHub links only teams that exist.
        text(', @rozed-dev/maintainers, '),
        { kind: 'mention', name: 'rozed-dev', url: 'https://github.com/rozed-dev' },
        // An email address is a `mailto:` link to GitHub, which Lo shows as text.
        text(', and someone@example.com.'),
      ],
    });
    expect(
      collect({ blocks: [references!], notes: [], diagnostics: [] }, 'link').map((link) => [
        textOf(link.children),
        link.target,
      ]),
    ).toEqual([
      ['#23', { kind: 'web', url: 'https://github.com/rozed-dev/e2e/pull/23' }],
      ['#17', { kind: 'web', url: 'https://github.com/rozed-dev/e2e/pull/17' }],
      ['GH-23', { kind: 'web', url: 'https://github.com/rozed-dev/e2e/pull/23' }],
      ['#23', { kind: 'web', url: 'https://github.com/rozed-dev/e2e/pull/23' }],
      ['#1', { kind: 'web', url: 'https://github.com/rozed-dev/e2e/pull/1' }],
    ]);
  });

  test('alerts', () => {
    const alerts = section(constructs, 'Alerts');
    expect(alerts.map((block) => (block.kind === 'alert' ? block.type : block.kind))).toEqual([
      'note',
      'tip',
      'important',
      'warning',
      'caution',
      // A marker with nothing after it, and a plain quote.
      'quote',
      'quote',
    ]);
    expect(alerts[4]).toEqual({
      kind: 'alert',
      type: 'caution',
      children: [
        {
          kind: 'paragraph',
          children: [text('Caution, over'), { kind: 'break' }, text('two lines.')],
        },
      ],
    });
  });

  test('task lists', () => {
    const [bullets, numbers] = section(constructs, 'Task lists');
    expect(bullets).toEqual({
      kind: 'list',
      ordered: false,
      start: 1,
      tight: true,
      items: [
        { checked: false, children: [{ kind: 'paragraph', children: [text('Open')] }] },
        {
          checked: true,
          children: [
            { kind: 'paragraph', children: [text('Done')] },
            {
              kind: 'list',
              ordered: false,
              start: 1,
              tight: true,
              items: [
                {
                  checked: false,
                  children: [{ kind: 'paragraph', children: [text('Nested open')] }],
                },
              ],
            },
          ],
        },
        { children: [{ kind: 'paragraph', children: [text('Plain item')] }] },
      ],
    });
    expect(numbers?.kind === 'list' && numbers.items.map((item) => item.checked)).toEqual([
      true,
      undefined,
    ]);
  });

  test('code, suggestions, diagrams and math as their text', () => {
    expect(section(constructs, 'Code')).toEqual([
      { kind: 'code', language: 'ts', text: 'const answer: number = 42;' },
      { kind: 'code', language: 'diff', text: '- old\n+ new' },
      { kind: 'code', text: 'no language' },
      { kind: 'code', text: 'indented' },
      { kind: 'suggestion', text: 'suggested line' },
      { kind: 'code', language: 'mermaid', text: 'graph TD; A-->B;' },
      { kind: 'code', language: 'math', text: 'x^2 + y^2 = z^2' },
      {
        kind: 'paragraph',
        children: [
          text('Inline math '),
          { kind: 'inlineCode', value: 'x^2' },
          text(' and display math:'),
        ],
      },
      { kind: 'paragraph', children: [{ kind: 'inlineCode', value: '\\sum_{i=1}^n i' }] },
    ]);
  });

  test('footnotes', () => {
    const references = collect(constructs, 'footnoteReference');
    expect(references.map((reference) => reference.number)).toEqual([1, 2, 1]);
    const [footnotes] = collect(constructs, 'footnotes');
    expect(footnotes?.items.map((item) => [item.name, item.number, textOf(item.children)])).toEqual(
      [
        [references[0]?.name, 1, 'The first footnote.'],
        [references[1]?.name, 2, 'A named footnote, with code and a link.And a second paragraph.'],
      ],
    );
    // GitHub names a post's footnotes with a suffix of its own, and its links back are dropped.
    expect(references[0]?.name).toMatch(/^fn-1-[0-9a-f]{32}$/);
  });

  test('details', () => {
    expect(section(constructs, 'Details')).toEqual([
      {
        kind: 'details',
        open: false,
        summary: [text('Folded '), { kind: 'strong', children: [text('summary')] }],
        children: [
          {
            kind: 'paragraph',
            children: [
              text('Markdown '),
              { kind: 'strong', children: [text('inside')] },
              text(' the fold.'),
            ],
          },
        ],
      },
      {
        kind: 'details',
        open: true,
        summary: [text('Open fold')],
        children: [{ kind: 'paragraph', children: [text('Shown.')] }],
      },
    ]);
  });

  test('images, pictures and attachments', () => {
    const logo = camo(
      '7f550ecc9bbd98e58f9a727ebd2ba9275263a906fed01b2ce28797856773967b',
      'https://www.w3.org/assets/logos/w3c/w3c-no-bars.svg',
    );
    expect(section(constructs, 'Images and media')).toEqual([
      { kind: 'paragraph', children: [{ kind: 'image', url: logo, alt: 'remote image' }] },
      // A relative image isn't on GitHub's image hosts.
      {
        kind: 'paragraph',
        children: [
          web('https://github.com/rozed-dev/e2e/pull/docs/logo.png', text('relative image')),
        ],
      },
      { kind: 'paragraph', children: [{ kind: 'image', url: logo, alt: 'html image' }] },
      // A picture is its image.
      { kind: 'paragraph', children: [{ kind: 'image', url: logo, alt: 'picture image' }] },
      {
        kind: 'paragraph',
        children: [web('https://www.w3.org/', { kind: 'image', url: logo, alt: 'linked image' })],
      },
      // GitHub drops a `<video>` written in a post, and links an attachment that doesn't exist.
      {
        kind: 'paragraph',
        children: [
          web(
            'https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000',
            text('https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000'),
          ),
        ],
      },
      {
        kind: 'paragraph',
        children: [
          {
            kind: 'image',
            url: 'https://private-user-images.githubusercontent.com/353226052/699318603-82098230-e8eb-49e2-8a8c-399d063cb759.png?jwt=REDACTED',
            alt: 'an attachment',
          },
        ],
      },
    ]);
  });

  test('emoji as their text', () => {
    // A custom emoji is an image on a host Lo doesn't load from, so it's its name.
    expect(section(constructs, 'Emoji')).toEqual([
      { kind: 'paragraph', children: [text('👍 🎉 :octocat: and a literal 🎉.')] },
    ]);
  });

  test('tables', () => {
    expect(section(constructs, 'Tables')).toEqual([
      {
        kind: 'table',
        align: ['left', 'center', 'right', 'none'],
        head: [[text('Left')], [text('Center')], [text('Right')], [text('None')]],
        rows: [
          [
            [text('a')],
            [{ kind: 'strong', children: [text('b')] }],
            [{ kind: 'inlineCode', value: 'c' }],
            [web('https://example.com/', text('d'))],
          ],
          [[text('e')], [text('f')], [], [text('h')]],
        ],
      },
    ]);
  });

  test('raw HTML as GitHub lets it through', () => {
    const blocks = section(constructs, 'Raw HTML');
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      children: [
        text('A centered paragraph with '),
        { kind: 'kbd', children: [text('Ctrl')] },
        text('+'),
        { kind: 'kbd', children: [text('C')] },
        text(', H'),
        { kind: 'sub', children: [text('2')] },
        text('O and x'),
        { kind: 'sup', children: [text('2')] },
        text('.'),
      ],
    });
    // GitHub shows a script it refuses as text.
    expect(textOf(blocks)).toContain('<script>alert(1)</script>');
    expect(
      collect({ blocks, notes: [], diagnostics: [] }, 'link').map((link) => link.target),
    ).toEqual([{ kind: 'anchor', name: 'tables' }]);
  });

  test("Lo's own Markdown reads each detail as GitHub renders it", () => {
    const snippets = captured('snippets.json', 'snippets').map((item) => ({
      markdown: field(item, 'markdown'),
      html: field(item, 'html'),
    }));
    const differing = snippets.filter(({ markdown, html }) => {
      const repo = { owner: 'rozed-dev', name: 'e2e' };
      const fromMarkdown = unsuffixed(markdownTree(markdown, { page: PAGE, repo }));
      const fromHtml = unsuffixed(tree({ html, markdown }));
      return JSON.stringify(fromMarkdown) !== JSON.stringify(fromHtml);
    });
    expect(differing.map(({ markdown }) => markdown)).toEqual([]);
  });

  test("real posts: the bot's review comments, and an attached image", () => {
    const posts = captured('posts.json', 'posts').map((item) => ({
      source: field(item, 'source'),
      markdown: field(item, 'markdown'),
      html: field(item, 'html'),
    }));
    expect(posts.length).toBeGreaterThan(10);
    const images = posts.flatMap((post) => collect(tree(post, post.source), 'image'));
    expect(images.map((image) => image.url)).toEqual([
      'https://private-user-images.githubusercontent.com/353226052/699318603-82098230-e8eb-49e2-8a8c-399d063cb759.png?jwt=REDACTED',
    ]);
    const reference = posts.find((post) => post.source.endsWith('/pull/74'));
    expect(collect(tree(reference!, reference!.source), 'link').map((link) => link.target)).toEqual(
      [{ kind: 'web', url: 'https://github.com/rozed-dev/e2e/pull/64' }],
    );
  });
});

describe('bounds', () => {
  test('HTML nested past the depth limit shows as its text', () => {
    const made = tree(`${'<div>'.repeat(60_000)}deep`);
    expect(made.notes).toEqual(['deep']);
    expect(textOf(made.blocks)).toBe('deep');
    const quotes = tree(`<p>top</p>${'<blockquote>'.repeat(40)}inner`);
    expect(quotes.notes).toEqual(['deep']);
    expect(walk(quotes).depth).toBeLessThanOrEqual(DEFAULT_LIMITS.depth);
    expect(textOf(quotes.blocks)).toBe('topinner');
  });

  test("a template's content, which nothing shows, is never read", () => {
    // A template keeps its content apart from the page, and it could nest without end.
    const made = tree({
      html: `<p>shown</p><template>${'<div>'.repeat(60_000)}</template>`,
      markdown: 'fallback',
    });
    expect(made.blocks).toEqual([{ kind: 'paragraph', children: [text('shown')] }]);
  });

  test('HTML that would build too much shows from its Markdown', () => {
    // A formatting element closed early is made again for every later run of text.
    const bold = Array.from({ length: 1_000 }, (_, i) => `<b id=${i}>`).join('');
    const html = `${'<div>'.repeat(200)}${bold}${'</div>x'.repeat(200)}`;
    expect(html.length).toBeLessThan(20_000);
    expect(tree({ html, markdown: 'From *Markdown*.' }).blocks).toEqual([
      {
        kind: 'paragraph',
        children: [text('From '), { kind: 'emphasis', children: [text('Markdown')] }, text('.')],
      },
    ]);
  });

  test('the node limit holds, and the rest shows as text', () => {
    const made = tree('<p>a <b>b</b></p>'.repeat(20_000));
    expect(made.notes).toEqual(['nodes']);
    expect(walk(made).nodes).toBeLessThanOrEqual(DEFAULT_LIMITS.nodes);
    expect(textOf(made.blocks.at(-1))).toMatch(/^a b\n\na b/);
  });

  test('footnotes past the node limit show as their text', () => {
    const notes = Array.from(
      { length: 30 },
      (_, n) => `<li id="user-content-fn-${n}"><p>Note ${n}.</p></li>`,
    ).join('');
    const made = githubTree(
      { html: `<p>x</p><section data-footnotes><ol>${notes}</ol></section>`, markdown: '' },
      { limits: { nodes: 40 } },
    );
    expect(problems(made, { ...DEFAULT_LIMITS, nodes: 40 })).toEqual([]);
    expect(made.notes).toEqual(['nodes']);
    expect(textOf(made.blocks.at(-1))).toContain('Note 29.');
  });

  test('every limit, held to the node', () => {
    const html = fixture('constructs.html');
    const over: unknown[] = [];
    for (let nodes = 16; nodes <= 400; nodes += 7) {
      const walked = walk(githubTree({ html, markdown: '' }, { page: PAGE, limits: { nodes } }), {
        ...DEFAULT_LIMITS,
        nodes,
      });
      if (walked.problems.length > 0) over.push([nodes, walked.problems[0]]);
    }
    expect(over).toEqual([]);
  });
});
