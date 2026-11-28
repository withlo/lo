/**
 * `fold`: a merged pull request's definitions, into the repository's definitions, the store at
 * `refs/lo/terms`. Its overview is read from the base repository's `refs/lo/pr/<n>`, else its
 * fork's, else the base repository's copy of the fork's, and checked as Lo checks one. Each term
 * its glossary marks `(new)` or `(changed)` is added, or its definition replaced, the one it had
 * kept in its changes; a locked term gets a suggestion instead. Each is written by an agent, by the
 * account the overview's commit maps to, or the commit's git name when GitHub maps it to none, from
 * the pull request, when it merged. Unmarked entries change nothing. A repository's first merged
 * pull request with a marked term makes the store.
 *
 * The store is pushed fast-forward only. When it moved meanwhile, it's read again and each term
 * folded in again, since each is a change of its own. Folding a pull request twice changes nothing
 * the second time: a term the pull request has changed already, in its definition, its changes or
 * its suggestions, is left as it is.
 */

import {
  emptyStore,
  fittedStoreText,
  parseStore,
  readStore,
  sameDefinition,
  STORE_FILE,
  STORE_LIMITS,
  STORE_REF,
  storeText,
  withDefinition,
  withSuggestion,
  withTerm,
  type Account,
  type StoreDefinition,
  type GlossaryEntry,
  type Store,
  type StoreTerm,
} from '@lo/artifact';

import { gitCode } from './code.ts';
import { keptRefOf, refOf } from './commit.ts';
import { run, type Git } from './git.ts';
import { plain, type PullRequest } from './github.ts';
import { judgeOverview } from './judge.ts';
import { pullOf, WorkflowError, type WorkflowOptions } from './keep.ts';
import type { CommitHeader } from './listing.ts';
import type { Remote } from './remote.ts';

/** How many times the store is read and pushed before `fold` gives up on it moving. */
export const ATTEMPTS = 5;

/** Who commits the store: GitHub's own account for workflows. */
const COMMITTER = 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>';

export interface FoldOptions extends WorkflowOptions {
  /** The time now: the store's commit's, and a term's when GitHub doesn't say when it merged. */
  now?: () => Date;
  /** Waits `ms` milliseconds, before the store is read again. */
  pause?: (ms: number) => Promise<void>;
  /** Runs before each push of the store. */
  beforePush?: () => Promise<void>;
}

/** What folding one term did. */
export type Folded =
  | { kind: 'added' | 'changed' | 'suggested'; name: string }
  | { kind: 'same' | 'folded' | 'full' | 'refused'; name: string; why?: string };

/** Folds the definitions of the merged pull request `options` names into the store. */
export async function fold(options: FoldOptions): Promise<void> {
  const { pr, base, log, workspace } = options;
  const now = options.now ?? (() => new Date());
  const pause = options.pause ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const pull = await pullOf(options);
  if (!pull.merged) {
    log.info(`#${pr} hasn't merged, so its definitions aren't added.`);
    return;
  }
  const source = await overviewOf(options, pull);
  if (!source) {
    log.info(`#${pr} has no overview, so there are no definitions to add.`);
    return;
  }
  const id = (await workspace.fetch(source.remote, [{ from: source.ref, to: 'overview' }])).get(
    source.ref,
  )!;
  const judged = await judgeOverview(workspace.git, id, { pr });
  if (!judged.ok) {
    log.warning(
      `#${pr}'s overview, ${source.ref} in ${source.name} at ${id}, isn't one Lo shows, so its definitions aren't added. ${judged.why}`,
    );
    return;
  }
  log.info(`Read #${pr}'s overview from ${source.ref} in ${source.name}, at ${id}.`);
  const marked: GlossaryEntry[] = [];
  for (const entry of judged.parsed.glossary) {
    if (entry.mark === undefined) continue;
    if (entry.definition === undefined || entry.unstorable !== undefined) {
      log.warning(
        `${named(entry.name)} is marked (${entry.mark}), and its definition ${entry.unstorable ?? 'is more than one paragraph'}, so it isn't added.`,
      );
      continue;
    }
    marked.push(entry);
  }
  if (marked.length === 0) {
    log.info(`#${pr}'s overview marks no term (new) or (changed), so there's nothing to add.`);
    return;
  }

  const by = await authorOf(options, pull, judged.commit);
  const at = pull.mergedAt ?? timeOf(now());
  const given = { by, from: pr, at };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await pause(1_000 * attempt + Math.floor(Math.random() * 1_000));
    const listed = await workspace.list(base.remote, [STORE_REF]);
    const parent = listed.has(STORE_REF)
      ? (await workspace.fetch(base.remote, [{ from: STORE_REF, to: 'terms' }])).get(STORE_REF)
      : undefined;
    const store = parent === undefined ? emptyStore() : await storeAt(workspace.git, parent);
    const { next, folded } = foldInto(store, marked, given);
    const changed = folded.filter(({ kind }) => isChange(kind));
    if (changed.length === 0) {
      for (const each of folded) log.info(said(each, pr));
      return;
    }
    const text = fittedStoreText(next);
    if (text === undefined) {
      throw new WorkflowError(
        `With #${pr}'s definitions, ${STORE_FILE} would be larger than ${STORE_LIMITS.size / 1024 / 1024} MiB, the most the store may be, so they aren't added.`,
      );
    }
    const reread = parseStore(text);
    if (!reread.ok) {
      throw new WorkflowError(
        `With #${pr}'s definitions, ${STORE_FILE} wouldn't be one Lo reads, so they aren't added: ${reread.problem.message}`,
      );
    }
    const commit = await storeCommit(workspace.git, text, parent, pr, now());
    await options.beforePush?.();
    const pushed = await workspace.push(base.remote, commit, STORE_REF);
    switch (pushed.kind) {
      case 'pushed':
        for (const each of folded) log.info(said(each, pr));
        log.info(`Pushed ${commit} to ${STORE_REF}${parent ? `, after ${parent}` : ''}.`);
        return;
      case 'moved':
        log.info(
          `${STORE_REF} moved as #${pr}'s definitions were added (${pushed.said}), so they're added again to what it holds now.`,
        );
        continue;
      case 'refused':
        throw new WorkflowError(`${base.name} refused the definitions: ${pushed.said}`);
      default:
        pushed satisfies never;
        throw new WorkflowError(`Pushing to ${STORE_REF} gave ${JSON.stringify(pushed)}.`);
    }
  }
  throw new WorkflowError(
    `${STORE_REF} moved each of the ${ATTEMPTS} times #${pr}'s definitions were added, so they aren't. Run the workflow again for #${pr}.`,
  );
}

