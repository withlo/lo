// What the code feature keeps in the settings file: the repositories and pull requests the reader
// trusts to run language servers on. Main writes it, and only once its own dialog says so; the
// window shows it in Settings and can't change it. Each entry names a repository by GitHub's node
// ID as well as its name, since a name can change hands and an ID can't.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/**
 * A repository's name as GitHub writes it, `owner/name`: an owner of letters, digits and single
 * hyphens, and a name of letters, digits, `.`, `-` and `_`, other than `.` and `..`.
 */
export const repoName = z
  .string()
  .max(140)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/)
  .refine((name) => !/\/\.{1,2}$/.test(name), 'is no repository GitHub allows');

/** A node ID as GitHub gives one, such as `R_kgDOVleUfQ`, which stays with what it names. */
export const nodeId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_=+/-]+$/);

/** A pull request's number in its repository, as GitHub can hold one. */
export const pullNumber = z
  .number()
  .int()
  .min(1)
  .max(2 ** 31 - 1);

/** When an entry was trusted, as Lo writes it: an ISO 8601 time. */
const when = z.iso.datetime({ offset: true });

/** A repository the reader trusts, every pull request in it but those from forks. */
const repoEntry = z.strictObject({ repo: repoName, id: nodeId, at: when.optional() });

/**
 * One pull request the reader trusts, from a fork, with its later pushes: the repository it's in
 * (`repo`, `id`), its number, and the fork its head comes from (`from`, `fromId`).
 */
const pullEntry = z.strictObject({
  repo: repoName,
  id: nodeId,
  pull: pullNumber,
  from: repoName,
  fromId: nodeId,
  at: when.optional(),
});

export type RepoEntry = z.output<typeof repoEntry> & { readonly kind: 'repo' };
export type PullEntry = z.output<typeof pullEntry> & { readonly kind: 'pull' };
/** An entry of {@link trusted} that Lo reads. */
export type TrustEntry = RepoEntry | PullEntry;

/**
 * The most entries the setting holds: far more than anyone trusts, and about what the settings
 * file's own limit on its size leaves room for. A list longer than this is refused whole, and
 * then main's `settings.update` won't add to it, rather than replace it.
 */
export const TRUSTED_MAX = 10_000;

/**
 * The repositories and pull requests the reader trusts, as the file holds them: each entry a
 * `{ repo, id, at }` for a repository, or a `{ repo, id, pull, from, fromId, at }` for one pull
 * request from a fork. The schema takes any list, so one entry Lo can't read is reported and
 * ignored ({@link readTrusted}) while the rest still count. Only main writes it.
 */
export const trusted = defineSetting(
  'code.trusted',
  z.array(z.json()).max(TRUSTED_MAX),
  [],
  'a list of trusted repos and pull requests',
  {
    group: 'code',
    label: 'Trusted',
    description: 'Language servers run only on these repos and pull requests.',
    window: 'read',
    problems: (value) => readTrusted(value).problems,
  },
);

/**
 * Whether code views show the types a language server gives beside names, as inline hints: off
 * unless the reader turns them on, with `gh`, the View menu or Settings, and then on at every start.
 */
export const hints = defineSetting('code.hints', z.boolean(), false, 'true or false', {
  group: 'code',
  label: 'Type hints',
  description: 'Shows types beside names in code, where a language server gives them.',
});

/** The most of the ignored entries {@link readTrusted} names one by one. */
const NAMED = 5;

/** What an entry the setting can't read is, for what Lo says of it. */
function described(entry: unknown, at: number): string {
  const which = `code.trusted's entry ${at + 1}`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return which;
  const repo = 'repo' in entry && typeof entry.repo === 'string' ? entry.repo : undefined;
  return repo === undefined ? which : `${which} (${repo.slice(0, 140)})`;
}

/** Why Lo can't read `entry`, an object, in words. */
function why(entry: object): string {
  if (!('id' in entry)) return 'has no id, which Lo checks the repository by';
  if ('pull' in entry) {
    const issue = pullEntry.safeParse(entry).error?.issues[0];
    return `isn't a pull request Lo reads${issue ? `: ${issueText(issue)}` : ''}`;
  }
  const issue = repoEntry.safeParse(entry).error?.issues[0];
  return `isn't a repository Lo reads${issue ? `: ${issueText(issue)}` : ''}`;
}

/** A Zod issue in a few words, naming where it is. */
function issueText(issue: z.core.$ZodIssue): string {
  if (issue.code === 'unrecognized_keys')
    return `it has ${issue.keys.join(', ')}, which Lo doesn't know`;
  const where = issue.path.join('.');
  return where === '' ? issue.message : `${where} ${issue.message}`;
}

/** One of the setting's entries, as Lo reads it, or nothing when Lo ignores it. */
export function readEntry(entry: unknown): TrustEntry | undefined {
  const pull = pullEntry.safeParse(entry);
  if (pull.success) return { kind: 'pull', ...pull.data };
  const repo = repoEntry.safeParse(entry);
  if (repo.success) return { kind: 'repo', ...repo.data };
  return undefined;
}

/** `entry` as the file holds it: its keys in the order Lo writes them, without its kind. */
export function fileEntry(entry: TrustEntry): Record<string, string | number> {
  const { repo, id } = entry;
  const written: Record<string, string | number> =
    entry.kind === 'repo'
      ? { repo, id }
      : { repo, id, pull: entry.pull, from: entry.from, fromId: entry.fromId };
  if (entry.at !== undefined) written.at = entry.at;
  return written;
}

/** The setting's list, as the file holds it. */
export type Listed = typeof trusted.fallback;

/**
 * The entries of `value`, the setting's list, that Lo reads, and what it says of those it
 * ignores: one that isn't an object, has no `id`, or isn't either kind exactly, as when it has a
 * key neither kind has. An entry is never half read: one with a key misspelled could otherwise
 * read as a whole repository, where it meant one pull request.
 */
export function readTrusted(value: readonly unknown[]): {
  entries: TrustEntry[];
  problems: string[];
} {
  const entries: TrustEntry[] = [];
  const ignored: string[] = [];
  for (const [at, entry] of value.entries()) {
    const read = readEntry(entry);
    if (read) {
      entries.push(read);
      continue;
    }
    const object = typeof entry === 'object' && entry !== null && !Array.isArray(entry);
    ignored.push(
      `${described(entry, at)} ${object ? why(entry) : "isn't an object"}, so Lo ignores it.`,
    );
  }
  const problems = ignored.slice(0, NAMED);
  if (ignored.length > NAMED) {
    const more = ignored.length - NAMED;
    problems.push(`Lo ignores ${more} more ${more === 1 ? 'entry' : 'entries'} of code.trusted.`);
  }
  return { entries, problems };
}

/** Whether two repositories' names are the same one, as GitHub compares them: in any case. */
export function sameName(one: string, other: string): boolean {
  return one.toLowerCase() === other.toLowerCase();
}
