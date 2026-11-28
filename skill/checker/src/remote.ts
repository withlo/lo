/**
 * The workflow's git: an empty bare repository of its own, in a new folder, that `keep` and `fold`
 * fetch git data into, as data, and push from. Nothing is ever checked out, so no file a fork holds
 * is written anywhere, and nothing a fork sends is run: git reads no config but what's set here, so
 * no hook, helper or other program a config could name runs, and every object fetched is checked as
 * it arrives. Only HTTPS reaches the network (a local folder, in tests), and only the base
 * repository's address is given the token, as a header git sends to it alone.
 *
 * Every ref a remote names is fetched into this repository's own `refs/workflow/`, so what a remote
 * holds lands nowhere else, and `FETCH_HEAD` is never written.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import {
  exec,
  findGit,
  gitEnvironment,
  GitError,
  isId,
  NoGit,
  refTarget,
  run,
  type Git,
} from './git.ts';
import { plain } from './github.ts';

/** A repository to fetch from or push to. */
export interface Remote {
  /** Its address, `https://<server>/<owner>/<repo>.git`, or, in tests, a local folder. */
  url: string;
  /** The `Authorization` header to send it, or undefined to send none. */
  authorization?: string | undefined;
}

/** What pushing a commit to a ref did. */
export type Pushed =
  | { kind: 'pushed' }
  /** The ref moved since it was read, so the push wasn't a fast-forward of what's there now. */
  | { kind: 'moved'; said: string }
  | { kind: 'refused'; said: string };

/** A commit in a walk: its id and its parents'. */
export interface Walked {
  id: string;
  parents: string[];
}

