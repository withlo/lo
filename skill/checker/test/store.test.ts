/**
 * The repository's definitions, as the checker reads them from `refs/lo/terms` in the repository
 * it runs in, and checks an overview's marks against: that ref exactly, a commit, holding
 * `terms.json` as a file. Each test sets the ref in a repository of its own.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { STORE_LIMITS } from '@lo/artifact';
import { git, gitBytes, testGitEnvironment } from '@lo/testing/git';

import { gitIn } from '../src/git.ts';
import { repositoryStore } from '../src/store.ts';
import { overview, repositoryOf, runChecker, runJson, scratch } from './support.ts';

let root: ReturnType<typeof scratch>;
let repo: string;
let commit: string;

beforeAll(() => {
  root = scratch('store');
  repo = join(root.dir, 'repo');
  mkdirSync(repo);
  commit = repositoryOf(repo, { 'src/a.ts': 'one\n' });
});

afterAll(() => root.remove());

/** A store holding Bucket, defined as `definition`, with the alias "buckets". */
function store(definition = 'The tokens a tenant has.'): string {
  return JSON.stringify({
    format: 1,
    terms: {
      bucket: {
        term: 'Bucket',
        definition,
        aliases: ['buckets'],
        written: 'agent',
        by: { login: 'octocat' },
        from: '#4790',
        at: '2026-11-27T10:30:00Z',
      },
    },
  });
}

/** Writes `contents` as a blob, and returns its id. */
function blob(contents: string | Uint8Array): string {
  return gitBytes(repo, ['hash-object', '-w', '--stdin'], contents).toString('utf8').trim();
}

/** A commit of a tree of `entries`, each a line of `git mktree`'s input, and its id. */
function commitOf(...entries: string[]): string {
  const tree = gitBytes(repo, ['mktree'], entries.map((entry) => `${entry}\n`).join(''))
    .toString('utf8')
    .trim();
  return git(repo, 'commit-tree', tree, '-m', 'Definitions');
}

/** Points `ref`, `refs/lo/terms` unless given, at `id`; every other ref under it is taken away. */
function point(id: string | undefined, ref = 'refs/lo/terms'): void {
  for (const each of git(repo, 'for-each-ref', '--format=%(refname)', 'refs/lo/').split('\n')) {
    if (each !== '') git(repo, 'update-ref', '-d', each);
  }
  if (id !== undefined) git(repo, 'update-ref', ref, id);
}

/** The store read from the repository, as `code@where` for a problem, or `read`, or `none`. */
async function read(): Promise<string> {
  const found = await repositoryStore(gitIn(repo, testGitEnvironment()));
  if (found === undefined) return 'none';
  return found.ok ? 'read' : `${found.problem.code}: ${found.problem.message}`;
}

let made = 0;

/**
 * A folder holding an overview at the repository's commit with `glossary`, a list of items, whose
 * terms its line 11 links, so the first item is on line 15.
 */
function folder(...glossary: string[]): string {
  const dir = join(root.dir, `overview-${made++}`);
  mkdirSync(dir);
  const links = glossary.map((item) => `[x](term:${/\*\*(.*?)\*\*/.exec(item)?.[1] ?? ''})`);
  const body = `${links.join(' ')}\n\n## Glossary\n\n${glossary.join('\n')}\n`;
  const text = overview(commit, body);
  writeFileSync(join(dir, 'artifact.md'), text);
  return dir;
}

