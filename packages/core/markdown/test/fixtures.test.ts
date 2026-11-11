/**
 * Every fixture in `testing/fixtures/markdown/` through the allowlist walker: hostile Markdown
 * shows as Lo's own nodes only, with web links, GitHub's images and limits held, in bounded time.
 */

import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { githubTree, markdownTree, type Tree } from '../src/index.ts';
import { collect, textOf } from './support.ts';
import { isRecord, problems } from './walker.ts';

const HOSTILE = new URL('../../../../testing/fixtures/markdown/hostile/', import.meta.url);
const GITHUB = new URL('../../../../testing/fixtures/markdown/github/', import.meta.url);
const OPTIONS = {
  page: 'https://github.com/octo/repo/pull/1',
  repo: { owner: 'octo', name: 'repo' },
};

/**
 * The longest any one input may take, in milliseconds. The slowest takes about 250 ms on a
 * laptop and some 800 ms on a Linux CI runner running test files side by side; anything that
 * grows faster than its text takes far longer at these sizes.
 */
const LIMIT = 2_500;

function hostile(name: string): Tree {
  const text = readFileSync(new URL(name, HOSTILE), 'utf8');
  return name.endsWith('.html')
    ? githubTree({ html: text, markdown: 'fallback' }, OPTIONS)
    : markdownTree(text, OPTIONS);
}

function timed<T>(make: () => T): { made: T; elapsed: number } {
  const started = performance.now();
  const made = make();
  return { made, elapsed: performance.now() - started };
}

interface Generated {
  name: string;
  parts: [string, number][];
  notes?: string[];
}

/** The inputs `generated.json` lists, checked for its shape. */
function generated(json: unknown): Generated[] {
  const inputs: unknown = isRecord(json) ? json['inputs'] : undefined;
  if (!Array.isArray(inputs)) throw new Error('generated.json lists no inputs');
  return inputs.map((input: unknown): Generated => {
    if (!isRecord(input) || typeof input['name'] !== 'string' || !Array.isArray(input['parts'])) {
      throw new Error(`generated.json has an input of another shape: ${JSON.stringify(input)}`);
    }
    const parts = input['parts'].map((part: unknown): [string, number] => {
      if (!Array.isArray(part) || typeof part[0] !== 'string' || typeof part[1] !== 'number') {
        throw new Error(`${String(input['name'])} has a part of another shape`);
      }
      return [part[0], part[1]];
    });
    const notes: unknown = input['notes'];
    return Array.isArray(notes)
      ? { name: input['name'], parts, notes: notes.map(String) }
      : { name: input['name'], parts };
  });
}