/** The `Authorization` header that signs git in to GitHub with `token`, as `actions/checkout` does. */
export function tokenHeader(token: string): string {
  return `basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
}

/**
 * Config for every git run, by environment, so no file holds it: no hook runs, objects fetched are
 * checked, nothing collects garbage or runs maintenance in the background, a redirect is never
 * followed, and no credential helper is asked.
 */
const CONFIG: readonly (readonly [string, string])[] = [
  ['core.hooksPath', devNull],
  ['core.fsmonitor', 'false'],
  ['transfer.fsckObjects', 'true'],
  ['gc.auto', '0'],
  ['maintenance.auto', 'false'],
  ['http.followRedirects', 'false'],
  ['credential.helper', ''],
  ['protocol.version', '2'],
];

/**
 * The environment for git in the repository at `dir`, from `env` without git's own variables or
 * anything named as a token or a secret, with `config` and only this repository's own config read.
 */
function environment(
  env: NodeJS.ProcessEnv,
  dir: string,
  config: readonly (readonly [string, string])[],
): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || name.startsWith('GIT_') || /TOKEN|SECRET|PASSWORD/i.test(name)) {
      continue;
    }
    kept[name] = value;
  }
  delete kept['SSH_ASKPASS'];
  const settings: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: String(config.length) };
  for (const [index, [key, value]] of config.entries()) {
    settings[`GIT_CONFIG_KEY_${index}`] = key;
    settings[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  return {
    ...kept,
    ...settings,
    GIT_DIR: dir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: '0',
    // Set and empty, so neither it nor SSH's is asked for a password.
    GIT_ASKPASS: '',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
  };
}

/** The protocol git may use to reach `url`: HTTPS, or, for a local folder, files. */
function protocolOf(url: string): string {
  if (url.startsWith('https://')) return 'https';
  if (isAbsolute(url)) return 'file';
  throw new GitError(`${JSON.stringify(url)} is neither an HTTPS address nor a folder.`);
}

/** The workflow's bare repository, and git in it. */
export class Workspace {
  /** The repository, a bare one, which is the folder git runs in. */
  readonly dir: string;
  /** Git in it, with the network closed, for reading objects. */
  readonly git: Git;
  readonly #program: string;
  readonly #env: NodeJS.ProcessEnv;

  private constructor(dir: string, program: string, env: NodeJS.ProcessEnv) {
    this.dir = dir;
    this.#program = program;
    this.#env = env;
    this.git = { program, cwd: dir, env: gitEnvironment(environment(env, dir, CONFIG)) };
  }

  /** A new, empty bare repository in a new folder under `parent`. Throws when there's no git. */
  static async open(env: NodeJS.ProcessEnv = process.env, parent = tmpdir()): Promise<Workspace> {
    const program = findGit(env);
    if (program === undefined) throw new NoGit("Git isn't installed, or isn't on your PATH.");
    const dir = mkdtempSync(join(parent, 'lo-overview-'));
    const workspace = new Workspace(dir, program, env);
    try {
      // No template, so not even git's sample hooks are copied in.
      await run(workspace.git, [
        'init',
        '--bare',
        '--quiet',
        '--template=',
        '--object-format=sha1',
      ]);
    } catch (error) {
      workspace.close();
      throw error;
    }
    return workspace;
  }

  /** Git in this repository, able to reach `remote` and no other. */
  reaching(remote: Remote): Git {
    const config: (readonly [string, string])[] = [...CONFIG];
    // To this address alone, by git's matching of a config's address against a request's.
    if (remote.authorization !== undefined) {
      config.push([`http.${remote.url}.extraHeader`, `Authorization: ${remote.authorization}`]);
    }
    return {
      program: this.#program,
      cwd: this.dir,
      env: {
        ...environment(this.#env, this.dir, config),
        GIT_ALLOW_PROTOCOL: protocolOf(remote.url),
      },
    };
  }

  /**
   * The refs `refs` in `remote` that it has, by their exact names, to the ids of what they point
   * at. Throws with git's words when it can't be asked.
   */
  async list(remote: Remote, refs: readonly string[]): Promise<Map<string, string>> {
    const ran = await exec(this.reaching(remote), ['ls-remote', '--', remote.url, ...refs]);
    if (ran.status !== 0) throw new GitError(failure('ls-remote', ran.err));
    const found = new Map<string, string>();
    for (const line of ran.out.toString('utf8').split('\n')) {
      const [id = '', name = ''] = line.split('\t');
      // A pattern names a ref and the refs ending in it, so only an exact name counts.
      if (!refs.includes(name)) continue;
      if (!isId(id)) throw new GitError(`git ls-remote answered ${JSON.stringify(plain(line))}.`);
      found.set(name, id);
    }
    return found;
  }

  /**
   * Fetches each ref `from` names in `remote` into this repository's `refs/workflow/<to>`, and
   * returns what each now points at. Throws with git's words when the fetch fails, as when a ref
   * isn't there, or an object fetched is damaged.
   */
  async fetch(
    remote: Remote,
    refs: readonly { from: string; to: string }[],
  ): Promise<Map<string, string>> {
    const specs = refs.map(({ from, to }) => `+${from}:${local(to)}`);
    const ran = await exec(this.reaching(remote), [
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-write-fetch-head',
      '--no-recurse-submodules',
      '--no-auto-gc',
      '--no-auto-maintenance',
      '--',
      remote.url,
      ...specs,
    ]);
    if (ran.status !== 0) throw new GitError(failure('fetch', ran.err));
    const ids = new Map<string, string>();
    for (const { from, to } of refs) {
      const target = await this.ref(to);
      if (target === undefined) throw new GitError(`git fetch didn't fetch ${from}.`);
      ids.set(from, target);
    }
    return ids;
  }

  /** The commit this repository's `refs/workflow/<name>` points at, if it has that ref. */
  async ref(name: string): Promise<string | undefined> {
    const target = await refTarget(this.git, local(name));
    if (target === undefined) return undefined;
    if (target.type !== 'commit') throw new GitError(`${local(name)} isn't a commit.`);
    return target.id;
  }

  /**
   * Pushes the commit `id` to `ref` in `remote`, never forced, so the push takes only when it's a
   * fast-forward of what `ref` holds, or `ref` isn't there. Throws with git's words when git can't
   * push at all, such as when it can't sign in.
   */
  async push(remote: Remote, id: string, ref: string): Promise<Pushed> {
    if (!isId(id)) throw new GitError(`${JSON.stringify(id)} isn't a commit.`);
    const ran = await exec(this.reaching(remote), [
      'push',
      '--porcelain',
      '--no-verify',
      '--',
      remote.url,
      `${id}:${ref}`,
    ]);
    // Each ref's line: a flag, a tab, `from:to`, a tab, and a summary, with a reason after a
    // rejection.
    const line = ran.out
      .toString('utf8')
      .split('\n')
      .find((each) => each.split('\t')[1] === `${id}:${ref}`);
    const [flag = '', , summary = ''] = line?.split('\t') ?? [];
    if (ran.status === 0 && line !== undefined && flag !== '!') return { kind: 'pushed' };
    if (flag === '!') {
      const said = plain(summary);
      return /non-fast-forward|fetch first|stale info|failed to update ref|cannot lock ref|incorrect old value|already exists/.test(
        summary,
      )
        ? { kind: 'moved', said }
        : { kind: 'refused', said };
    }
    throw new GitError(failure('push', ran.err));
  }

  /**
   * The commits reachable from `tip` and not from `stop`, newest first, each with its parents: at
   * most `most`, or undefined when there are more.
   */
  async walk(tip: string, stop: string | undefined, most: number): Promise<Walked[] | undefined> {
    const input = `${tip}\n${stop === undefined ? '' : `^${stop}\n`}`;
    const listed = await run(
      this.git,
      ['rev-list', '--parents', `--max-count=${most + 1}`, '--stdin'],
      Buffer.from(input),
    );
    const walked: Walked[] = [];
    for (const line of listed.toString('utf8').split('\n')) {
      if (line === '') continue;
      const [id = '', ...parents] = line.split(' ');
      if (!isId(id) || !parents.every(isId)) {
        throw new GitError(`git rev-list answered ${JSON.stringify(plain(line))}.`);
      }
      walked.push({ id, parents });
    }
    return walked.length > most ? undefined : walked;
  }

  /** Whether `ancestor` is `descendant`, or one of the commits it descends from. */
  async descends(descendant: string, ancestor: string): Promise<boolean> {
    // The commits reachable from the ancestor and not from the descendant: none, when it is one.
    const count = await run(
      this.git,
      ['rev-list', '--count', '--stdin'],
      Buffer.from(`${ancestor}\n^${descendant}\n`),
    );
    return count.toString('utf8').trim() === '0';
  }

  /** Removes the repository and its folder. */
  close(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** This repository's own ref for `name`, in `refs/workflow/`. */
function local(name: string): string {
  if (!/^[a-z]+(?:\/[a-z0-9]+)*$/.test(name)) throw new GitError(`${name} isn't a name for a ref.`);
  return `refs/workflow/${name}`;
}

/** What git said when `command` failed, on one line, or that it said nothing. */
function failure(command: string, err: string): string {
  return err === '' ? `git ${command} failed without saying why.` : plain(err);
}
