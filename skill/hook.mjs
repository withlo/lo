// @ts-check
/**
 * Lo's overview hook, which Claude Code and Codex run after a tool call (`PostToolUse`), from a
 * repository that installed the overview skill. When the agent has just opened a pull request, or
 * pushed commits to an open one, it asks the agent to start the lo-overview skill for it, in a few
 * lines added to the agent's context (`additionalContext`). It runs with Node alone, and needs only
 * `gh`, signed in, to find a pushed branch's pull request.
 *
 * It answers nothing, and starts nothing, when:
 *
 * - the call opened no pull request and pushed no branch: a push of `refs/lo/*` alone is the
 *   overview's own, which would otherwise start another for ever;
 * - the push changed nothing, failed, was a dry run or only deleted;
 * - `overview.auto` is `false` in the repository's `.lo/settings.json` or in the person's Lo
 *   settings file (`~/.config/lo/settings.json`, or `$XDG_CONFIG_HOME/lo` on Linux);
 * - the pull request can't be found, or isn't open.
 *
 * One writer per pull request: the hook takes a lock for it in a folder of the person's own in the
 * repository's git folder, which `start` and `done` in `@withlo/overview` take and give back. When a
 * writer holds it, the hook records one follow-up, which `done` hands the writer, so it runs once
 * more.
 *
 * What it reads is the agent's command and what the command printed, so it's never run, and only
 * a pull request's link that reads back the same goes into what it answers. Whatever goes wrong,
 * it exits 0, saying nothing: a hook that failed would only get in the agent's way.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A pull request on GitHub, as its link names it.
 *
 * @typedef {{ owner: string, repo: string, number: number, url: string }} Pull
 */

/**
 * What a tool call did that an overview is written after, in the folder `dir`: opened a pull
 * request, for the branch `--head` names, if it names one; or pushed branches (`CURRENT` for the
 * branch checked out) to the remote it names, if it names one.
 *
 * @typedef {{ kind: 'create', dir: string, head: string | undefined }
 *   | { kind: 'push', dir: string, remote: string | undefined, branches: readonly (string | typeof CURRENT)[] }} Action
 */

/**
 * A branch whose open pull request is looked for: by its name, or `CURRENT`; on the remote that
 * was pushed to, or in the fork of the owner `gh pr create --head <owner>:<branch>` names.
 *
 * @typedef {{ branch: string | typeof CURRENT, remote?: string, owner?: string }} Target
 */

/** The branch checked out where a push ran, which `git push` with no refspec pushes. */
export const CURRENT = Symbol('current branch');

/** The most of the hook's input it reads: a tool's output is far less. */
const INPUT_LIMIT = 32 * 1024 * 1024;

/** The most of a settings file it reads, as Lo does. */
const SETTINGS_LIMIT = 1024 * 1024;

/** How long `gh` may take to find a pull request. */
const GH_TIMEOUT_MS = 15_000;

/** How long a lock holds once taken or kept, after which a writer that never gave it back is gone. */
export const LOCK_MS = 30 * 60 * 1000;

/** The most pull requests one call starts writers for. */
const MOST = 3;

// --- The command ----------------------------------------------------------------------------------

/** Where a subshell, `( … )`, starts and ends among the commands `piecesIn` finds. */
const OPEN = Symbol('subshell starts');
const CLOSE = Symbol('subshell ends');

/**
 * The simple commands in the shell command `text`, each its words with their quotes taken out, in
 * the order they run. Words are split as a shell splits them, on spaces outside quotes, and commands
 * on `;`, `&&`, `||`, `|`, `&`, newlines and parentheses. Redirections are dropped, and a
 * here-document's lines with them. Nothing is expanded: `$(…)` and backquotes stay in their word as
 * written.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function commandsIn(text) {
  return piecesIn(text).filter((piece) => Array.isArray(piece));
}

/**
 * The simple commands in the shell command `text`, as `commandsIn` finds them, with `OPEN` and
 * `CLOSE` where a subshell starts and ends.
 *
 * @param {string} text
 * @returns {(string[] | typeof OPEN | typeof CLOSE)[]}
 */
function piecesIn(text) {
  /** @type {(string[] | typeof OPEN | typeof CLOSE)[]} */
  const pieces = [];
  /** @type {string[]} */
  let words = [];
  /** @type {string | undefined} */
  let word;
  let redirect = false;
  /** Whether the word being read is a here-document's delimiter, and with `<<-`. */
  /** @type {{ dash: boolean } | undefined} */
  let delimiter;
  /** The here-documents whose lines start after this line. */
  /** @type {{ end: string, dash: boolean }[]} */
  let heredocs = [];
  const endWord = () => {
    if (word === undefined) return;
    if (delimiter) heredocs.push({ end: word, dash: delimiter.dash });
    delimiter = undefined;
    if (redirect) redirect = false;
    else words.push(word);
    word = undefined;
  };
  const endCommand = () => {
    endWord();
    redirect = false;
    if (words.length > 0) pieces.push(words);
    words = [];
  };
  let at = 0;
  while (at < text.length) {
    const c = text[at];
    if (c === "'") {
      const close = text.indexOf("'", at + 1);
      const end = close === -1 ? text.length : close;
      word = (word ?? '') + text.slice(at + 1, end);
      at = end + 1;
    } else if (c === '"') {
      let s = '';
      let j = at + 1;
      while (j < text.length && text[j] !== '"') {
        const next = text[j + 1];
        if (text[j] === '\\' && next !== undefined && '\\"$`\n'.includes(next)) {
          if (next !== '\n') s += next;
          j += 2;
        } else if (text[j] === '$' && next === '(') {
          const end = closing(text, j + 1);
          s += text.slice(j, end);
          j = end;
        } else {
          s += text[j];
          j += 1;
        }
      }
      word = (word ?? '') + s;
      at = j + 1;
    } else if (c === '\\') {
      if (text[at + 1] !== '\n') word = (word ?? '') + (text[at + 1] ?? '');
      at += 2;
    } else if (c === '$' && text[at + 1] === '(') {
      const end = closing(text, at + 1);
      word = (word ?? '') + text.slice(at, end);
      at = end;
    } else if (c === '`') {
      const close = text.indexOf('`', at + 1);
      const end = close === -1 ? text.length : close + 1;
      word = (word ?? '') + text.slice(at, end);
      at = end;
    } else if (c === ' ' || c === '\t') {
      endWord();
      at += 1;
    } else if (c === '#' && word === undefined) {
      const line = text.indexOf('\n', at);
      at = line === -1 ? text.length : line;
    } else if (c === '<' || c === '>') {
      // A file descriptor's number before the operator goes with it: `2>&1`.
      if (word !== undefined && /^\d+$/.test(word)) word = undefined;
      endWord();
      // `<<` and `<<-` start a here-document, whose delimiter is the word after; `<<<` doesn't.
      if (text.startsWith('<<', at) && text[at + 2] !== '<') {
        delimiter = { dash: text[at + 2] === '-' };
        at += delimiter.dash ? 3 : 2;
      } else {
        at += 1;
        while (text[at] === '>' || text[at] === '<' || text[at] === '&' || text[at] === '|') {
          at += 1;
        }
      }
      redirect = true;
    } else if (c === '\n') {
      endCommand();
      at += 1;
      // A here-document's lines are its text, never commands: past each, up to its delimiter.
      for (const { end, dash } of heredocs) {
        for (;;) {
          if (at >= text.length) break;
          const close = text.indexOf('\n', at);
          const line = text.slice(at, close === -1 ? text.length : close);
          at = close === -1 ? text.length : close + 1;
          if ((dash ? line.replace(/^\t+/, '') : line) === end) break;
        }
      }
      heredocs = [];
    } else if (c === '(' || c === ')') {
      endCommand();
      pieces.push(c === '(' ? OPEN : CLOSE);
      at += 1;
    } else if (c === ';' || c === '&' || c === '|') {
      endCommand();
      at += 1;
    } else {
      word = (word ?? '') + c;
      at += 1;
    }
  }
  endCommand();
  return pieces;
}

