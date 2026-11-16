// The syntax index's jobs as the background process runs them: the version they stamp what they
// read with, and a language the index has no tags for, which is skipped; and a hover's Markdown,
// read as text from anyone, ahead of the index's jobs. What tags each language reads is
// `@lo/syntax`'s, tested there, and how Markdown is read is `@lo/markdown`'s.

import { tagsVersion } from '@lo/syntax';
import { describe, expect, it } from 'vitest';

import runner from './index.ts';

describe('the syntax index’s jobs', () => {
  it('say the version they read with, and skip a language without tags', async () => {
    const { symbols } = runner.jobs;
    expect(await symbols?.run({ files: [] })).toEqual({ version: tagsVersion, files: [] });
    const bytes = new TextEncoder().encode('IDENTIFICATION DIVISION.');
    expect(await symbols?.run({ files: [{ language: 'cobol', bytes }] })).toEqual({
      version: tagsVersion,
      files: [{ skipped: 'language' }],
    });
  });
});

describe('a hover’s Markdown', () => {
  it('is Lo’s tree, its raw HTML text, its paragraphs’ line breaks spaces', async () => {
    const { render } = runner.jobs;
    const tree = await render?.run({
      markdown: '```ts\nconst a: number\n```\n\nThe <b>count</b>\nof things, see #12.',
      repo: { owner: 'rozed-dev', name: 'e2e' },
    });
    expect(tree).toMatchObject({
      blocks: [{ kind: 'code', language: 'ts', text: 'const a: number' }, { kind: 'paragraph' }],
    });
    const text = JSON.stringify(tree);
    expect(text).toContain('<b>');
    expect(text).not.toContain('"break"');
    // `#12` refers to the repository's.
    expect(text).toContain('rozed-dev');
  });

  it('is read ahead of the index’s jobs, since the reader waits on it', () => {
    expect(runner.jobs.render?.asked).toBe(true);
    expect(runner.jobs.symbols?.asked).toBeUndefined();
  });
});
