// A pull request's manifest: what the suite needs to rebuild the PR from its public repo, and
// nothing else. The commits pin the files' text, which the fetch script downloads with git. Review
// threads keep their place and each comment's length, never the comment's words or its author.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { z } from 'zod';

const sha = z.string().regex(/^[0-9a-f]{40}$/, 'a full commit ID');

/** A path inside the repo: relative, with no `.` or `..` parts. */
const path = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\0') &&
      value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'a relative path inside the repo',
  );

const count = z.int().nonnegative();

/** How GitHub says a file changed. */
export const FileStatus = z.enum([
  'added',
  'removed',
  'modified',
  'renamed',
  'copied',
  'changed',
  'unchanged',
]);
export type FileStatus = z.infer<typeof FileStatus>;

export const ChangedFile = z.strictObject({
  path,
  /** Where a renamed or copied file came from. */
  previousPath: path.optional(),
  status: FileStatus,
  /** Lines added and removed, as GitHub counts them. */
  additions: count,
  deletions: count,
});
export type ChangedFile = z.infer<typeof ChangedFile>;

export const Thread = z.strictObject({
  path,
  side: z.enum(['left', 'right']),
  /** The line it's on, or for an outdated thread the line it was on. None for a file's thread. */
  line: z.int().positive().optional(),
  outdated: z.literal(true).optional(),
  /** Each comment's length in UTF-16 code units, oldest first. */
  comments: z.array(count).min(1),
});
export type Thread = z.infer<typeof Thread>;

export const Manifest = z.strictObject({
  /** `owner/name` on GitHub. An owner has only letters, digits and hyphens. */
  repo: z
    .string()
    .regex(/^[A-Za-z0-9-]+\/[\w.-]+$/, 'owner/name')
    .refine((repo) => !['.', '..'].includes(repo.split('/')[1] ?? ''), 'owner/name'),
  number: z.int().positive(),
  /** The merge base the PR's diff starts from, and the PR's head. */
  base: sha,
  head: sha,
  files: z.array(ChangedFile),
  threads: z.array(Thread),
});
export type Manifest = z.infer<typeof Manifest>;

/** The folder that holds the committed manifests. */
export const dataFolder = join(import.meta.dirname, '../../data');

/** A manifest's file name, without `.json`: the repo's name and the PR's number. */
export function manifestName({ repo, number }: Pick<Manifest, 'repo' | 'number'>): string {
  const name = repo.split('/')[1] ?? repo;
  return `${name.toLowerCase()}-${number}`;
}

/** Reads and checks a manifest, by its name (`kubernetes-125488`) or path. */
export function readManifest(nameOrPath: string, folder = dataFolder): Manifest {
  const file = nameOrPath.endsWith('.json') ? nameOrPath : join(folder, `${nameOrPath}.json`);
  const manifest = Manifest.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!manifest.success) {
    throw new Error(`${file} isn't a valid manifest:\n${z.prettifyError(manifest.error)}`);
  }
  if (`${manifestName(manifest.data)}.json` !== basename(file)) {
    throw new Error(`${file} should be named ${manifestName(manifest.data)}.json`);
  }
  return manifest.data;
}

/** The names of the committed manifests. */
export function manifestNames(folder = dataFolder): string[] {
  return readdirSync(folder)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .toSorted();
}

/** GitHub's token formats: classic, OAuth, app and fine-grained. */
const tokenShape = /gh[opsur]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/g;

/** How many things in `text` look like a GitHub token. */
export function countTokens(text: string): number {
  return text.match(tokenShape)?.length ?? 0;
}