describe('hostile files', () => {
  const files = readdirSync(HOSTILE).filter(
    (name) => name.endsWith('.md') || name.endsWith('.html'),
  );

  test('there are some', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  test.each(files)('%s holds only what Lo allows', (name) => {
    const { made, elapsed } = timed(() => hostile(name));
    expect(problems(made)).toEqual([]);
    expect(elapsed).toBeLessThan(LIMIT);
  });

  test('scripts and handlers are only text', () => {
    const made = hostile('scripts.md');
    expect(collect(made, 'link').map((link) => link.target)).toEqual([
      { kind: 'web', url: 'https://example.com/' },
    ]);
    expect(collect(made, 'image').map((image) => [image.url, image.alt])).toEqual([
      ['https://camo.githubusercontent.com/a', '<script>alert(1)</script>'],
    ]);
  });

  test('links that are no web page are text, and the rest are normalized', () => {
    const made = hostile('links.md');
    expect(collect(made, 'link').map((link) => link.target)).toEqual(
      [
        // `javascript%3A` is no scheme, only a path on the page.
        'https://github.com/octo/repo/pull/javascript%3Aalert(1)',
        // Lookalikes read as punycode; full-width letters are the letters they look like.
        'https://xn--80ak6aa92e.com/',
        'https://github.com/',
        'https://evil.example/x',
        'https://github.com/evil.example/x',
        // Blank links go to the page.
        'https://github.com/octo/repo/pull/1',
        'https://github.com/octo/repo/pull/1',
        'http://www.example.com/path',
        'http://ok.example/',
        'https://example.com/',
      ].map((url) => ({ kind: 'web', url })),
    );
    expect(collect(made, 'image')).toEqual([]);
  });

  test("images load only from GitHub's image hosts", () => {
    const made = hostile('images.md');
    expect(collect(made, 'image').map((image) => image.url)).toEqual([
      'https://camo.githubusercontent.com/abc/68747470733a2f2f652e636f6d2f612e706e67',
      'https://github.com/user-attachments/assets/cbe34088-7125-49ac-b6ed-ce17762af48a',
    ]);
  });

  test("names like Lo's own are only names", () => {
    const made = hostile('ids.md');
    expect(collect(made, 'heading').map((heading) => heading.anchor)).toEqual([
      'root',
      'app',
      'lo-app',
      // `__proto__` is strong emphasis.
      'proto',
      'constructor',
      'tostring',
      'hasownproperty',
      'window',
      'document',
      'user-content-root',
      // A footnote has this one.
      'fn-1-1',
      'root-1',
    ]);
    expect(collect(made, 'footnoteReference').map((reference) => reference.name)).toEqual([
      'fn-__proto__',
      'fn-constructor',
      'fn-toString',
      'fn-1',
    ]);
  });
});

/** An input's text: its parts, `{i}` in each part the time it's written. */
function inputText(input: Generated): string {
  return input.parts
    .map(([part, times]) =>
      part.includes('{i}')
        ? Array.from({ length: times }, (_, i) => part.replaceAll('{i}', String(i))).join('')
        : part.repeat(times),
    )
    .join('');
}

describe.each([
  ['generated Markdown', 'generated.json', (text: string) => markdownTree(text, OPTIONS)],
  [
    'generated HTML',
    'generated-html.json',
    (text: string) => githubTree({ html: text, markdown: 'fallback' }, OPTIONS),
  ],
] as const)('%s', (_kind, file, make) => {
  const inputs = generated(JSON.parse(readFileSync(new URL(file, HOSTILE), 'utf8')));

  test('there are some', () => {
    expect(inputs.length).toBeGreaterThanOrEqual(30);
  });

  test.each(inputs.map((input) => [input.name, input] as const))('%s', (_name, input) => {
    const text = inputText(input);
    const { made, elapsed } = timed(() => make(text));
    expect(problems(made)).toEqual([]);
    expect(elapsed).toBeLessThan(LIMIT);
    // What the tree says about it, where the input says.
    expect(made.notes).toEqual(input.notes ?? made.notes);
  });
});

describe('hostile HTML', () => {
  test('scripts and handlers are gone, their text aside', () => {
    const made = hostile('scripts.html');
    expect(collect(made, 'link').map((link) => link.target)).toEqual([
      // `<img src=x>`, twice: an image Lo won't load is a link to where it is.
      { kind: 'web', url: 'https://github.com/octo/repo/pull/x' },
      { kind: 'web', url: 'https://github.com/octo/repo/pull/x' },
      { kind: 'web', url: 'https://example.com/' },
    ]);
    expect(collect(made, 'image')).toEqual([]);
    const shown = JSON.stringify(made.blocks);
    for (const hidden of ['In a template.', 'svg link', 'evil.example']) {
      expect(shown).not.toContain(hidden);
    }
    // A form's text is only text: a text area's, and a list's options.
    expect(textOf(made.blocks)).toContain('<script>alert(1)</script> One');
  });

  test('links that are no web page are text, and the rest are normalized', () => {
    const made = hostile('links.html');
    expect(collect(made, 'link').map((link) => link.target)).toEqual(
      [
        'https://xn--80ak6aa92e.com/',
        'https://evil.example/x',
        'https://github.com/octo/repo/pull/1#user-content-nowhere',
        'https://github.com/octo/repo/pull/1#',
        'https://github.com/octo/repo/pull/1',
        // A link can't hold a link, so the HTML parser closes the outer one.
        'https://inner.example/',
        'https://example.com/',
      ].map((url) => ({ kind: 'web', url })),
    );
  });

  test("images load only from GitHub's image hosts, whatever the HTML claims", () => {
    const made = hostile('images.html');
    expect(collect(made, 'image').map((image) => image.url)).toEqual([
      'https://camo.githubusercontent.com/a',
      'https://camo.githubusercontent.com/b',
      'https://camo.githubusercontent.com/c',
    ]);
    // `data-canonical-src` is never read, nor `srcset`, `poster` or a background.
    const shown = JSON.stringify(made.blocks);
    for (const hidden of [
      'ignored.png',
      '1x.png',
      'poster.png',
      'bg.png',
      'dark.png',
      'input.png',
      'svg.png',
    ]) {
      expect(shown).not.toContain(hidden);
    }
  });

  test("names like Lo's own are only names", () => {
    const made = hostile('ids.html');
    expect(collect(made, 'heading').map((heading) => heading.anchor)).toEqual([
      'root',
      '__proto__',
      'constructor',
    ]);
    expect(
      collect(made, 'footnotes')[0]?.items.map((item) => [item.name, textOf(item.children)]),
    ).toEqual([
      ['fn-constructor', 'The note. back'],
      // A footnote with a name already taken, or none, still shows.
      ['fn-2-1', 'The same name again.'],
      ['fn-__proto__', 'Proto.'],
      ['fn-4-1', 'No name.'],
    ]);
    // A reference to a footnote that isn't there is its text.
    expect(collect(made, 'footnoteReference').map((reference) => reference.name)).toEqual([
      'fn-constructor',
    ]);
  });

  test("GitHub's markup, forged, gives only what Lo makes of it", () => {
    const made = hostile('markup.html');
    expect(collect(made, 'mention')).toEqual([
      // A mention links to the page of the name it shows, whatever its address.
      { kind: 'mention', name: 'admin', url: 'https://github.com/admin' },
      { kind: 'mention', name: 'o/t', url: 'https://github.com/orgs/o/teams/t' },
    ]);
    expect(collect(made, 'code').map((code) => code.language)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'mermaid',
    ]);
    expect(collect(made, 'list')[0]?.items.map((item) => item.checked)).toEqual([
      true,
      undefined,
      undefined,
      undefined,
    ]);
    expect(textOf(made.blocks)).toContain('A link hidden as a permalink');
  });
});

describe("GitHub's renderings", () => {
  test.each(['constructs.html', 'snippets.json', 'posts.json'])(
    '%s holds only what Lo allows',
    (name) => {
      const text = readFileSync(new URL(name, GITHUB), 'utf8');
      const renderings: string[] = [];
      if (name.endsWith('.html')) renderings.push(text);
      else {
        const json: unknown = JSON.parse(text);
        for (const list of isRecord(json) ? Object.values(json) : []) {
          for (const item of Array.isArray(list) ? list : []) {
            if (isRecord(item) && typeof item['html'] === 'string') renderings.push(item['html']);
          }
        }
      }
      expect(renderings.length).toBeGreaterThan(0);
      const found = renderings.flatMap((html) =>
        problems(githubTree({ html, markdown: '' }, OPTIONS)),
      );
      expect(found).toEqual([]);
    },
  );
});
