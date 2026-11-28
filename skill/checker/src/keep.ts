/**
 * `keep`: the base repository's copy of the overview of a pull request from a fork, so it outlives
 * the fork. The fork's `refs/lo/pr/<n>`, and the stack overview its header names, are fetched as
 * data, checked, and pushed as they are, the same commits, to `refs/lo/kept/pr/<n>` and
 * `refs/lo/kept/stack/<id>` in the base repository. A copy only moves forward: a fork's ref that
 * moved to a commit that doesn't descend from the copy leaves the copy as it is, and says so.
 *
 * Everything fetched from a fork is untrusted. The overview Lo would show is checked as Lo checks
 * one, and every commit under it, which the copy holds too, must hold only what an overview's
 * commit may, one parent at most, and at most {@link HISTORY} of them, so a fork can't put anything
 * else in the base repository. A stack overview is copied only for the stack's own fork: its id
 * must be the number of a pull request from the same fork, as a stack of a fork's branches is
 * numbered, so one fork can't move another's copy.
 */

import type { OnRef } from '@lo/artifact';

import type { Log } from './actions.ts';
import { keptRefOf, refOf, type Owner } from './commit.ts';
import { GitError } from './git.ts';
import type { GitHub, PullRequest } from './github.ts';
import { judgeOverview, judgeShape, type Judged } from './judge.ts';
import type { Remote, Workspace } from './remote.ts';

/** The most commits a copy takes in one move: far more than an overview's history holds. */
export const HISTORY = 1_000;

/** `keep` couldn't do its work, and why, in words. */
export class WorkflowError extends Error {
  override name = 'WorkflowError';
}

/** What `keep` and `fold` work with. */
export interface WorkflowOptions {
  /** The pull request. */
  pr: number;
  /** The base repository, the one the workflow runs in: its name, `owner/repo`, and its remote. */
  base: { name: string; remote: Remote };
  /** The remote for the repository named `name`, `owner/repo`, a fork. */
  fork: (name: string) => Remote;
  github: GitHub;
  log: Log;
  workspace: Workspace;
}

/** The pull request `options` name, as GitHub has it. Throws when it has none. */
export async function pullOf({ pr, base, github }: WorkflowOptions): Promise<PullRequest> {
  const pull = await github.pull(base.name, pr);
  if (!pull) throw new WorkflowError(`${base.name} has no pull request #${pr}.`);
  return pull;
}

/** Copies the overview of the pull request `options` name, and its stack's, from its fork. */
export async function keep(options: WorkflowOptions): Promise<void> {
  const { pr, base, log, github } = options;
  const pull = await pullOf(options);
  if (!pull.head) {
    log.info(`#${pr}'s fork was deleted, so there's no overview of it to copy.`);
    return;
  }
  if (pull.head.id === pull.base.id) {
    log.info(`#${pr} isn't from a fork, so there's no overview to copy.`);
    return;
  }
  const fork = { name: pull.head.name, remote: options.fork(pull.head.name) };
  log.info(`#${pr} is from ${fork.name}.`);
  const judged = await copy(options, fork, { pr });
  const stack = judged?.ok ? judged.header.stack : undefined;
  if (stack === undefined) return;
  if (stack !== pr) {
    // A fork's stack is numbered by its bottom layer, a pull request from the same fork.
    const bottom = await github.pull(base.name, stack);
    if (bottom?.head?.id !== pull.head.id) {
      log.warning(
        `#${pr}'s overview names stack ${stack}, and #${stack} isn't a pull request from ${fork.name}, so its stack overview isn't copied.`,
      );
      return;
    }
  }
  await copy(options, fork, { stack });
}

/**
 * Copies the fork's overview of `owner` to the base repository's copy of it, when it's one Lo
 * shows, and the copy moves forward to it. Returns how the fork's overview was judged, if it has
 * one.
 */
async function copy(
  { base, log, workspace }: WorkflowOptions,
  fork: { name: string; remote: Remote },
  owner: Owner,
): Promise<Judged | undefined> {
  const from = refOf(owner);
  const to = keptRefOf(owner);
  const copies = await workspace.list(base.remote, [to]);
  let listed: Map<string, string>;
  try {
    listed = await workspace.list(fork.remote, [from]);
  } catch (error) {
    // A private fork, say, which the workflow's token can't read.
    if (!(error instanceof GitError)) throw error;
    log.warning(`${fork.name} couldn't be read, so its ${from} isn't copied. ${error.message}`);
    return undefined;
  }
  if (!listed.has(from)) {
    log.info(`${fork.name} has no ${from}, so there's nothing to copy.`);
    return undefined;
  }
  // The copy first, so the fork sends only what's new to it.
  const kept = copies.has(to)
    ? (await workspace.fetch(base.remote, [{ from: to, to: 'copy' }])).get(to)
    : undefined;
  const tip = (await workspace.fetch(fork.remote, [{ from, to: 'fork' }])).get(from)!;
  const on: OnRef = owner.stack === undefined ? { pr: owner.pr } : { stack: owner.stack };
  const judged = await judgeOverview(workspace.git, tip, on);
  const theirs = `${fork.name}'s ${from}, at ${tip},`;
  if (!judged.ok) {
    log.warning(`${theirs} isn't an overview Lo shows, so it isn't copied. ${judged.why}`);
    return judged;
  }
  if (kept === tip) {
    log.info(`${to} has ${fork.name}'s ${from} already, at ${tip}.`);
    return judged;
  }
  if (kept !== undefined && !(await workspace.descends(tip, kept))) {
    log.warning(
      `${theirs} doesn't descend from the copy at ${to}, ${kept}, so the copy stays as it is.`,
    );
    return judged;
  }
  const walked = await workspace.walk(tip, kept, HISTORY);
  if (!walked) {
    log.warning(
      `${theirs} adds more than ${HISTORY.toLocaleString('en-US')} commits to the copy, so it isn't copied.`,
    );
    return judged;
  }
  for (const { id, parents } of walked) {
    if (parents.length > 1) {
      log.warning(`${theirs} has a merge under it, ${id}, so it isn't copied.`);
      return judged;
    }
    if (id === tip) continue;
    const shaped = await judgeShape(workspace.git, id);
    if (!shaped.ok) {
      log.warning(
        `${theirs} has a commit under it, ${id}, that isn't an overview's, so it isn't copied. ${shaped.why}`,
      );
      return judged;
    }
  }
  const pushed = await workspace.push(base.remote, tip, to);
  switch (pushed.kind) {
    case 'pushed':
      log.info(
        kept === undefined
          ? `Copied ${fork.name}'s ${from}, ${tip}, to ${to}.`
          : `Moved the copy at ${to} from ${kept} to ${fork.name}'s ${from}, ${tip}.`,
      );
      return judged;
    case 'moved':
      log.warning(
        `${to} moved as it was copied to, so it stays as it is (${pushed.said}). The next run copies it again.`,
      );
      return judged;
    case 'refused':
      throw new WorkflowError(`${base.name} refused the copy to ${to}: ${pushed.said}`);
    default:
      pushed satisfies never;
      throw new WorkflowError(`Pushing to ${to} gave ${JSON.stringify(pushed)}.`);
  }
}