/** Where the overview of `pull` is: the base repository's, else its fork's, else the copy. */
async function overviewOf(
  { pr, base, fork, log, workspace }: WorkflowOptions,
  pull: PullRequest,
): Promise<{ name: string; remote: Remote; ref: string } | undefined> {
  const own = refOf({ pr });
  const kept = keptRefOf({ pr });
  const listed = await workspace.list(base.remote, [own, kept]);
  if (listed.has(own)) return { name: base.name, remote: base.remote, ref: own };
  if (pull.head && pull.head.id !== pull.base.id) {
    const theirs = { name: pull.head.name, remote: fork(pull.head.name), ref: own };
    try {
      if ((await workspace.list(theirs.remote, [own])).has(own)) return theirs;
    } catch (error) {
      log.warning(
        `${pull.head.name}, #${pr}'s fork, couldn't be read, so its copy is read if there's one. ${messageOf(error)}`,
      );
    }
  }
  if (listed.has(kept)) return { name: base.name, remote: base.remote, ref: kept };
  return undefined;
}

/**
 * Who wrote the overview's commit: the account GitHub maps its author to, in the base repository
 * or else the fork, or its git name, which isn't verified.
 */
async function authorOf(
  { base, github }: WorkflowOptions,
  pull: PullRequest,
  commit: CommitHeader,
): Promise<Account> {
  let login = await github.commitLogin(base.name, commit.id);
  if (login === undefined && pull.head && pull.head.id !== pull.base.id) {
    login = await github.commitLogin(pull.head.name, commit.id).catch(() => undefined);
  }
  return login === undefined ? { name: gitName(commit.author.name) } : { login };
}

/** The most bytes of a git name the store holds. */
const NAME_LIMIT = STORE_LIMITS.name;

/**
 * `name`, a commit's author's, as the store may hold it: with no invisible or control character,
 * each run of spaces as one and none at either end, in at most {@link NAME_LIMIT} bytes, or
 * "unknown" when that leaves nothing.
 */
export function gitName(name: string): string {
  const plainName = name
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let kept = '';
  let bytes = 0;
  for (const char of plainName) {
    bytes += Buffer.byteLength(char);
    if (bytes > NAME_LIMIT) break;
    kept += char;
  }
  return kept.trim() || 'unknown';
}

/** The store in the commit `id`. Throws when it's one Lo can't read: nothing is added to it. */
async function storeAt(git: Git, id: string): Promise<Store> {
  const code = gitCode(git, [STORE_FILE]);
  try {
    const read = await readStore(
      (path, cap, signal) => code.read(id, path, cap, signal),
      AbortSignal.timeout(30_000),
    );
    if (read.ok) return read.store;
    throw new WorkflowError(
      `The repository's definitions, at ${STORE_REF} (${id}), can't be read, so nothing is added to them: ${read.problem.message}`,
    );
  } finally {
    code.close();
  }
}

/**
 * `store` with the terms `marked` in an overview's glossary folded in, each as `given` wrote it,
 * and what each one did.
 */
