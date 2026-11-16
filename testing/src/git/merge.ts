/**
 * The pull requests the merging features are tried on, in rozed-dev/e2e, as a git remote on this
 * machine: `testing/fixtures/merge.sh` makes every commit with the ID GitHub has for it, so Lo can
 * fetch them from here while the replay server answers for GitHub's API.
 *
 * A merge can't be undone, so the pull requests come in numbered generations, and what merges one
 * uses it up. `MERGE_PULLS` has each recorded generation, with each pull request's number and head.
 * A recording that merges, queues or removes names the generation it used in its `cassette.json`.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { testGitEnvironment } from './git.ts';

/** The script, `testing/fixtures/merge.sh`. */
export const mergeScript = fileURLToPath(new URL('../../fixtures/merge.sh', import.meta.url));

/** A pull request of a generation: its number and head on GitHub, and the branch it goes into. */
export interface MergePull {
  readonly number: number;
  readonly head: string;
  readonly base: string;
}

/** One generation of the merge fixture, as `merge.sh` made it on GitHub. */
export interface MergeGeneration {
  readonly owner: 'rozed-dev';
  readonly repo: 'e2e';
  /** The commits `merge/<n>/base` was made with, before anything merged into it. */
  readonly base: {
    /** Its first commit, which `conflict` is cut from. */
    readonly first: string;
    /** Its tip as it was made, which most of the pull requests below are cut from. */
    readonly tip: string;
  };
  /** `merge/<n>/override`, the base of `overridden`, covered by the "Merge override" ruleset. */
  readonly overrideBase: string;
  readonly pulls: {
    /** Ready, with two commits, for a squash. */
    readonly squash: MergePull;
    /** Ready, for a merge commit. */
    readonly merge: MergePull;
    /** Ready, with two commits, for a rebase. */
    readonly rebase: MergePull;
    /** Changes line 3 of a file the base changed, so it conflicts. */
    readonly conflict: MergePull;
    readonly draft: MergePull;
    /** The bottom layer of GitHub stack `githubStack`. */
    readonly stack1: MergePull;
    /** The top layer of GitHub stack `githubStack`, into `stack1`'s branch. */
    readonly stack2: MergePull;
    /** The bottom layer of a chain no GitHub stack holds. */
    readonly chain1: MergePull;
    /** The top layer of the chain, into `chain1`'s branch. */
    readonly chain2: MergePull;
    /** Ready, and the one `merge.sh <n> --push` adds a commit to: `moved.head` is its head before. */
    readonly moved: MergePull;
    /** Into `e4/gated`: `ci` fails, and a conversation is unresolved. */
    readonly gatedFailing: MergePull;
    /** Into `e4/gated`: `ci` passes, so it waits only for an approval. */
    readonly gatedPassing: MergePull;
    /** Into `e4/queued`: `ci` passes. */
    readonly queuedPass: MergePull;
    /** Into `e4/queued`: `ci` passes after ten minutes. */
    readonly queuedSlow1: MergePull;
    /** Into `e4/queued`: `ci` passes after ten minutes. */
    readonly queuedSlow2: MergePull;
    /** Into `e4/queued`: `ci` passes on the pull request, and fails in the queue. */
    readonly queuedFail: MergePull;
    /** Into `merge/<n>/override`: an approval is required, which an admin may bypass. */
    readonly overridden: MergePull;
  };
  /** What `--push` adds to `moved`'s branch: one commit on `moved.head`. */
  readonly pushed: string;
  /** The GitHub stack of `stack1` and `stack2`. */
  readonly githubStack: number;
}

/**
 * The generations recorded, by number. The heads of the pull requests into `e4/gated` and
 * `e4/queued` are GitHub's: they sit on commits GitHub made, which no script can build, so the
 * remote {@link writeMergeRemote} makes has pull requests there with the same changes, on a
 * stand-in commit, and other IDs. Every other head, and the bases, are the same commits.
 */
