/**
 * For the workflow's tests: bare repositories standing in for a base repository and its fork, the
 * commits pushed to them, a GitHub that answers from what a test says, and a log that keeps what's
 * said.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { git, gitBytes, gitProgram, testGitEnvironment } from '@lo/testing/git';

import type { Log } from '../src/actions.ts';
import type { GitHub, PullRequest } from '../src/github.ts';
import { Workspace } from '../src/remote.ts';
import { header } from './support.ts';

/** A commit the overview's header can name: the workflow never reads its code. */
export const CODE = 'c0ffee'.padEnd(40, '0');

/** The base repository's id, and its fork's, as GitHub numbers repositories. */
export const BASE_ID = 1;
export const FORK_ID = 2;

/** A folder of repositories for one test file. */
export class Repos {
  readonly dir: string;
  /** A repository to make commits in, which pushes them to the others. */
  readonly maker: string;
  #made = 0;

  constructor(dir: string) {
    this.dir = dir;
    this.maker = join(dir, 'maker');
    mkdirSync(this.maker);
    git(this.maker, 'init', '-q', '--object-format=sha1', '.');
  }

  /** A new, empty bare repository. */
  bare(name: string): string {
    const path = join(this.dir, `${name}-${this.#made++}.git`);
    git(this.dir, 'init', '-q', '--bare', '--object-format=sha1', path);
    return path;
  }

  /** The tree holding `files`, each a path and its contents, folders made as the paths need. */
  tree(files: Readonly<Record<string, string | Uint8Array>>): string {
    const leaves = new Map<string, string | Uint8Array>();
    const folders = new Map<string, Record<string, string | Uint8Array>>();
    for (const [path, contents] of Object.entries(files)) {
      const slash = path.indexOf('/');
      if (slash === -1) leaves.set(path, contents);
      else {
        const folder = path.slice(0, slash);
        const inner = folders.get(folder) ?? {};
        inner[path.slice(slash + 1)] = contents;
        folders.set(folder, inner);
      }
    }
    const lines: string[] = [];
    for (const [name, value] of leaves) {
      const blob = gitBytes(this.maker, ['hash-object', '-w', '--stdin'], value).toString().trim();
      lines.push(`100644 blob ${blob}\t${name}`);
    }
    for (const [name, inner] of folders) lines.push(`040000 tree ${this.tree(inner)}\t${name}`);
    return gitBytes(this.maker, ['mktree'], `${lines.join('\n')}\n`)
      .toString()
      .trim();
  }

  /** A commit of `files`, on `parents`, written by `author` if given. */
  commit(
    files: Readonly<Record<string, string | Uint8Array>>,
    parents: readonly string[] = [],
    author?: { name: string; email: string },
  ): string {
    const tree = this.tree(files);
    const args = [
      'commit-tree',
      tree,
      ...parents.flatMap((parent) => ['-p', parent]),
      '-m',
      'An overview',
    ];
    if (!author) return git(this.maker, ...args);
    return execFileSync(gitProgram(), args, {
      cwd: this.maker,
      env: {
        ...testGitEnvironment(),
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
      },
      encoding: 'utf8',
    }).trim();
  }

  /** Points `ref` in the bare repository `repo` at `id`, whatever it pointed at. */
  push(repo: string, id: string, ref: string): void {
    git(this.maker, 'push', '-q', '-f', repo, `${id}:${ref}`);
  }

  /** What `ref` in `repo` points at, if it's there. */
  ref(repo: string, ref: string): string | undefined {
    const listed = git(repo, 'for-each-ref', '--format=%(objectname) %(refname)', ref);
    const line = listed.split('\n').find((each) => each.endsWith(` ${ref}`));
    return line?.split(' ')[0];
  }

  /** A chain of `count` overview commits on `parent`, made at once: the last one's id. */
  chain(count: number, pr: number, parent?: string): string {
    // A branch of its own, so its first commit starts where it's told to.
    const branch = `refs/heads/chain-${this.#made++}`;
    const lines: string[] = [];
    for (let n = 0; n < count; n++) {
      const text = overviewText(pr, `Step ${n}.`);
      lines.push(
        `commit ${branch}`,
        'committer Lo test <test@lo.invalid> 1700000000 +0000',
        'data 0',
        ...(n === 0 && parent ? [`from ${parent}`] : []),
        'M 100644 inline artifact.md',
        `data ${Buffer.byteLength(text)}`,
        text,
      );
    }
    gitBytes(this.maker, ['fast-import', '--quiet', '--force'], `${lines.join('\n')}\n`);
    return git(this.maker, 'rev-parse', branch);
  }
}

/** An overview of `pr`'s `artifact.md`, with a tl;dr of `tldr` and then `body`. */
export function overviewText(
  pr: number,
  tldr = 'It changes things.',
  body = '',
  more = '',
): string {
  return `${header(CODE, pr).replace('---\n', `---\n${more}`)}\n## tl;dr\n\n${tldr}\n\n${body}`;
}

/** A stack's overview's `artifact.md`. */
export function stackText(stack: number, tldr = 'The layers add a limiter.'): string {
  return `---\nformat: 1\nstack: ${stack}\ncommit: ${CODE}\n---\n\n## tl;dr\n\n${tldr}\n`;
}

/** A pull request from the fork, `them/repo`, into the base, `us/repo`, opened by `writer`. */
export function fromFork(number: number, more: Partial<PullRequest> = {}): PullRequest {
  return {
    number,
    base: { id: BASE_ID, name: 'us/repo' },
    head: { id: FORK_ID, name: 'them/repo' },
    merged: false,
    mergedAt: undefined,
    author: 'writer',
    ...more,
  };
}

/** A GitHub that has `pulls`, and maps the commits in `logins` to those accounts. */
export function fakeGitHub(
  pulls: readonly PullRequest[],
  logins: Readonly<Record<string, string>> = {},
): GitHub & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    pull: async (repo, number) => {
      asked.push(`pull ${repo} ${number}`);
      return pulls.find((each) => each.number === number);
    },
    commitLogin: async (repo, id) => {
      asked.push(`commit ${repo} ${id}`);
      return logins[`${repo} ${id}`];
    },
  };
}

/** A log that keeps each line, `info: …`, `warning: …` or `error: …`. */
export function keptLog(): Log & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (text) => lines.push(`info: ${text}`),
    warning: (text) => lines.push(`warning: ${text}`),
    error: (text) => lines.push(`error: ${text}`),
  };
}

/** A new workspace, with git as the tests run it. */
export function openWorkspace(): Promise<Workspace> {
  return Workspace.open(testGitEnvironment());
}
