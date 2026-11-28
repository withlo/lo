/**
 * Writing a checked overview as a commit for its ref, its pull request's `refs/lo/pr/<n>` or its
 * stack's `refs/lo/stack/<n>`: exactly the bytes that were checked, in a tree of `artifact.md` and
 * `figures/`, with the local ref's commit, if there is one, as its parent. Only objects are
 * written: no ref, index or working tree changes, and pushing is left to whoever runs it.
 */

import { ARTIFACT } from '@lo/artifact';

import { GitError, isId, refTarget, run, type Git } from './git.ts';

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

/** Whose overview it is: a pull request's or a stack's. */
export type Owner = { pr: number; stack?: undefined } | { stack: number; pr?: undefined };

/** The ref the overview of `owner` is pushed to. */
export function refOf(owner: Owner): string {
  return owner.stack === undefined ? `refs/lo/pr/${owner.pr}` : `refs/lo/stack/${owner.stack}`;
}

/** Writes `files` as the overview of `owner`, in the repository `git` runs in. */
export async function writeCommit(
  git: Git,
  owner: Owner,
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
  const parent = await parentOf(git, refOf(owner));
  const author = await ident(git, 'GIT_AUTHOR_IDENT');
  const committer = await ident(git, 'GIT_COMMITTER_IDENT');
  const commit = Buffer.concat([
    Buffer.from(`tree ${tree}\n${parent ? `parent ${parent}\n` : ''}author `),
    author,
    Buffer.from('\ncommitter '),
    committer,
    Buffer.from(
      owner.stack === undefined
        ? `\n\nOverview of pull request #${owner.pr}\n`
        : `\n\nOverview of stack ${owner.stack}\n`,
    ),
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
 * The commit the local `ref` points at, if there is one: that ref exactly, never one git would
 * guess it means.
 */
async function parentOf(git: Git, ref: string): Promise<string | undefined> {
  const target = await refTarget(git, ref);
  if (target === undefined) return undefined;
  if (target.type !== 'commit') {
    throw new GitError(`${ref} isn't a commit, so it can't be the new commit's parent.`);
  }
  return target.id;
}

/** The author's or committer's name, address and time, as the user's git config gives them. */
async function ident(git: Git, name: 'GIT_AUTHOR_IDENT' | 'GIT_COMMITTER_IDENT'): Promise<Buffer> {
  const said = await run(git, ['var', name]);
  const line = said.subarray(0, said.indexOf(0x0a) === -1 ? said.length : said.indexOf(0x0a));
  if (line.length === 0) throw new GitError(`git var ${name} gave nothing.`);
  return line;
}
