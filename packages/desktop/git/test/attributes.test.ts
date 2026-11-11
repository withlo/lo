// Reading attributes from a commit's `.gitattributes` files.

import { blobId, missingObjects, packs } from '@lo/testing/git';
import { expect, test } from 'vitest';

import type { Attribute } from '../src/attributes.ts';
import type { Cache } from '../src/cache.ts';
import { GitError } from '../src/errors.ts';
import { type Oid, parseOid } from '../src/oid.ts';
import type { Repo } from '../src/repo.ts';
import { cacheFor, repoServer } from './support.ts';

/**
 * A pull request whose head changes what `.gitattributes` says, fetched into a clone. The head has
 * a top-level `.gitattributes`, with a macro, and another in `sub/`.
 */
interface Fixture {
  base: Oid;
  head: Oid;
  repo: Repo;
  headAttributes: string;
}

async function fixture(): Promise<Fixture> {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote
    .write('.gitattributes', '*.pb.go -linguist-generated\n')
    .write('api.pb.go', 'package api\n')
    .write('src/main.rs', 'fn main() {}\n');
  const base = parseOid(remote.commit('base'));

  remote
    .switch('feature')
    .write(
      '.gitattributes',
      '[attr]generated linguist-generated\n' +
        '*.pb.go linguist-generated\n' +
        'Cargo.lock -linguist-generated\n' +
        'dist/** linguist-generated=true\n' +
        'keep.ts linguist-generated=false\n' +
        'odd.ts linguist-generated=maybe\n' +
        '*.gen generated\n',
    )
    .write('sub/.gitattributes', '*.rs linguist-generated\n')
    .write('api.pb.go', 'package api // changed\n')
    .write('Cargo.lock', '# lock\n')
    .write('dist/app.js', 'app()\n')
    .write('keep.ts', 'keep\n')
    .write('odd.ts', 'odd\n')
    .write('schema.gen', 'schema\n')
    .write('sub/lib.rs', 'pub fn lib() {}\n')
    .remove('src/main.rs');
  const head = parseOid(remote.commit('head'));
  remote.publish('refs/pull/1/head');
  remote.switch('trunk').publish('refs/heads/trunk');
  const headAttributes = blobId(remote.work, head, '.gitattributes');

  const repo = await (await cacheFor(server)).open('owner', 'repo');
  await repo.fetchPull({ number: 1, head, baseBranch: 'trunk' });
  return { base, head, repo, headAttributes };
}

/** A pull request whose head adds `files` to a base with a README, fetched into a clone. */
interface Pull {
  head: Oid;
  work: string;
  cache: Cache;
  repo: Repo;
}

async function pull(files: readonly (readonly [string, string])[]): Promise<Pull> {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote.write('README', 'readme\n').commit('base');
  remote.switch('feature');
  for (const [path, contents] of files) remote.write(path, contents);
  const head = parseOid(remote.commit('head'));
  remote.publish('refs/pull/1/head');
  remote.switch('trunk').publish('refs/heads/trunk');
  const cache = await cacheFor(server);
  const repo = await cache.open('owner', 'repo');
  await repo.fetchPull({ number: 1, head, baseBranch: 'trunk' });
  return { head, work: remote.work, cache, repo };
}

const bytes = (paths: readonly string[]) => paths.map((path) => Buffer.from(path));

/** What `linguist-generated` is for each of `paths` in `rev`, its `.gitattributes` downloaded first. */
async function linguistGenerated(
  repo: Repo,
  rev: Oid,
  paths: readonly string[],
): Promise<(Attribute | undefined)[]> {
  expect(await repo.downloadAttributes(rev, bytes(paths))).toEqual([]);
  return repo.attribute(rev, 'linguist-generated', bytes(paths));
}

async function failure(promise: Promise<unknown>): Promise<GitError> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof GitError)) throw new Error(`expected a GitError, got ${String(error)}`);
  return error;
}

test('reads an attribute from a commits gitattributes', async () => {
  const f = await fixture();
  // The partial clone hasn't downloaded the head's `.gitattributes` yet, and reading alone doesn't.
  expect(missingObjects(f.repo.folder, f.head)).toContain(f.headAttributes);
  const paths = [
    'api.pb.go',
    'Cargo.lock',
    'dist/app.js',
    'keep.ts',
    'odd.ts',
    'schema.gen',
    'sub/lib.rs',
    // Deleted by the head, and never in the repository: patterns still match names.
    'src/main.rs',
    'elsewhere/other.pb.go',
  ];
  expect(await f.repo.attribute(f.head, 'linguist-generated', bytes(paths))).toEqual(
    paths.map(() => undefined),
  );

  const attributes = await linguistGenerated(f.repo, f.head, paths);

  expect(attributes).toEqual([
    'set',
    'unset',
    { value: 'true' },
    { value: 'false' },
    { value: 'maybe' },
    // Through the `generated` macro.
    'set',
    // From `sub/.gitattributes`.
    'set',
    'unspecified',
    'set',
  ]);
  // Downloaded to read it.
  expect(missingObjects(f.repo.folder, f.head)).not.toContain(f.headAttributes);
});

