/**
 * Every fixture in `testing/fixtures/markdown/` through the allowlist walker: hostile Markdown
 * shows as Lo's own nodes only, with web links, GitHub's images and limits held, in bounded time.
 */

import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { markdownTree, type Tree } from '../src/index.ts';
import { collect } from './support.ts';
import { isRecord, problems } from './walker.ts';

const HOSTILE = new URL('../../../../testing/fixtures/markdown/hostile/', import.meta.url);
const OPTIONS = {
  page: 'https://github.com/octo/repo/pull/1',
  repo: { owner: 'octo', name: 'repo' },
};

/**
 * The longest any one input may take, in milliseconds. The slowest generated input takes about
 * 60 ms on a laptop; this leaves room for a slow CI runner while still failing anything that
 * grows faster than its text.
 */
const LIMIT = 1_000;

function hostile(name: string): Tree {
  return markdownTree(readFileSync(new URL(name, HOSTILE), 'utf8'), OPTIONS);
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
  const files = readdirSync(HOSTILE).filter((name) => name.endsWith('.md'));

  test('there are some', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
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

describe('generated inputs', () => {
  const inputs = generated(JSON.parse(readFileSync(new URL('generated.json', HOSTILE), 'utf8')));

  test('there are some', () => {
    expect(inputs.length).toBeGreaterThanOrEqual(40);
  });

  test.each(inputs.map((input) => [input.name, input] as const))('%s', (_name, input) => {
    const text = input.parts.map(([part, times]) => part.repeat(times)).join('');
    const { made, elapsed } = timed(() => markdownTree(text, OPTIONS));
    expect(problems(made)).toEqual([]);
    expect(elapsed).toBeLessThan(LIMIT);
    // What the tree says about it, where the input says.
    expect(made.notes).toEqual(input.notes ?? made.notes);
  });
});