/**
 * Where the parenthesis at `open` in `text` is closed, past it, counting those it holds: the end of
 * `text` when it never is.
 *
 * @param {string} text
 * @param {number} open
 */
function closing(text, open) {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === '(') depth += 1;
    else if (text[at] === ')') {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  return text.length;
}

/** Programs that run the command after them, and the words they take before it. */
const WRAPPERS = new Set(['command', 'env', 'exec', 'nohup', 'time']);

/**
 * What the shell command `text`, run in the folder `cwd`, does that an overview is written after:
 * each pull request it opens with `gh pr create`, and each push of branches with `git push`. A
 * `cd` moves where the commands after it run, up to the end of the subshell it's in, and `git -C`
 * where its own does. One that runs where the hook can't tell, such as after `cd "$dir"`, is left
 * out.
 *
 * @param {string} text
 * @param {string} cwd
 * @returns {Action[]}
 */
export function actionsIn(text, cwd) {
  /** @type {Action[]} */
  const actions = [];
  /** @type {string | undefined} */
  let dir = cwd;
  /** Where each subshell started, the innermost last. */
  /** @type {(string | undefined)[]} */
  const outer = [];
  for (const words of piecesIn(text)) {
    if (words === OPEN) {
      outer.push(dir);
      continue;
    }
    if (words === CLOSE) {
      if (outer.length > 0) dir = outer.pop();
      continue;
    }
    let at = 0;
    while (at < words.length) {
      const word = words[at] ?? '';
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) at += 1;
      else if (WRAPPERS.has(word)) at += 1;
      else if (word.startsWith('-') && at > 0 && WRAPPERS.has(words[at - 1] ?? '')) at += 1;
      else break;
    }
    const [program, ...args] = words.slice(at);
    if (program === undefined) continue;
    const name = basename(program);
    if (name === 'cd') {
      dir = moved(
        dir,
        args.find((arg) => arg === '-' || !arg.startsWith('-')),
      );
    } else if (name === 'git' || name === 'git.exe') {
      const push = pushIn(args, dir);
      if (push) actions.push(push);
    } else if (name === 'gh' || name === 'gh.exe') {
      const create = createIn(args);
      if (create && dir !== undefined) actions.push({ kind: 'create', dir, head: create.head });
    }
  }
  return actions;
}

/**
 * Where `cd <to>` from `dir` goes, `~` expanded: `undefined` where the hook can't tell, as for a
 * folder named by a variable, a pattern, `-`, or a relative path from a folder it couldn't tell.
 *
 * @param {string | undefined} dir
 * @param {string | undefined} to
 * @returns {string | undefined}
 */