test('each commit answers with its own gitattributes', async () => {
  const f = await fixture();
  expect(await linguistGenerated(f.repo, f.base, ['api.pb.go', 'Cargo.lock'])).toEqual([
    'unset',
    'unspecified',
  ]);
  expect(await linguistGenerated(f.repo, f.head, ['api.pb.go', 'Cargo.lock'])).toEqual([
    'set',
    'unset',
  ]);
});

test('names that arent utf8 or hold a line break are answered', async () => {
  const f = await fixture();
  const paths = [Buffer.from('caf\xe9.pb.go', 'latin1'), Buffer.from('line\nbreak.pb.go')];
  expect(await f.repo.downloadAttributes(f.head, paths)).toEqual([]);

  const attributes = await f.repo.attribute(f.head, 'linguist-generated', paths);

  expect(attributes).toEqual(['set', 'set']);
});

test('no paths ask git nothing', async () => {
  const f = await fixture();
  expect(await f.repo.attribute(f.head, 'linguist-generated', [])).toEqual([]);
  expect(await f.repo.downloadAttributes(f.head, [])).toEqual([]);
});

test('refuses attribute names and paths git would misread', async () => {
  const f = await fixture();
  for (const name of ['', '-linguist-generated', 'two words', 'a\0b']) {
    const error = await failure(f.repo.attribute(f.head, name, bytes(['a'])));
    expect.soft([name, error.detail.kind]).toEqual([name, 'invalid']);
  }
  for (const path of ['', 'a\0b']) {
    const read = await failure(f.repo.attribute(f.head, 'linguist-generated', bytes([path])));
    const download = await failure(f.repo.downloadAttributes(f.head, bytes([path])));
    expect
      .soft([path, read.detail.kind, download.detail.kind])
      .toEqual([path, 'invalid', 'invalid']);
  }
});

test('a commit the clone lacks is an error', async () => {
  const f = await fixture();
  const unknown = parseOid('3333333333333333333333333333333333333333');
  const notFetched = { kind: 'notFetched', oid: unknown };
  expect(
    (await failure(f.repo.attribute(unknown, 'linguist-generated', bytes(['a'])))).detail,
  ).toEqual(notFetched);
  expect((await failure(f.repo.downloadAttributes(unknown, bytes(['a'])))).detail).toEqual(
    notFetched,
  );
});

test('patterns match case sensitively whatever the disk', async () => {
  const p = await pull([
    ['.gitattributes', 'Dist/** linguist-generated\n*.JS linguist-generated\n'],
    ['dist/app.js', 'app()\n'],
  ]);
  // On a Mac's disk, the clone's config says case doesn't matter, which mustn't change the answer.
  expect(await linguistGenerated(p.repo, p.head, ['dist/app.js', 'Dist/App.JS'])).toEqual([
    'unspecified',
    'set',
  ]);
});

test('a nested gitattributes overrides its parents', async () => {
  const p = await pull([
    ['.gitattributes', '*.js linguist-generated\n'],
    ['vendor/.gitattributes', '*.js -linguist-generated\n'],
    ['app.js', 'app()\n'],
    ['vendor/lib.js', 'lib()\n'],
    ['vendor/deep/x.js', 'x()\n'],
  ]);
  expect(
    await linguistGenerated(p.repo, p.head, ['app.js', 'vendor/lib.js', 'vendor/deep/x.js']),
  ).toEqual(['set', 'unset', 'unset']);
});

test('the gitattributes that apply download together and no others', async () => {
  const p = await pull([
    ['.gitattributes', '*.txt linguist-generated\n'],
    ['a/.gitattributes', '*.txt -linguist-generated\n'],
    ['a/b/.gitattributes', '*.txt linguist-generated=true\n'],
    ['c/.gitattributes', '*.txt linguist-generated=false\n'],
    ['a/b/f.txt', 'f\n'],
    ['c/g.txt', 'g\n'],
  ]);
  const blob = (path: string) => blobId(p.work, p.head, path);
  const applying = ['.gitattributes', 'a/.gitattributes', 'a/b/.gitattributes'].map(blob);
  const missing = missingObjects(p.repo.folder, p.head);
  expect(applying.filter((oid) => !missing.includes(oid))).toEqual([]);
  const before = packs(p.repo.folder);

  expect(await linguistGenerated(p.repo, p.head, ['a/b/f.txt'])).toEqual([{ value: 'true' }]);

  // One download.
  expect(packs(p.repo.folder)).toBe(before + 1);
  const left = missingObjects(p.repo.folder, p.head);
  expect(applying.filter((oid) => left.includes(oid))).toEqual([]);
  expect(left).toContain(blob('c/.gitattributes'));
});

