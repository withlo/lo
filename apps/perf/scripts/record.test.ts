import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, onTestFinished, test } from 'vitest';

import { dataFolder, type Manifest, manifestNames, readManifest } from '../src/data/manifest.ts';
import { serialize, tokenSources, toFile, toThread } from './record.ts';

const fakeToken = `ghp_${'X9y8'.repeat(9)}`;

function home(files: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), 'lo-perf-'));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, '.config', 'rozed-dev'), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(folder, '.config', 'rozed-dev', name), text);
  }
  return folder;
}

describe('tokenSources', () => {
  test('tries the OAuth token first, then the one in bot.env', () => {
    const folder = home({
      'oauth-token': `${fakeToken}\n`,
      'bot.env': `ROZED_BOT_TOKEN='ghp_${'Z'.repeat(36)}'\n`,
    });
    expect(tokenSources({}, folder).map(({ token }) => token)).toEqual([
      fakeToken,
      `ghp_${'Z'.repeat(36)}`,
    ]);
  });

  test('reads bot.env alone when there’s no OAuth token', () => {
    const folder = home({ 'bot.env': `OTHER=1\nexport ROZED_BOT_TOKEN=${fakeToken}\n` });
    expect(tokenSources({}, folder)).toEqual([
      { file: join(folder, '.config/rozed-dev/bot.env'), token: fakeToken },
    ]);
  });

  test('uses only the file LO_FIXTURE_TOKEN_FILE names', () => {
    const folder = home({ 'oauth-token': `ghp_${'Z'.repeat(36)}`, mine: fakeToken });
    const file = join(folder, '.config/rozed-dev/mine');
    expect(tokenSources({ LO_FIXTURE_TOKEN_FILE: file }, folder)).toEqual([
      { file, token: fakeToken },
    ]);
  });

  test('refuses a file that holds no token, without repeating what it holds', () => {
    const folder = home({ 'oauth-token': 'hunter2 is my password' });
    expect(() => tokenSources({}, folder)).toThrow(/doesn't hold a GitHub token\.$/);
    expect(() => tokenSources({}, folder)).not.toThrow(/hunter2/);
  });

  test('fails when there’s no token anywhere', () => {
    expect(() => tokenSources({}, home({}))).toThrow(/LO_FIXTURE_TOKEN_FILE/);
  });
});

describe('toFile', () => {
  test('takes the path and status from REST and the counts from GraphQL', () => {
    expect(
      toFile(
        { filename: 'b.ts', previous_filename: 'a.ts', status: 'renamed' },
        { path: 'b.ts', additions: 3, deletions: 4 },
      ),
    ).toEqual({
      path: 'b.ts',
      previousPath: 'a.ts',
      status: 'renamed',
      additions: 3,
      deletions: 4,
    });
  });
});

describe('toThread', () => {
  const thread = {
    id: 'T1',
    path: 'a.go',
    diffSide: 'RIGHT' as const,
    line: 12,
    originalLine: 10,
    isOutdated: false,
    subjectType: 'LINE' as const,
    comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  };

  test('keeps where it is and each comment’s length, never the words', () => {
    expect(toThread(thread, ['Looks good', 'Thanks! 🎉'])).toEqual({
      path: 'a.go',
      side: 'right',
      line: 12,
      comments: [10, 10],
    });
  });

  test('puts an outdated thread on the line it was on', () => {
    expect(toThread({ ...thread, line: null, isOutdated: true, diffSide: 'LEFT' }, ['x'])).toEqual({
      path: 'a.go',
      side: 'left',
      line: 10,
      outdated: true,
      comments: [1],
    });
  });

  test('gives a thread on the whole file no line', () => {
    const file = { ...thread, line: null, originalLine: null, subjectType: 'FILE' as const };
    expect(toThread(file, ['x'])).toEqual({ path: 'a.go', side: 'right', comments: [1] });
  });
});

describe('serialize', () => {
  const manifest: Manifest = {
    repo: 'example/repo',
    number: 7,
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
    files: [{ path: 'a.ts', status: 'modified', additions: 1, deletions: 2 }],
    threads: [{ path: 'a.ts', side: 'right', line: 1, comments: [5] }],
  };

  test('writes one line per file and thread', async () => {
    expect(await serialize(manifest)).toBe(`{
  "repo": "example/repo",
  "number": 7,
  "base": "${'a'.repeat(40)}",
  "head": "${'b'.repeat(40)}",
  "files": [{ "path": "a.ts", "status": "modified", "additions": 1, "deletions": 2 }],
  "threads": [{ "path": "a.ts", "side": "right", "line": 1, "comments": [5] }]
}
`);
  });

  test.each(manifestNames())('wrote %s as it is committed', async (name) => {
    const committed = readFileSync(join(dataFolder, `${name}.json`), 'utf8');
    expect(await serialize(readManifest(name))).toBe(committed);
  });

  test('refuses to write anything shaped like a token', async () => {
    const files = [{ ...manifest.files[0]!, path: `leak/${fakeToken}.ts` }];
    await expect(serialize({ ...manifest, files })).rejects.toThrow(/Refusing to write/);
  });

  test('refuses to write the token itself', async () => {
    const files = [{ ...manifest.files[0]!, path: 'leak/s3cret.ts' }];
    await expect(serialize({ ...manifest, files }, 's3cret')).rejects.toThrow(/Refusing to write/);
  });
});