function moved(dir, to) {
  if (to === undefined || to === '~') return homedir();
  if (to === '-' || /[$`*?[\]{}]/.test(to)) return undefined;
  if (to.startsWith('~/')) return join(homedir(), to.slice(2));
  if (to.startsWith('~')) return undefined;
  if (isAbsolute(to)) return resolve(to);
  return dir === undefined ? undefined : resolve(dir, to);
}

/** git's options before its command that take the word after them. */
const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);

/** `git push`'s options that take the word after them. */
const PUSH_VALUED = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);

/**
 * The push `git <args>`, run in `dir`, makes of branches, if it's one that pushes any, and runs
 * where the hook can tell.
 *
 * @param {readonly string[]} args
 * @param {string | undefined} dir
 * @returns {Action | undefined}
 */
function pushIn(args, dir) {
  let here = dir;
  let at = 0;
  while (at < args.length) {
    const arg = args[at] ?? '';
    if (arg === '-C') {
      const to = args[at + 1] ?? '';
      if (to !== '') here = moved(here, to);
      at += 2;
    } else if (arg.startsWith('-C') && arg.length > 2) {
      here = moved(here, arg.slice(2));
      at += 1;
    } else if (/^--(?:git-dir|work-tree)(?:=|$)/.test(arg)) {
      // Another repository than the folder's, which the hook doesn't look for.
      return undefined;
    } else if (GIT_VALUED.has(arg)) at += 2;
    else if (arg.startsWith('-')) at += 1;
    else break;
  }
  if (args[at] !== 'push' || here === undefined) return undefined;
  /** @type {string[]} */
  const positional = [];
  let all = false;
  let tags = false;
  for (let i = at + 1; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg === '--dry-run' || arg === '--delete') return undefined;
    if (arg === '--all' || arg === '--branches' || arg === '--mirror') all = true;
    else if (arg === '--tags') tags = true;
    else if (PUSH_VALUED.has(arg)) i += 1;
    else if (/^-[A-Za-z]+$/.test(arg)) {
      // Short options together, `-uf`; `o` takes the rest, or the word after.
      const letters = arg.slice(1);
      const valued = letters.indexOf('o');
      const own = valued === -1 ? letters : letters.slice(0, valued);
      if (own.includes('n') || own.includes('d')) return undefined;
      if (valued === letters.length - 1) i += 1;
    } else if (!arg.startsWith('-')) positional.push(arg);
  }
  const [remote, ...specs] = positional;
  if (specs.length === 0) {
    // `--tags` alone pushes tags, and no branch.
    return tags && !all ? undefined : { kind: 'push', dir: here, remote, branches: [CURRENT] };
  }
  /** @type {(string | typeof CURRENT)[]} */
  const branches = [];
  for (const spec of specs) {
    const branch = branchOf(spec);
    if (branch !== undefined && !branches.includes(branch)) branches.push(branch);
  }
  if (all && !branches.includes(CURRENT)) branches.push(CURRENT);
  return branches.length === 0 ? undefined : { kind: 'push', dir: here, remote, branches };
}

/**
 * The branch the refspec `spec` pushes to, by its name, `CURRENT` for the one checked out, or
 * `undefined` for one that pushes no branch: a ref of the overview's own (`refs/lo/*`), a tag or
 * another ref, a deletion, or a negative refspec.
 *
 * @param {string} spec
 * @returns {string | typeof CURRENT | undefined}
 */
export function branchOf(spec) {
  const plain = spec.startsWith('+') ? spec.slice(1) : spec;
  if (plain === '' || plain.startsWith('^')) return undefined;
  const colon = plain.indexOf(':');
  // `:dst` deletes dst; `:` alone pushes the branches both sides have.
  if (colon === 0) return plain === ':' ? CURRENT : undefined;
  const source = colon === -1 ? plain : plain.slice(0, colon);
  const target = colon === -1 ? plain : plain.slice(colon + 1);
  if (target === 'HEAD' || target === '@') return CURRENT;
  if (colon === -1 && (source === 'HEAD' || source === '@')) return CURRENT;
  if (target.startsWith('refs/heads/')) return target.slice('refs/heads/'.length);
  if (target.startsWith('refs/')) return undefined;
  return target;
}

/**
 * Whether `gh <args>` opens a pull request, `gh pr create`, or its other name, `gh pr new`, but not
 * a dry run or one that finishes in the browser; and the branch its `--head` names, if any.
 *
 * @param {readonly string[]} args
 * @returns {{ head: string | undefined } | undefined}
 */
function createIn(args) {
  if (args[0] !== 'pr' || (args[1] !== 'create' && args[1] !== 'new')) return undefined;
  /** @type {string | undefined} */
  let head;
  for (let at = 2; at < args.length; at++) {
    const arg = args[at] ?? '';
    if (arg === '--dry-run' || arg === '--web' || arg === '-w') return undefined;
    if (arg === '--head' || arg === '-H') head = args[++at];
    else if (arg.startsWith('--head=')) head = arg.slice('--head='.length);
    else if (arg.startsWith('-H') && arg.length > 2) head = arg.slice(2);
  }
  return { head };
}

// --- What the call printed ------------------------------------------------------------------------

/**
 * `value[key]`, when `value` is an object, else `undefined`.
 *
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function field(value, key) {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined;
}

/** A pull request's link on GitHub, as GitHub's names allow. */
const PULL_LINK =
  /https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/pull\/([1-9][0-9]{0,9})(?![0-9A-Za-z_/-])/g;

/**
 * The pull request `link` names, when it's a pull request's link on GitHub and nothing else.
 *
 * @param {unknown} link
 * @returns {Pull | undefined}
 */
export function pullOf(link) {
  if (typeof link !== 'string') return undefined;
  const found = [...link.matchAll(PULL_LINK)];
  if (found.length !== 1 || found[0]?.[0] !== link) return undefined;
  return pullFrom(found[0]);
}

/**
 * The pull request a match of `PULL_LINK` names.
 *
 * @param {RegExpMatchArray} match
 * @returns {Pull | undefined}
 */
function pullFrom(match) {
  const [url, owner, repo, number] = match;
  if (owner === undefined || repo === undefined || number === undefined) return undefined;
  if (repo === '.' || repo === '..' || owner.endsWith('-')) return undefined;
  return { owner, repo, number: Number(number), url: url ?? '' };
}

/**
 * The last pull request's link in `text`, as `gh pr create` prints the one it opened last.
 *
 * @param {string} text
 * @returns {Pull | undefined}
 */
export function lastPullIn(text) {
  const found = [...text.matchAll(PULL_LINK)];
  for (let at = found.length - 1; at >= 0; at--) {
    const match = found[at];
    const pull = match && pullFrom(match);
    if (pull) return pull;
  }
  return undefined;
}

/**
 * What a call printed, as text: Codex gives a shell's output as a string, Claude Code as
 * `{stdout, stderr}`, and an MCP tool its own shape.
 *
 * @param {unknown} response
 * @returns {string}
 */
export function textOf(response) {
  if (typeof response === 'string') return response;
  if (response === null || typeof response !== 'object') return '';
  const stdout = field(response, 'stdout');
  const stderr = field(response, 'stderr');
  if (typeof stdout === 'string' || typeof stderr === 'string') {
    return [stdout, stderr].filter((part) => typeof part === 'string').join('\n');
  }
  try {
    return JSON.stringify(response) ?? '';
  } catch {
    return '';
  }
}

/**
 * Whether what a shell command printed, `text`, says it failed, changed nothing, or was refused, as
 * Codex reports a failed command to the hook too: Claude Code doesn't, so it's only ever a success
 * there.
 *
 * @param {string} text
 */
export function failedOrIdle(text) {
  const exit = /^(?:Exit code:?|Process exited with code) (\d+)\b|"exit_code":\s*(\d+)/m.exec(text);
  if (exit && (exit[1] ?? exit[2]) !== '0') return true;
  // What Codex says of a command before its output.
  const output = text.replace(
    /^(?:(?:Exit code|Wall time|Process exited|Chunk ID)\b.*\n)*(?:Output:\n)?/,
    '',
  );
  if (/^\s*Everything up-to-date\s*$/.test(output)) return true;
  return /^ ! \[(?:rejected|remote rejected)\]|^error: failed to push|^fatal: /m.test(text);
}

// --- Switches -------------------------------------------------------------------------------------

/**
 * `text`, a JSON file with comments and commas after last entries, as Lo's settings file may be,
 * read as JSON: `undefined` when it isn't.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function readJsonc(text) {
  let out = '';
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (at < text.length) {
    const c = text[at];
    if (c === '"') {
      let j = at + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(at, j + 1);
      at = j + 1;
    } else if (c === '/' && text[at + 1] === '/') {
      const line = text.indexOf('\n', at);
      at = line === -1 ? text.length : line;
    } else if (c === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2);
      if (end === -1) return undefined;
      out += ' ';
      at = end + 2;
    } else if (c === ',') {
      // A comma before a closing bracket, past spaces and comments, goes.
      let j = at + 1;
      for (;;) {
        while (j < text.length && /\s/.test(text[j] ?? '')) j += 1;
        if (text[j] === '/' && text[j + 1] === '/') {
          const line = text.indexOf('\n', j);
          j = line === -1 ? text.length : line;
        } else if (text[j] === '/' && text[j + 1] === '*') {
          const end = text.indexOf('*/', j + 2);
          j = end === -1 ? text.length : end + 2;
        } else break;
      }
      if (text[j] !== '}' && text[j] !== ']') out += c;
      at += 1;
    } else {
      out += c;
      at += 1;
    }
  }
  try {
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

/**
 * The start of the file at `path`, up to `limit` bytes, as text, or `undefined` when it's not a
 * file there or is larger. It opens without waiting, so a pipe there is no wait.
 *
 * @param {string} path
 * @param {number} limit
 */
function readSmall(path, limit) {
  let file;
  try {
    file = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return undefined;
  }
  try {
    const stats = fstatSync(file);
    if (!stats.isFile() || stats.size > limit) return undefined;
    const bytes = Buffer.alloc(stats.size);
    let read = 0;
    while (read < bytes.length) {
      const got = readSync(file, bytes, read, bytes.length - read, read);
      if (got === 0) break;
      read += got;
    }
    return bytes.subarray(0, read).toString('utf8');
  } catch {
    return undefined;
  } finally {
    closeSync(file);
  }
}

/**
 * Whether the settings file at `path` turns automatic runs off: its `overview.auto` is `false`. A
 * file that isn't there, can't be read or isn't JSON says nothing, as for Lo, and neither does a
 * value that isn't `true` or `false`.
 *
 * @param {string} path
 */
export function turnsOff(path) {
  const text = readSmall(path, SETTINGS_LIMIT);
  if (text === undefined) return false;
  const value = readJsonc(text);
  if (Array.isArray(value)) return false;
  return field(value, 'overview.auto') === false;
}

/**
 * The person's Lo settings file: in `~/.config/lo` on a Mac, and on Linux in `$XDG_CONFIG_HOME/lo`
 * when that's an absolute path, as Lo keeps it.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function personalSettings(env) {
  const xdg = env.XDG_CONFIG_HOME;
  const config =
    platform() !== 'darwin' && xdg !== undefined && isAbsolute(xdg)
      ? xdg
      : join(homeOf(env), '.config');
  return join(config, 'lo', 'settings.json');
}

/**
 * The home folder `env` names.
 *
 * @param {NodeJS.ProcessEnv} env
 */
function homeOf(env) {
  const home = env.HOME;
  return home !== undefined && isAbsolute(home) ? home : homedir();
}

/**
 * The top of the repository `dir` is in: the nearest folder up from it holding `.git`.
 *
 * @param {string} dir
 * @returns {string | undefined}
 */
export function topOf(dir) {
  for (let at = dir; ; at = dirname(at)) {
    try {
      lstatSync(join(at, '.git'));
      return at;
    } catch {
      // Not here: higher.
    }
    if (dirname(at) === at) return undefined;
  }
}

/**
 * Why automatic runs are off for the repository at `top`, by which file says so, or `undefined`
 * when they're on: either file's `false` turns them off.
 *
 * @param {string | undefined} top
 * @param {NodeJS.ProcessEnv} env
 * @returns {'repository' | 'person' | undefined}
 */
export function offBy(top, env) {
  if (top !== undefined && turnsOff(join(top, '.lo', 'settings.json'))) return 'repository';
  if (turnsOff(personalSettings(env))) return 'person';
  return undefined;
}

// --- One writer per pull request ------------------------------------------------------------------

/**
 * The folder the locks for the repository at `dir` are kept in: `lo-overview` in its git folder,
 * the one its worktrees share, made for the person alone; or `undefined` when there's no repository,
 * or the folder can't be made, is a link, or is someone else's or open to others. It's there, not in
 * a temporary folder, since Claude Code gives a command in its sandbox a temporary folder of its
 * own, which the hook, run outside it, doesn't see, and lets it write in little else but the
 * repository it works in.
 *
 * @param {string | undefined} dir
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
export function lockFolder(dir, env = process.env) {
  if (dir === undefined) return undefined;
  const common = gitLine(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'], env);
  if (common === undefined || !isAbsolute(common)) return undefined;
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const folder = join(common, 'lo-overview');
  try {
    mkdirSync(folder, { mode: 0o700 });
  } catch (error) {
    if (!isCode(error, 'EEXIST')) return undefined;
  }
  try {
    const stats = lstatSync(folder);
    if (!stats.isDirectory()) return undefined;
    if (uid !== undefined && (stats.uid !== uid || (stats.mode & 0o077) !== 0)) return undefined;
    return folder;
  } catch {
    return undefined;
  }
}

/**
 * Whether `error` is the file system's, with `code`.
 *
 * @param {unknown} error
 * @param {string} code
 */
function isCode(error, code) {
  return error instanceof Error && 'code' in error && error.code === code;
}

/**
 * The lock's and the follow-up's files for `pull` in `folder`.
 *
 * @param {string} folder
 * @param {Pull} pull
 */
function lockFiles(folder, pull) {
  const name = `${pull.owner}.${pull.repo}.${pull.number}`.toLowerCase();
  return { lock: join(folder, `${name}.lock`), again: join(folder, `${name}.again`) };
}

/** Flags that make a file new, never through a link. */
const CREATE =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);