test('without downloading only paths whose gitattributes the clone has are answered', async () => {
  const p = await pull([
    ['.gitattributes', '*.txt linguist-generated\n'],
    ['a/.gitattributes', '*.txt -linguist-generated\n'],
    ['a/b/f.txt', 'f\n'],
    ['a/g.txt', 'g\n'],
    ['c/h.txt', 'h\n'],
    ['top.txt', 'top\n'],
  ]);
  const paths = bytes(['a/b/f.txt', 'a/g.txt', 'c/h.txt', 'top.txt']);
  const before = packs(p.repo.folder);

  // The clone has none of them: nothing is answered, and nothing downloads.
  const unread = await p.repo.attribute(p.head, 'linguist-generated', paths);
  expect(unread).toEqual([undefined, undefined, undefined, undefined]);
  expect(packs(p.repo.folder)).toBe(before);

  // With the top one, the paths outside a/ are answered.
  expect(await p.repo.downloadFiles(p.head, bytes(['.gitattributes']))).toEqual([]);
  const downloaded = packs(p.repo.folder);
  const some = await p.repo.attribute(p.head, 'linguist-generated', paths);
  expect(some).toEqual([undefined, undefined, 'set', 'set']);
  // Nothing downloaded.
  expect(packs(p.repo.folder)).toBe(downloaded);

  // With both, every path.
  expect(await linguistGenerated(p.repo, p.head, ['a/b/f.txt'])).toEqual(['unset']);
  const all = await p.repo.attribute(p.head, 'linguist-generated', paths);
  expect(all).toEqual(['unset', 'unset', 'set', 'set']);
});

test('past the limit no gitattributes are read', async () => {
  const head: [string, string][] = [['.gitattributes', '*.txt linguist-generated\n']];
  const paths: string[] = [];
  for (let folder = 0; folder < 200; folder++) {
    head.push(
      [`d${folder}/.gitattributes`, '*.txt -linguist-generated\n'],
      [`d${folder}/f.txt`, 'f\n'],
    );
    paths.push(`d${folder}/f.txt`);
  }
  const p = await pull(head);
  const before = packs(p.repo.folder);
  const tooMany = { kind: 'tooManyAttributeFiles', found: paths.length + 1, limit: 200 };

  expect((await failure(p.repo.downloadAttributes(p.head, bytes(paths)))).detail).toEqual(tooMany);
  expect(
    (await failure(p.repo.attribute(p.head, 'linguist-generated', bytes(paths)))).detail,
  ).toEqual(tooMany);

  // Nothing downloaded.
  expect(packs(p.repo.folder)).toBe(before);
  // One fewer is read.
  const fewer = await linguistGenerated(p.repo, p.head, paths.slice(1));
  expect(fewer.every((attribute) => attribute === 'unset')).toBe(true);
});

test('offline the gitattributes read only if the clone has them', async () => {
  const p = await pull([
    ['.gitattributes', '*.txt linguist-generated\n'],
    ['a.txt', 'a\n'],
  ]);
  const blob = blobId(p.work, p.head, '.gitattributes');
  const offline = await p.cache.openOffline('owner', 'repo');
  if (offline === undefined) throw new Error('no clone to read offline');
  const before = packs(offline.folder);
  const path = bytes(['a.txt']);

  // The server is still there, so a read that could download would.
  expect(await offline.attribute(p.head, 'linguist-generated', path)).toEqual([undefined]);
  expect(shown(await offline.downloadAttributes(p.head, path))).toEqual(['.gitattributes']);
  // Nothing downloaded.
  expect(packs(offline.folder)).toBe(before);
  expect(missingObjects(offline.folder, p.head)).toContain(blob);
  // Once downloaded online, they read offline too.
  expect(await linguistGenerated(p.repo, p.head, ['a.txt'])).toEqual(['set']);
  expect(await offline.attribute(p.head, 'linguist-generated', path)).toEqual(['set']);
});

function shown(paths: readonly Buffer[]): string[] {
  return paths.map((path) => path.toString('utf8'));
}