export const MERGE_PULLS = {
  1: {
    owner: 'rozed-dev',
    repo: 'e2e',
    base: {
      first: '4e9d2584fa6cdd1bd4f857bf6a5a8614a21cddfa',
      tip: '02f20a233b5cfc9700e8dc7692117783c0854fc2',
    },
    overrideBase: '0ca89a8ea08e6a342399cfce20df2cdcdcff93f0',
    pulls: {
      squash: {
        number: 101,
        head: 'ca7f115846906eac4abe80788be165f330b65605',
        base: 'merge/1/base',
      },
      merge: {
        number: 102,
        head: '04957b1eba7d2604d4672d0ebcab6fa8df61eeab',
        base: 'merge/1/base',
      },
      rebase: {
        number: 103,
        head: '0c108a0e6a15e8dc79f4e354fdca2cac4818c6e2',
        base: 'merge/1/base',
      },
      conflict: {
        number: 104,
        head: 'f7c81d8f975023d71206297db2219b098d58c8c4',
        base: 'merge/1/base',
      },
      draft: {
        number: 105,
        head: '5e4435b08dcd45af05f2fe056d93aef3983d30cc',
        base: 'merge/1/base',
      },
      stack1: {
        number: 106,
        head: '94ed6e73afacded69dda9e26005b9773a667d7b5',
        base: 'merge/1/base',
      },
      stack2: {
        number: 107,
        head: 'f1033f87a0854ca57fc24934f45826d75e66da75',
        base: 'merge/1/stack-1',
      },
      chain1: {
        number: 108,
        head: '90d9028b65f737425591f43fac99dbea4c48db9b',
        base: 'merge/1/base',
      },
      chain2: {
        number: 109,
        head: '89ef5c7e4d67a47d224c82c090aded598e48d5df',
        base: 'merge/1/chain-1',
      },
      moved: {
        number: 110,
        head: 'd5a7ad7c621b421e0af2f731f20a7a110c022604',
        base: 'merge/1/base',
      },
      gatedFailing: {
        number: 111,
        head: 'ca9e9a896119b12cd2176c9242dd8ff1806cd88f',
        base: 'e4/gated',
      },
      gatedPassing: {
        number: 112,
        head: '96cdd75ba628f281351fa505c42182c509fc9e48',
        base: 'e4/gated',
      },
      queuedPass: {
        number: 113,
        head: '40c63f907b051d5fd26f9cb0b46f3f36b0c10368',
        base: 'e4/queued',
      },
      queuedSlow1: {
        number: 114,
        head: 'aef1f85367a25820f9af2a871bade8c2d6df1908',
        base: 'e4/queued',
      },
      queuedSlow2: {
        number: 115,
        head: 'fddbd4a7589138e112c58c1eef3ebb6c1d0b0d06',
        base: 'e4/queued',
      },
      queuedFail: {
        number: 116,
        head: '3592f87c479da9684c4a4ed4ed9c3f1286b2304a',
        base: 'e4/queued',
      },
      overridden: {
        number: 117,
        head: '33204c2ced6be61fc60e545873b06ec1efc8b5e1',
        base: 'merge/1/override',
      },
    },
    pushed: '9be14ac852186597f22e3d62b31faf059efdb287',
    githubStack: 118,
  },
} as const satisfies Record<number, MergeGeneration>;

/** A generation `MERGE_PULLS` records. */
export type MergeGenerationNumber = keyof typeof MERGE_PULLS;

/**
 * Makes the generation's repository in `folder`, as `rozed-dev/e2e.git`, and returns the address to
 * give Lo as `LO_GIT_REMOTE`. With `pushed`, `moved`'s branch and pull request have the commit
 * `merge.sh <n> --push` adds, as after that push.
 */
export function writeMergeRemote(
  folder: string,
  generation: MergeGenerationNumber,
  { pushed = false } = {},
): string {
  execFileSync(
    'bash',
    [mergeScript, '--local', folder, String(generation), ...(pushed ? ['--push'] : [])],
    { env: testGitEnvironment(), stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return `file://${folder}`;
}
