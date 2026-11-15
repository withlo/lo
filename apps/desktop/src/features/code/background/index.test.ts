// The syntax index's jobs as the background process runs them: the version they stamp what they
// read with, and a language the index has no tags for, which is skipped. What tags each language
// reads is `@lo/syntax`'s, tested there.

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