/**
 * Makes the file `path`, new, holding `text` from the start: written beside it, then linked where
 * it goes, so that no one reads it half written. `false` when something's there already.
 *
 * @param {string} path
 * @param {string} text
 */
function makeNew(path, text) {
  const beside = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  const file = openSync(beside, CREATE, 0o600);
  try {
    try {
      writeSync(file, text);
    } finally {
      closeSync(file);
    }
    linkSync(beside, path);
    return true;
  } catch (error) {
    if (isCode(error, 'EEXIST')) return false;
    throw error;
  } finally {
    removeIfThere(beside);
  }
}

/**
 * The tool call that took the lock at `path`, as it says, if it does.
 *
 * @param {string} path
 * @returns {unknown}
 */
function takenBy(path) {
  try {
    return field(JSON.parse(readSmall(path, 4096) ?? ''), 'call');
  } catch {
    return undefined;
  }
}

/**
 * Whether the lock at `path` is held: there, and taken or kept within `LOCK_MS` of `now`.
 *
 * @param {string} path
 * @param {number} now
 */
function held(path, now) {
  try {
    const stats = lstatSync(path);
    return stats.isFile() && now - stats.mtimeMs < LOCK_MS;
  } catch {
    return false;
  }
}

/**
 * Takes the lock on writing `pull`'s overview for the tool call `call`, in the repository at `dir`:
 * `taken` when it was free, or held by a writer gone past `LOCK_MS`; `same` when the same call took
 * it, as a command that both pushes and opens a pull request runs the hook twice; `held` when a
 * writer has it, after recording one follow-up for it; `unlocked` when there's nowhere to keep
 * locks, so nothing stops another. `meanwhile` runs once a follow-up is recorded, as a writer's
 * `done` might, for tests.
 *
 * @param {Pull} pull
 * @param {{ dir?: string, env?: NodeJS.ProcessEnv, now?: number, call?: string, meanwhile?: () => void }} [options]
 * @returns {'taken' | 'same' | 'held' | 'unlocked'}
 */