export function foldInto(
  store: Store,
  marked: readonly GlossaryEntry[],
  given: Omit<StoreDefinition, 'definition' | 'written'> & { from: number },
): { next: Store; folded: Folded[] } {
  let next = store;
  const folded: Folded[] = [];
  for (const { name, key, definition: text } of marked) {
    if (text === undefined) continue;
    const definition: StoreDefinition = { definition: text, written: 'agent', ...given };
    const owner = next.names.get(key);
    const current = owner === undefined ? undefined : next.terms.get(owner);
    if (!current) {
      if (next.terms.size >= STORE_LIMITS.terms) {
        folded.push({ kind: 'full', name });
        continue;
      }
      const added = withTerm(next, name, definition);
      const why = refusal(added.terms.get(key)!);
      if (why !== undefined) {
        folded.push({ kind: 'refused', name, why });
        continue;
      }
      next = added;
      folded.push({ kind: 'added', name });
      continue;
    }
    if (
      current.from === given.from ||
      current.changes.some(({ from }) => from === given.from) ||
      current.suggestions.some(({ from }) => from === given.from)
    ) {
      folded.push({ kind: 'folded', name });
      continue;
    }
    if (sameDefinition(current.definition, text)) {
      folded.push({ kind: 'same', name });
      continue;
    }
    const changed = current.locked
      ? withSuggestion(next, current.key, { definition: text, ...given })
      : withDefinition(next, current.key, definition);
    const why = refusal(changed.terms.get(current.key)!);
    if (why !== undefined) {
      folded.push({ kind: 'refused', name, why });
      continue;
    }
    next = changed;
    folded.push({ kind: current.locked ? 'suggested' : 'changed', name });
  }
  return { next, folded };
}

/** Why the store can't hold `term`, as its rules say, or undefined when it can. */
function refusal(term: StoreTerm): string | undefined {
  const alone: Store = {
    format: 1,
    terms: new Map([[term.key, term]]),
    names: new Map([[term.key, term.key]]),
  };
  const read = parseStore(storeText(alone));
  return read.ok ? undefined : read.problem.message;
}

function isChange(kind: Folded['kind']): boolean {
  return kind === 'added' || kind === 'changed' || kind === 'suggested';
}

/** What folding a term did, in a sentence. */
function said(folded: Folded, pr: number): string {
  const name = named(folded.name);
  switch (folded.kind) {
    case 'added':
      return `Added ${name}, from #${pr}.`;
    case 'changed':
      return `Changed ${name}'s definition to #${pr}'s, and kept the one it had in its changes.`;
    case 'suggested':
      return `${name} is locked, so #${pr}'s definition of it is a suggestion.`;
    case 'same':
      return `${name} has #${pr}'s definition already.`;
    case 'folded':
      return `${name} has #${pr}'s change already.`;
    case 'full':
      return `${name} isn't added: the store holds ${STORE_LIMITS.terms.toLocaleString('en-US')} terms, the most it may.`;
    case 'refused':
      return `${name} isn't added: ${folded.why ?? "the store can't hold it."}`;
    default:
      folded satisfies never;
      return `${name}: ${JSON.stringify(folded)}`;
  }
}

/** A term's name, quoted, on one line. */
function named(name: string): string {
  return JSON.stringify(plain(name));
}

/** `date` as the store writes a time, to the second, in UTC. */
function timeOf(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * Writes `text` as `terms.json`, the one file of a new commit whose parent is `parent`, if there is
 * one, and returns the commit's id.
 */
async function storeCommit(
  git: Git,
  text: string,
  parent: string | undefined,
  pr: number,
  date: Date,
): Promise<string> {
  const blob = await objectId(
    git,
    ['hash-object', '-w', '--stdin', '--no-filters'],
    Buffer.from(text),
  );
  const tree = await objectId(
    git,
    ['mktree', '-z'],
    Buffer.from(`100644 blob ${blob}\t${STORE_FILE}\0`),
  );
  const when = `${Math.floor(date.getTime() / 1000)} +0000`;
  const commit = [
    `tree ${tree}`,
    ...(parent ? [`parent ${parent}`] : []),
    `author ${COMMITTER} ${when}`,
    `committer ${COMMITTER} ${when}`,
    '',
    `Definitions from pull request #${pr}`,
    '',
  ].join('\n');
  return objectId(git, ['hash-object', '-t', 'commit', '-w', '--stdin'], Buffer.from(commit));
}

async function objectId(git: Git, args: readonly string[], input: Uint8Array): Promise<string> {
  const id = (await run(git, args, input)).toString('utf8').trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id)) {
    throw new WorkflowError(`git ${args[0] ?? ''} answered ${JSON.stringify(plain(id))}.`);
  }
  return id;
}

function messageOf(error: unknown): string {
  return plain(error instanceof Error ? error.message : String(error));
}
