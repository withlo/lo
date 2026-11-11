/**
 * Writing a checked overview as a commit for its pull request's ref, `refs/lo/pr/<n>`: exactly the
 * bytes that were checked, in a tree of `artifact.md` and `figures/`, with the local ref's commit,
 * if there is one, as its parent. Only objects are written: no ref, index or working tree changes,
 * and pushing is left to whoever runs it.
 */

import { ARTIFACT } from '@lo/artifact';

import { GitError, isId, run, type Git } from './git.ts';

/** A file the commit holds: its path, `artifact.md` or one in `figures/`, and its bytes. */
export interface CommitFile {
  path: string;
  bytes: Uint8Array;
}

/** The commit written, and its parent, if it has one. */
export interface Written {
  id: string;
  parent: string | undefined;
}

/** The ref a pull request's overview is pushed to. */
export function refOf(pr: number): string {
  return `refs/lo/pr/${pr}`;
}

/** Writes `files` as the overview for pull request `pr`, in the repository `git` runs in. */
export async function writeCommit(
  git: Git,
  pr: number,
  files: readonly CommitFile[],
): Promise<Written> {
  const figures: Buffer[] = [];
  const top: Buffer[] = [];
  for (const { path, bytes } of files) {
    const id = await objectId(git, ['hash-object', '-w', '--stdin', '--no-filters'], bytes);
    if (path === ARTIFACT) {
      top.push(treeEntry('100644 blob', id, ARTIFACT));
    } else if (path.startsWith('figures/') && !path.slice('figures/'.length).includes('/')) {
      figures.push(treeEntry('100644 blob', id, path.slice('figures/'.length)));
    } else {
      throw new GitError(`${JSON.stringify(path)} isn't a path an overview's commit holds.`);
    }
  }
  if (figures.length > 0) {
    const tree = await objectId(git, ['mktree', '-z'], Buffer.concat(figures));
    top.push(treeEntry('040000 tree', tree, 'figures'));
  }
  const tree = await objectId(git, ['mktree', '-z'], Buffer.concat(top));
  const parent = await parentOf(git, pr);
  const author = await ident(git, 'GIT_AUTHOR_IDENT');
  const committer = await ident(git, 'GIT_COMMITTER_IDENT');
  const commit = Buffer.concat([
    Buffer.from(`tree ${tree}\n${parent ? `parent ${parent}\n` : ''}author `),
    author,
    Buffer.from('\ncommitter '),
    committer,
    Buffer.from(`\n\nOverview of pull request #${pr}\n`),
  ]);
  const id = await objectId(git, ['hash-object', '-t', 'commit', '-w', '--stdin'], commit);
  return { id, parent };
}

/** An entry of `git mktree -z`'s input. The name goes on git's input, never its command line. */
function treeEntry(what: string, id: string, name: string): Buffer {
  return Buffer.concat([Buffer.from(`${what} ${id}\t`), Buffer.from(name), Buffer.from([0])]);
}

/** Runs git, which writes an object, and returns its id. */
async function objectId(git: Git, args: readonly string[], input: Uint8Array): Promise<string> {
  const id = (await run(git, args, input)).toString('utf8').trim();
  if (!isId(id)) throw new GitError(`git ${args[0] ?? ''} answered ${JSON.stringify(id)}.`);
  return id;
}

/**
 * The commit the local `refs/lo/pr/<pr>` points at, if there is one: that ref exactly, never one
 * git would guess it means.
 */
async function parentOf(git: Git, pr: number): Promise<string | undefined> {
  const ref = refOf(pr);
  const listed = await run(git, [
    'for-each-ref',
    '--format=%(objectname) %(objecttype) %(refname)',
    ref,
  ]);
  for (const line of listed.toString('utf8').split('\n')) {
    const [id = '', type = '', name] = line.split(' ');
    if (name !== ref) continue;
    if (type !== 'commit' || !isId(id)) {
      throw new GitError(`${ref} isn't a commit, so it can't be the new commit's parent.`);
    }
    return id;
  }
  return undefined;
}

/** The author's or committer's name, address and time, as the user's git config gives them. */
async function ident(git: Git, name: 'GIT_AUTHOR_IDENT' | 'GIT_COMMITTER_IDENT'): Promise<Buffer> {
  const said = await run(git, ['var', name]);
  const line = said.subarray(0, said.indexOf(0x0a) === -1 ? said.length : said.indexOf(0x0a));
  if (line.length === 0) throw new GitError(`git var ${name} gave nothing.`);
  return line;
}