describe('the repository’s definitions', () => {
  test('are terms.json in the commit at refs/lo/terms', async () => {
    point(commitOf(`100644 blob ${blob(store())}\tterms.json`));
    expect(await read()).toBe('read');
    // Other files beside it are left alone.
    point(commitOf(`100644 blob ${blob(store())}\tterms.json`, `100644 blob ${blob('x')}\tREADME`));
    expect(await read()).toBe('read');
  });

  test('are none without that ref exactly', async () => {
    point(undefined);
    expect(await read()).toBe('none');
    const id = commitOf(`100644 blob ${blob(store())}\tterms.json`);
    for (const other of ['refs/lo/terms/old', 'refs/heads/refs/lo/terms', 'refs/lo/termsx']) {
      point(id, other);
      expect(await read()).toBe('none');
    }
  });

  test('can’t be read from a ref that isn’t a commit, or a commit without terms.json as a file', async () => {
    const terms = blob(store());
    point(terms);
    expect(await read()).toBe("commit: refs/lo/terms isn't a commit.");
    // An annotated tag of a commit is a tag, not the commit.
    const tag = gitBytes(
      repo,
      ['mktag'],
      `object ${commitOf(`100644 blob ${terms}\tterms.json`)}\ntype commit\ntag t\ntagger Lo test <test@lo.invalid> 1767225600 +0000\n\nA tag.\n`,
    )
      .toString('utf8')
      .trim();
    point(tag);
    expect(await read()).toBe("commit: refs/lo/terms isn't a commit.");
    point(commitOf(`100644 blob ${terms}\tTerms.json`));
    expect(await read()).toBe('commit: The commit at refs/lo/terms has no terms.json.');
    point(commitOf(`120000 blob ${blob('other.json')}\tterms.json`));
    expect(await read()).toBe("commit: terms.json, at refs/lo/terms, is a link. It's a file.");
    const inside = gitBytes(repo, ['mktree'], `100644 blob ${terms}\tterms.json\n`)
      .toString('utf8')
      .trim();
    point(commitOf(`040000 tree ${inside}\tterms.json`));
    expect(await read()).toBe("commit: terms.json, at refs/lo/terms, is a folder. It's a file.");
  });

  test('are refused past their size, or when the store’s rules refuse them', async () => {
    const large = `${store()}${' '.repeat(STORE_LIMITS.size)}`;
    point(commitOf(`100644 blob ${blob(large)}\tterms.json`));
    expect(await read()).toMatch(/^too-large: /);
    point(commitOf(`100644 blob ${blob('{"format": 1, "terms": ')}\tterms.json`));
    expect(await read()).toMatch(/^syntax: /);
    point(commitOf(`100644 blob ${blob(store('The **tokens**.'))}\tterms.json`));
    expect(await read()).toMatch(/^shape: /);
  });

  test('reject when git can’t read them', async () => {
    // A commit naming a tree the repository lacks.
    const broken = gitBytes(
      repo,
      ['hash-object', '-t', 'commit', '-w', '--stdin', '--literally'],
      `tree ${'1'.repeat(40)}\nauthor Lo test <test@lo.invalid> 1767225600 +0000\ncommitter Lo test <test@lo.invalid> 1767225600 +0000\n\nBroken.\n`,
    )
      .toString('utf8')
      .trim();
    point(broken);
    await expect(read()).rejects.toThrow(`The repository lacks tree ${'1'.repeat(40)}.`);
  });
});

describe('check, against them', () => {
  test('passes marks that say how each term stands to them', () => {
    point(commitOf(`100644 blob ${blob(store())}\tterms.json`));
    const ran = runChecker(
      [
        'check',
        folder('- **Bucket**: The tokens a tenant has.', '- **Token** (new): One request.'),
      ],
      repo,
    );
    expect(ran).toEqual({ status: 0, stdout: 'No errors or warnings.\n', stderr: '' });
  });

  test('fails one that doesn’t, and commits nothing', () => {
    point(commitOf(`100644 blob ${blob(store())}\tterms.json`));
    const dir = folder('- **Bucket**: Tokens.');
    const ran = runJson(['check', dir], repo);
    expect(ran.status).toBe(1);
    expect(ran.findings.map(({ code, line }) => `${code}@${line}`)).toEqual(['term-differs@15']);
    expect(ran.outcome).toBe('shown');
    const committed = runChecker(['commit', dir, '--pr', '4797'], repo);
    expect(committed.status).toBe(1);
    expect(committed.stdout).toMatch(/Nothing was committed\.\n$/);
  });

  test('without them, leaves the marks unchecked', () => {
    point(undefined);
    expect(runChecker(['check', folder('- **Bucket**: Tokens.')], repo).status).toBe(0);
  });

  test('warns when they can’t be used, and passes', () => {
    point(blob(store()));
    const ran = runJson(['check', folder('- **Bucket**: Tokens.')], repo);
    expect(ran.status).toBe(0);
    expect(ran.findings).toEqual([
      {
        code: 'store-unread',
        severity: 'warning',
        file: 'artifact.md',
        message:
          "The repository's definitions, at refs/lo/terms, can't be read, so the glossary's marks weren't checked. refs/lo/terms isn't a commit.",
      },
    ]);
  });

  test('can’t check when git can’t read them, saying why', () => {
    const broken = gitBytes(
      repo,
      ['hash-object', '-t', 'commit', '-w', '--stdin', '--literally'],
      `tree ${'2'.repeat(40)}\nauthor Lo test <test@lo.invalid> 1767225600 +0000\ncommitter Lo test <test@lo.invalid> 1767225600 +0000\n\nBroken.\n`,
    )
      .toString('utf8')
      .trim();
    point(broken);
    const ran = runJson(['check', folder('- **Bucket**: Tokens.')], repo);
    expect(ran.status).toBe(2);
    expect(ran.incomplete).toEqual([
      `The repository's definitions, at refs/lo/terms, couldn't be read: The repository lacks tree ${'2'.repeat(40)}.`,
    ]);
    expect(ran.findings.map(({ code }) => code)).toEqual(['store-unread']);
  });

  test('isn’t read for an overview with no glossary', () => {
    point(blob(store()));
    const dir = join(root.dir, `overview-${made++}`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'artifact.md'), overview(commit));
    expect(runJson(['check', dir], repo)).toMatchObject({ status: 0, findings: [] });
  });
});
