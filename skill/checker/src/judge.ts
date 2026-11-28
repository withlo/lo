/**
 * Judging the overviews the workflow copies and reads, which come from anywhere, a fork included:
 * whether a commit holds an overview Lo shows, for the pull request or stack its ref is for, and
 * whether a commit under it holds only what an overview's commit may. Its text, figures and commit
 * are checked as Lo checks them; the code it points at isn't read, since a copy keeps an overview
 * whatever its code blocks show, and Lo checks those as it shows them.
 */

import {
  ARTIFACT,
  ARTIFACT_READ,
  CHECK_TIMEOUT,
  checkArtifact,
  Findings,
  LIMITS,
  parseArtifact,
  readCommit,
  type CodeReader,
  type Header,
  type OnRef,
  type OverviewFiles,
  type ParsedArtifact,
} from '@lo/artifact';

import { gitCode, STREAM_LIMIT } from './code.ts';
import { GitError, Objects, type Git } from './git.ts';
import { commitHeader, listTree, NotOverview, type CommitHeader } from './listing.ts';

/** What judging a commit found: an overview Lo shows, or why it isn't one. */
export type Judged =
  | { ok: true; commit: CommitHeader; header: Header; parsed: ParsedArtifact }
  | { ok: false; why: string };

/** No code is read: each block that names some is left unread. */
const NO_CODE: CodeReader = async () => ({ kind: 'noCommit' });

/**
 * Whether the commit `id`, in the repository `git` runs in, holds an overview Lo shows on the ref
 * `on` names: one whose text it reads, in this format, within its limits, whose header names that
 * pull request or stack, in a commit holding nothing but its text and figures.
 */
export async function judgeOverview(git: Git, id: string, on: OnRef): Promise<Judged> {
  const objects = new Objects(git, STREAM_LIMIT);
  const code = gitCode(git, [ARTIFACT]);
  try {
    const commit = await commitHeader(objects, id);
    if (!commit) return { ok: false, why: `The repository doesn't have commit ${id}.` };
    const entries = await listTree(objects, commit.tree, LIMITS.entries);
    const signal = AbortSignal.timeout(CHECK_TIMEOUT);
    const files: OverviewFiles = {
      entries,
      read: (path, cap, stop) => code.read(id, path, cap, stop),
    };
    let parsed: ParsedArtifact | undefined;
    const text = await code.read(id, ARTIFACT, ARTIFACT_READ, signal);
    if (text.kind === 'file' && text.bytes.length === text.size) parsed = parseArtifact(text.bytes);
    const checked = await checkArtifact(parsed, files, NO_CODE, { ...on });
    const { outcome, findings } = checked;
    const extra = findings.find(({ code: kind }) => kind === 'tree-extra');
    switch (outcome.kind) {
      case 'shown':
        if (extra) return { ok: false, why: extra.message };
        if (!parsed) return { ok: false, why: `${ARTIFACT} couldn't be read.` };
        return { ok: true, commit, header: outcome.header, parsed };
      case 'invalid': {
        const error = findings.find(({ severity }) => severity === 'error');
        const where = error?.line === undefined ? '' : `, line ${error.line}`;
        return {
          ok: false,
          why: error ? `${error.file}${where}: ${error.message}` : "It isn't an overview.",
        };
      }
      case 'newer':
        return {
          ok: false,
          why: `It's in format ${outcome.format}, which is newer than this checker reads.`,
        };
      case 'tooLarge':
        return { ok: false, why: findings[0]?.message ?? "It's larger than an overview may be." };
      default:
        outcome satisfies never;
        return { ok: false, why: "It isn't an overview." };
    }
  } catch (error) {
    return { ok: false, why: unread(error) };
  } finally {
    code.close();
    objects.close();
  }
}

/** Whether a commit holds what an overview's commit may, and its parents if it does. */
export type Shaped = { ok: true; parents: string[] } | { ok: false; why: string };

/**
 * Whether the commit `id` holds only what an overview's commit may, `artifact.md` and figures,
 * within an overview's limits. Its text isn't read: it's one of the commits under the overview Lo
 * shows, which only the ref's history holds.
 */
export async function judgeShape(git: Git, id: string): Promise<Shaped> {
  const objects = new Objects(git, STREAM_LIMIT);
  try {
    const commit = await commitHeader(objects, id);
    if (!commit) return { ok: false, why: `The repository doesn't have commit ${id}.` };
    const findings = new Findings();
    const contents = readCommit(await listTree(objects, commit.tree, LIMITS.entries), findings);
    const error = findings.list().find(({ severity }) => severity === 'error');
    if (error) return { ok: false, why: error.message };
    if (contents.artifact?.kind !== 'file') {
      return { ok: false, why: `It has no ${ARTIFACT}, as a file.` };
    }
    if (contents.unsized !== undefined) return { ok: false, why: "Its size couldn't be read." };
    return { ok: true, parents: commit.parents };
  } catch (error) {
    return { ok: false, why: unread(error) };
  } finally {
    objects.close();
  }
}

/** Why a commit couldn't be judged, from what was thrown reading it. */
function unread(error: unknown): string {
  if (error instanceof NotOverview) return error.message;
  if (error instanceof GitError) return `It couldn't be read: ${error.message}`;
  throw error;
}