export function takeLock(pull, { dir, env = process.env, now = Date.now(), call, meanwhile } = {}) {
  const folder = lockFolder(dir, env);
  if (folder === undefined) return 'unlocked';
  const { lock, again } = lockFiles(folder, pull);
  try {
    // A few tries, as a writer may give the lock back, or a hook take it, as this looks.
    for (let tries = 0; tries < 3; tries++) {
      if (held(lock, now)) {
        if (call !== undefined && takenBy(lock) === call) return 'same';
        makeNew(again, `${pull.url}\n`);
        meanwhile?.();
        // Still held once the follow-up is there: the writer's `done` will find it.
        if (held(lock, now)) return 'held';
        // Given back meanwhile, by a writer that may never have seen it: take the lock instead.
        removeIfThere(again);
        continue;
      }
      clearStale(lock, again, now);
      if (makeNew(lock, `${JSON.stringify({ pr: pull.url, call: call ?? null })}\n`)) {
        // A follow-up left from before is for a writer that's gone: the new one reads it all.
        removeIfThere(again);
        return 'taken';
      }
    }
    return held(lock, now) ? 'held' : 'unlocked';
  } catch {
    return 'unlocked';
  }
}

/**
 * Removes the lock at `lock`, and its follow-up at `again`, when a writer gone past `LOCK_MS` left
 * it. It's moved aside first, then looked at, so that a lock another hook took just now is never
 * the one removed.
 *
 * @param {string} lock
 * @param {string} again
 * @param {number} now
 */
export function clearStale(lock, again, now) {
  if (lstatSync(lock, { throwIfNoEntry: false }) === undefined) return;
  const aside = `${lock}.${randomBytes(8).toString('hex')}.stale`;
  try {
    renameSync(lock, aside);
  } catch (error) {
    if (isCode(error, 'ENOENT')) return;
    throw error;
  }
  if (held(aside, now)) {
    // Taken again as this looked: back where it was, unless another's been taken since.
    try {
      linkSync(aside, lock);
    } catch {
      // Another lock is there: it stands.
    }
    removeIfThere(aside);
    return;
  }
  removeIfThere(aside);
  removeIfThere(again);
}

/**
 * Keeps the lock on writing `pull`'s overview in the repository at `dir`, as a writer does as it
 * starts: taken when it's free, and its time set again when it's held, so it holds for `LOCK_MS`
 * from `now`. `failed` when there's no folder for it, or it couldn't be written there.
 *
 * @param {Pull} pull
 * @param {{ dir?: string, env?: NodeJS.ProcessEnv, now?: number }} [options]
 * @returns {'kept' | 'failed'}
 */
export function keepLock(pull, { dir, env = process.env, now = Date.now() } = {}) {
  const folder = lockFolder(dir, env);
  if (folder === undefined) return 'failed';
  return keepIn(folder, pull, now) ? 'kept' : 'failed';
}

/**
 * Keeps the lock on writing `pull`'s overview in `folder`, from `now`: whether it could.
 *
 * @param {string} folder
 * @param {Pull} pull
 * @param {number} now
 */
function keepIn(folder, pull, now) {
  const { lock } = lockFiles(folder, pull);
  try {
    if (!makeNew(lock, `${JSON.stringify({ pr: pull.url, call: null })}\n`)) {
      if (!lstatSync(lock).isFile()) return false;
      utimesSync(lock, now / 1000, now / 1000);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Gives back the lock on writing `pull`'s overview in the repository at `dir`, as a writer does
 * once it's done: `again`, with the lock kept, when a follow-up was recorded meanwhile, which it
 * then takes; `done` otherwise; `failed` when there's no folder for it, or it couldn't be read or
 * written there, so a follow-up may be left that no one takes. `meanwhile` runs once the lock's
 * gone, as a hook might, for tests.
 *
 * @param {Pull} pull
 * @param {{ dir?: string, env?: NodeJS.ProcessEnv, now?: number, meanwhile?: () => void }} [options]
 * @returns {'again' | 'done' | 'failed'}
 */
export function giveBack(pull, { dir, env = process.env, now = Date.now(), meanwhile } = {}) {
  const folder = lockFolder(dir, env);
  if (folder === undefined) return 'failed';
  const { lock, again } = lockFiles(folder, pull);
  /** Takes the follow-up, if there's one; throws when it can't tell, or can't take it. */
  const followUp = () => {
    const stats = lstatSync(again, { throwIfNoEntry: false });
    if (stats === undefined) return false;
    unlinkSync(again);
    return true;
  };
  try {
    if (followUp()) {
      keepIn(folder, pull, now);
      return 'again';
    }
    removeIfThere(lock);
    meanwhile?.();
    // A push the hook took in between the look and the lock's removal, which it left for this
    // writer: this writer's, unless a hook has taken the lock since, for a writer of its own.
    if (followUp() && makeNew(lock, `${JSON.stringify({ pr: pull.url, call: null })}\n`)) {
      return 'again';
    }
    return 'done';
  } catch {
    return 'failed';
  }
}

/**
 * Removes the file at `path`, if one's there.
 *
 * @param {string} path
 */
function removeIfThere(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isCode(error, 'ENOENT')) throw error;
  }
}

// --- Finding the pull request ---------------------------------------------------------------------

/**
 * A branch's name as git allows it and `gh` takes it: no option, space, `..` or other trick.
 *
 * @param {string} name
 */
function isBranchName(name) {
  return (
    /^[A-Za-z0-9._/+@-]{1,255}$/.test(name) &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.includes('@{')
  );
}

/**
 * The first line `git <args>` prints in `dir`, or `undefined` when it fails. It asks for nothing,
 * and never waits long.
 *
 * @param {string} dir
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function gitLine(dir, args, env) {
  const ran = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (ran.error || ran.status !== 0) return undefined;
  const line = ran.stdout.split('\n')[0]?.trim();
  return line === '' ? undefined : line;
}

/**
 * A repository on GitHub, as an address of it names it: `https://github.com/<owner>/<repo>.git`,
 * `git@github.com:<owner>/<repo>.git` and the like, or `undefined` for one that isn't.
 *
 * @param {string | undefined} address
 * @returns {{ owner: string, repo: string } | undefined}
 */
function gitHubRepoAt(address) {
  const found =
    /github\.com[:/]+([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
      address ?? '',
    );
  return found ? { owner: found[1] ?? '', repo: found[2] ?? '' } : undefined;
}

/**
 * The repository on GitHub that `remote`, a remote's name or address, points to for a push in the
 * clone at `dir`, or `undefined` when it isn't one on GitHub.
 *
 * @param {string} dir
 * @param {string | undefined} remote
 * @param {NodeJS.ProcessEnv} env
 */
function pushedTo(dir, remote, env) {
  if (remote === undefined) return undefined;
  const address =
    /^[A-Za-z0-9._-]+$/.test(remote) && !remote.startsWith('-')
      ? gitLine(dir, ['remote', 'get-url', '--push', remote], env)
      : remote;
  return gitHubRepoAt(address);
}

/**
 * The repository `gh` takes a pull request to be in, from the clone at `dir`, as it picks it
 * without asking: `GH_REPO`'s; else the one `gh repo set-default` chose (`gh-resolved` in a remote's
 * config); else the first remote on GitHub, `upstream`, `github` and `origin` first.
 *
 * @param {string} dir
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ owner: string, repo: string } | undefined}
 */
function baseRepoOf(dir, env) {
  const named = env.GH_REPO;
  if (named !== undefined && named !== '') return fullNamed(named);
  const ran = spawnSync(
    'git',
    ['-C', dir, 'config', '--get-regexp', '^remote\\..*\\.(url|gh-resolved)$'],
    {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 256 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
    },
  );
  if (ran.error || ran.status !== 0) return undefined;
  /** @type {{ name: string, at: { owner: string, repo: string } }[]} */
  const remotes = [];
  /** @type {Map<string, string>} */
  const resolved = new Map();
  for (const line of ran.stdout.split('\n')) {
    const found = /^remote\.(.+)\.(url|gh-resolved) (.*)$/.exec(line);
    if (!found) continue;
    const [, name = '', key, value = ''] = found;
    if (key === 'gh-resolved') {
      resolved.set(name, value.trim());
      continue;
    }
    const at = gitHubRepoAt(value.trim());
    if (at && !remotes.some((each) => each.name === name)) remotes.push({ name, at });
  }
  for (const { name, at } of remotes) {
    const chose = resolved.get(name);
    if (chose === 'base') return at;
    if (chose !== undefined && chose !== '') return fullNamed(chose);
  }
  const first = remotes
    .map((each, index) => ({ ...each, index }))
    .toSorted((a, b) => {
      const order = remoteRank(a.name) - remoteRank(b.name);
      return order === 0 ? a.index - b.index : order;
    })[0];
  return first?.at;
}

/**
 * Where `gh` puts a remote named `name` among those it picks from: `upstream`, `github` and
 * `origin` first, in that order, then the rest.
 *
 * @param {string} name
 */
function remoteRank(name) {
  const rank = ['upstream', 'github', 'origin'].indexOf(name.toLowerCase());
  return rank < 0 ? 3 : rank;
}

/**
 * The repository `name` names as `gh` takes one: `<owner>/<repo>`, or `<host>/<owner>/<repo>`.
 *
 * @param {string} name
 * @returns {{ owner: string, repo: string } | undefined}
 */
function fullNamed(name) {
  const parts = name.trim().split('/');
  const [owner, repo] = parts.slice(-2);
  return parts.length <= 3 && owner && repo ? { owner, repo } : undefined;
}

/**
 * Whether `a` and `b` are the same repository on GitHub, as GitHub compares names.
 *
 * @param {{ owner: string, repo: string }} a
 * @param {{ owner: string, repo: string }} b
 */
function sameRepo(a, b) {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

/**
 * The names the branch checked out in `dir` has: its own, and those it's pushed to and tracks on
 * its remote, as `git push` with no branch named may push it under another.
 *
 * @param {string} dir
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function currentNames(dir, env) {
  const own = gitLine(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'], env);
  if (own === undefined) return [];
  const names = [own];
  for (const which of ['@{push}', '@{upstream}']) {
    const remote = gitLine(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', which], env);
    const name = remote?.slice(remote.indexOf('/') + 1);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The open pull request `gh` finds, from `dir`, for `target`'s branch: the one checked out, by
 * what `gh` reads of its config; or another by its name, as `<owner>:<branch>` when it went to a
 * repository other than the one `gh` looks in, a fork, as `gh` matches a pull request from one only
 * so. It's taken only when it's open, and its head is the branch: `gh` reads a name of digits as a
 * pull request's number, so one is asked about only as a fork's.
 *
 * @param {string} dir
 * @param {Target} target
 * @param {NodeJS.ProcessEnv} env
 * @returns {Pull | undefined}
 */
export function openPullFor(dir, target, env) {
  const current = currentNames(dir, env);
  const args = ['pr', 'view', '--json', 'url,state,headRefName,headRepositoryOwner'];
  /** @type {string[]} */
  let names;
  /** @type {string | undefined} */
  let owner;
  const branch =
    target.branch !== CURRENT && target.owner === undefined && target.branch === current[0]
      ? CURRENT
      : target.branch;
  if (branch === CURRENT) {
    if (current.length === 0) return undefined;
    names = current;
  } else {
    if (!isBranchName(branch)) return undefined;
    const base = baseRepoOf(dir, env);
    if (base === undefined) return undefined;
    const to =
      target.owner === undefined
        ? pushedTo(dir, target.remote, env)
        : { owner: target.owner, repo: base.repo };
    owner = to === undefined || sameRepo(to, base) ? undefined : to.owner;
    if (owner === undefined && /^[0-9]+$/.test(branch)) return undefined;
    args.push('--', owner === undefined ? branch : `${owner}:${branch}`);
    names = [branch];
  }
  const ran = spawnSync('gh', args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: GH_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
  });
  if (ran.error || ran.status !== 0) return undefined;
  try {
    const found = JSON.parse(ran.stdout);
    if (field(found, 'state') !== 'OPEN') return undefined;
    const head = field(found, 'headRefName');
    if (typeof head !== 'string' || !names.includes(head)) return undefined;
    const login = field(field(found, 'headRepositoryOwner'), 'login');
    if (
      owner !== undefined &&
      (typeof login !== 'string' || login.toLowerCase() !== owner.toLowerCase())
    ) {
      return undefined;
    }
    return pullOf(field(found, 'url'));
  } catch {
    return undefined;
  }
}

/**
 * A folder that's there, as `path` names it, or `undefined`.
 *
 * @param {unknown} path
 */
function folderAt(path) {
  if (typeof path !== 'string') return undefined;
  try {
    // Codex may name it by its `file:` URL.
    const local = path.startsWith('file://') ? fileURLToPath(path) : path;
    return isAbsolute(local) && statSync(local).isDirectory() ? local : undefined;
  } catch {
    return undefined;
  }
}

/** Where a repository that installed the skill has it, by the path from its top. */
const INSTALLED = join('.claude', 'skills', 'lo-overview', 'SKILL.md');

/**
 * The top of the repository `dir` is in, when it installed the skill, or `undefined`: a push from
 * any other clone isn't the hook's to answer.
 *
 * @param {string} dir
 */
function skilledTop(dir) {
  const top = topOf(dir);
  if (top === undefined) return undefined;
  try {
    return statSync(join(top, INSTALLED)).isFile() ? top : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The open pull requests `input`, the hook's, says the call opened or pushed to, each with the
 * repository's top folder, in the order found, at most `MOST`, and `gh` asked at most that many
 * times. A call whose folder the hook can't tell, that runs in the background, or that ran in a
 * clone without the skill, says none.
 *
 * @param {unknown} input
 * @param {NodeJS.ProcessEnv} env
 * @param {(dir: string, target: Target) => Pull | undefined} find
 * @returns {{ pull: Pull, top: string }[]}
 */
export function pullsOf(input, env, find = (dir, target) => openPullFor(dir, target, env)) {
  const tool = field(input, 'tool_name');
  const cwd = folderAt(field(input, 'cwd'));
  if (cwd === undefined) return [];
  const response = field(input, 'tool_response');
  const printed = textOf(response);
  /** @type {{ pull: Pull, top: string }[]} */
  const pulls = [];
  /** @param {Pull | undefined} pull @param {string} top */
  const add = (pull, top) => {
    if (pull && pulls.length < MOST && !pulls.some((each) => sameLock(each.pull, pull))) {
      pulls.push({ pull, top });
    }
  };
  let asked = 0;
  /** @param {string} dir @param {Target} target */
  const ask = (dir, target) => (asked++ < MOST ? find(dir, target) : undefined);
  if (typeof tool === 'string' && /^mcp__.+__create_pull_request$/.test(tool)) {
    const top = skilledTop(cwd);
    if (top !== undefined) add(firstPullIn(printed), top);
    return pulls;
  }
  if (tool !== 'Bash') return pulls;
  const given = field(input, 'tool_input');
  // Still running, so not pushed yet, whatever it prints later.
  if (field(given, 'run_in_background') === true) return pulls;
  const command = commandText(given);
  if (command === undefined) return pulls;
  const actions = actionsIn(command, cwd);
  if (actions.length === 0 || failedOrIdle(printed)) return pulls;
  const creates = actions.filter((action) => action.kind === 'create').length;
  for (const action of actions) {
    if (pulls.length >= MOST || asked >= MOST) break;
    const dir = folderAt(action.dir);
    const top = dir === undefined ? undefined : skilledTop(dir);
    if (dir === undefined || top === undefined) continue;
    if (action.kind === 'create') {
      const head = action.head;
      const colon = head?.indexOf(':') ?? -1;
      /** @type {Target} */
      const target =
        head === undefined
          ? { branch: CURRENT }
          : colon > 0
            ? { branch: head.slice(colon + 1), owner: head.slice(0, colon) }
            : { branch: head };
      add(createdPull(response, printed, creates === 1) ?? ask(dir, target), top);
    } else {
      for (const branch of action.branches) add(ask(dir, { branch, remote: action.remote }), top);
    }
  }
  return pulls;
}

/**
 * Whether `a` and `b` are the same pull request, as their locks are.
 *
 * @param {Pull} a
 * @param {Pull} b
 */
function sameLock(a, b) {
  return (
    a.number === b.number &&
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

/**
 * The first pull request's link in `text`, as an MCP tool that opened one gives it.
 *
 * @param {string} text
 */
function firstPullIn(text) {
  for (const match of text.matchAll(PULL_LINK)) {
    const pull = pullFrom(match);
    if (pull) return pull;
  }
  return undefined;
}

/**
 * The pull request `gh pr create` opened: from what Claude Code read of it, else the link it
 * printed, when the command opened one and printed only one: another command's link, such as
 * `gh pr view`'s after it, could be another pull request's.
 *
 * @param {unknown} response
 * @param {string} printed
 * @param {boolean} alone
 */
function createdPull(response, printed, alone) {
  const read = pullOf(field(field(field(response, 'gitOperation'), 'pr'), 'url'));
  if (read || !alone) return read;
  const links = new Set([...printed.matchAll(PULL_LINK)].map((match) => match[0].toLowerCase()));
  return links.size === 1 ? lastPullIn(printed) : undefined;
}

/**
 * The shell command a call ran, from its `tool_input`.
 *
 * @param {unknown} input
 * @returns {string | undefined}
 */
function commandText(input) {
  const command = field(input, 'command');
  if (typeof command === 'string') return command;
  if (Array.isArray(command) && command.every((word) => typeof word === 'string')) {
    // Codex may give the program and its words: the last is the script a shell runs.
    const last = command.at(-1) ?? '';
    return command.length >= 3 && /(?:^|\/)(?:ba|z|da)?sh$/.test(command[0] ?? '')
      ? last
      : command.map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(' ');
  }
  return undefined;
}

// --- The answer -----------------------------------------------------------------------------------

/**
 * What the hook adds to the agent's context: for each pull request it took the lock on, how to
 * start the skill; for each another writer has, that it will run again.
 *
 * @param {{ pull: Pull, lock: 'taken' | 'same' | 'held' | 'unlocked' }[]} each
 * @param {'claude' | 'codex'} host
 */
export function answerFor(each, host) {
  const start = each
    .filter(({ lock }) => lock === 'taken' || lock === 'unlocked')
    .map(({ pull }) => pull.url);
  const running = each.filter(({ lock }) => lock === 'held').map(({ pull }) => pull.url);
  /** @type {string[]} */
  const lines = [];
  for (const url of running) {
    lines.push(
      `Lo: the overview of ${url} is being written, and will be updated for this push once that's done. Don't start the lo-overview skill for it now.`,
    );
  }
  for (const url of start) {
    const run =
      host === 'codex'
        ? `Start a subagent with spawn_agent, asking it to use the lo-overview skill ($lo-overview) with the arguments \`${url} <folder>/handoff.md\`, and go on with your work; it reports one line when it's done. Where you can't start one, use the skill yourself now, with those arguments.`
        : `Start the lo-overview skill with the arguments \`${url} <folder>/handoff.md\`. It runs in the background: go on with your work, and pass on the one line it reports when it's done.`;
    lines.push(
      `Lo: write the overview of ${url} for this push, with the lo-overview skill.`,
      `1. Make a folder with \`mktemp -d\` and write handoff.md in it: the change's goal, the decisions you made and the alternatives you rejected, the commands you ran and what came of them, and open questions. Only facts about the change: no secrets, tokens or personal details.`,
      `2. ${run}`,
    );
  }
  return lines.join('\n');
}

/**
 * What the hook says for `input`, its input from Claude Code or Codex, as the JSON to print, or
 * `undefined` to say nothing.
 *
 * @param {unknown} input
 * @param {{ env?: NodeJS.ProcessEnv, find?: (dir: string, target: Target) => Pull | undefined, now?: number }} [options]
 * @returns {string | undefined}
 */
export function hook(input, { env = process.env, find, now = Date.now() } = {}) {
  if (Array.isArray(input) || field(input, 'hook_event_name') !== 'PostToolUse') return undefined;
  const pulls = pullsOf(input, env, find).filter(({ top }) => offBy(top, env) === undefined);
  if (pulls.length === 0) return undefined;
  const id = field(input, 'tool_use_id');
  const call = typeof id === 'string' ? id : undefined;
  const each = pulls.map(({ pull, top }) => ({
    pull,
    lock: takeLock(pull, { dir: top, env, now, call }),
  }));
  if (each.every(({ lock }) => lock === 'same')) return undefined;
  const host = field(input, 'turn_id') === undefined ? 'claude' : 'codex';
  const additionalContext = answerFor(each, host);
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext },
  });
}

/** Runs the hook on what's on its standard input, and prints its answer. */
function main() {
  try {
    const bytes = readFileSync(0);
    if (bytes.length > INPUT_LIMIT) return;
    const said = hook(JSON.parse(bytes.toString('utf8')));
    if (said !== undefined) process.stdout.write(`${said}\n`);
  } catch {
    // Nothing to say: the agent goes on as if there were no hook.
  }
}

/** Whether this file is the one Node was asked to run, not one that imports it. */
function isRun() {
  const ran = process.argv[1];
  if (ran === undefined) return false;
  try {
    const self = fileURLToPath(import.meta.url);
    return basename(self) === 'hook.mjs' && realpathSync(ran) === realpathSync(self);
  } catch {
    return false;
  }
}

if (isRun()) main();
