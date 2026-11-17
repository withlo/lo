/**
 * The pull requests the merging features are tried on, in rozed-dev/e2e, as a git remote on this
 * machine: `testing/fixtures/merge.sh` makes every commit with the ID GitHub has for it, so Lo can
 * fetch them from here while the replay server answers for GitHub's API. The commits GitHub made
 * itself, the history of the two E4 bases the pull requests into them are cut from, come from
 * `testing/fixtures/merge-e4.bundle`.
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
 * E4's two bases, which the pull requests into them are cut from, as `merge-e4.bundle` has them:
 * the commit both share, and each branch's tip when the bundle was made. GitHub made these commits.
 * The tips have moved on since, as pull requests merged into them, and a cassette recorded then
 * names a later one, which the remote lacks until the bundle is made again.
 */
export const MERGE_E4 = {
  /** The commit `e4/gated` and `e4/queued` share, and every pull request into them is cut from. */
  ancestor: '1f54e3f8f371da4c4fa8a3dbdeeed241e361e9a9',
  gated: 'f8fd826d4615edfc580009f2aaf9ddc55f514ee2',
  queued: 'be76197734f8ee252a269294e7be44c1c5fb8295',
} as const;

/** The generations recorded, by number: every commit is the one GitHub has. */
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
  2: {
    owner: 'rozed-dev',
    repo: 'e2e',
    base: {
      first: '6583cdcade3a24207e2de87a56235893549effb4',
      tip: '6280615445b3b10372e7055ba63cfba6f335d0df',
    },
    overrideBase: '4171bff019a1c878eba2f738ccf7db2d9f75d924',
    pulls: {
      squash: {
        number: 119,
        head: '88c6e0ae5d22b0fa50fefde94c610cd3831c564d',
        base: 'merge/2/base',
      },
      merge: {
        number: 120,
        head: '39d578b2965ce211ebdfb2ba7bceba229fc32417',
        base: 'merge/2/base',
      },
      rebase: {
        number: 121,
        head: '6227ffb26e6d367833af7b7343d4b50aa3a106f3',
        base: 'merge/2/base',
      },
      conflict: {
        number: 122,
        head: '77b7cf46c0a49b5f1b775502b14791f6335c4c1f',
        base: 'merge/2/base',
      },
      draft: {
        number: 123,
        head: '69730d285e52dcba553efd99fe7b0bce3b229a3a',
        base: 'merge/2/base',
      },
      stack1: {
        number: 124,
        head: '7d030a43597ba5e7f8c53e4461be8e206b04656c',
        base: 'merge/2/base',
      },
      stack2: {
        number: 125,
        head: '25873551216ec5b5bd14b8b825881264dbe08539',
        base: 'merge/2/stack-1',
      },
      chain1: {
        number: 126,
        head: 'b1632bf56fcec603901bc28b5647f3f2e8083c91',
        base: 'merge/2/base',
      },
      chain2: {
        number: 127,
        head: 'd5b56e4b5ebd507f4710ed0b6b7c07833a7de8bc',
        base: 'merge/2/chain-1',
      },
      moved: {
        number: 128,
        head: '35802f1ddbaa9793fd98a110cc8e589264142e9d',
        base: 'merge/2/base',
      },
      gatedFailing: {
        number: 129,
        head: '779e2dd28431d812fed986b8c940d0c0f04ea026',
        base: 'e4/gated',
      },
      gatedPassing: {
        number: 130,
        head: 'd276853431c1ea349b9f58140f51e418260eb7d8',
        base: 'e4/gated',
      },
      queuedPass: {
        number: 131,
        head: '684f2b1321be9652168cdb77a3c23a4a463df7bf',
        base: 'e4/queued',
      },
      queuedSlow1: {
        number: 132,
        head: 'bdcd224a9a0300449aa711cfabfec1d5668ddb5c',
        base: 'e4/queued',
      },
      queuedSlow2: {
        number: 133,
        head: '3230ff8eaabe0f4f6d0ebc6fa5188a1b6e51dfcd',
        base: 'e4/queued',
      },
      queuedFail: {
        number: 134,
        head: '1cd1ca9351bb8bf8ce0a4e89f1dfe75ef720d060',
        base: 'e4/queued',
      },
      overridden: {
        number: 135,
        head: '606809177adf2b721e2584ccede5ee802cb72bb9',
        base: 'merge/2/override',
      },
    },
    pushed: 'b58dd0da26cbe38fe835d2da11ede3d13ca34577',
    githubStack: 136,
  },
  3: {
    owner: 'rozed-dev',
    repo: 'e2e',
    base: {
      first: '39c8588c26ca5b8fdc0dab32aff835b5ef2a92ad',
      tip: 'cbea00b1af9e3237a88d830ddc722b631345813a',
    },
    overrideBase: '2fcea26e376962849cd5f1537476673e372a4504',
    pulls: {
      squash: {
        number: 138,
        head: 'f88750b6de9173f81decc8ad9c50a4f6560848e6',
        base: 'merge/3/base',
      },
      merge: {
        number: 139,
        head: '17c08d408e097673f11609136ad3cdf055ade434',
        base: 'merge/3/base',
      },
      rebase: {
        number: 140,
        head: 'eb83e86d54d651bb4a0685b3be4254492ab5d1f3',
        base: 'merge/3/base',
      },
      conflict: {
        number: 141,
        head: 'b2ca0486bd82221c22860c01d89121387dc53db2',
        base: 'merge/3/base',
      },
      draft: {
        number: 142,
        head: '5ce26f04c7b20b3996b069b388150beecb9f5ad6',
        base: 'merge/3/base',
      },
      stack1: {
        number: 143,
        head: '0a4ffbccbed57deb49b1b92e730c6de32355e78c',
        base: 'merge/3/base',
      },
      stack2: {
        number: 144,
        head: 'c5798b3b5df6fc44da0359b34e44a454ed322450',
        base: 'merge/3/stack-1',
      },
      chain1: {
        number: 145,
        head: '7a2a02f7d9cdcaae02f4e47538c64f52e0c0ff8c',
        base: 'merge/3/base',
      },
      chain2: {
        number: 146,
        head: '52c08d4ffb63e6d472508c91aac0730157c03d19',
        base: 'merge/3/chain-1',
      },
      moved: {
        number: 147,
        head: '73821f56a53c63a0e652c324afce2dc2f8fe35cc',
        base: 'merge/3/base',
      },
      gatedFailing: {
        number: 148,
        head: '19adef4c441e9f16f8f9867721a28aae24559103',
        base: 'e4/gated',
      },
      gatedPassing: {
        number: 149,
        head: 'bf0f68001486ab1de4be339cf386729a8db951e4',
        base: 'e4/gated',
      },
      queuedPass: {
        number: 150,
        head: '7f6f323de66c06b0169f066a952c9809861e1c85',
        base: 'e4/queued',
      },
      queuedSlow1: {
        number: 151,
        head: 'e1ff564a0ddd3ae4623856e99fdf79a6e66981c0',
        base: 'e4/queued',
      },
      queuedSlow2: {
        number: 152,
        head: 'd5a8b3b02ee2282fd1eadb96bf6f7a627ef9116e',
        base: 'e4/queued',
      },
      queuedFail: {
        number: 153,
        head: '262ba8a53c9ee99ae74c1934b5c234d4fe5934bb',
        base: 'e4/queued',
      },
      overridden: {
        number: 154,
        head: '9d41eb9e3a0c2b122faaa28124c35b926c1a129a',
        base: 'merge/3/override',
      },
    },
    pushed: 'bc0cc916fcc77d55fd87c648cd2f8090992a4aac',
    githubStack: 155,
  },
  4: {
    owner: 'rozed-dev',
    repo: 'e2e',
    base: {
      first: 'f6a9ce490377c5f594b96f1ea30fcc2c7df7722a',
      tip: '1b397a8251a1eb40d44c83b820e866983436e40b',
    },
    overrideBase: '141c5ce7d03bf28d143e350fcd0395637c9d6bfe',
    pulls: {
      squash: {
        number: 156,
        head: 'fdaac2160f0bcb5773413a8e2583fc86d4f085f1',
        base: 'merge/4/base',
      },
      merge: {
        number: 157,
        head: '924f211c75df157304e4d22fe0f710ee863a334b',
        base: 'merge/4/base',
      },
      rebase: {
        number: 158,
        head: '92f3492bf9b3346de28306ae88014fb94f4f8ae0',
        base: 'merge/4/base',
      },
      conflict: {
        number: 159,
        head: 'ba353a6429854af69e4ae9ec88f8b15d3f804d14',
        base: 'merge/4/base',
      },
      draft: {
        number: 160,
        head: 'd168853e0a03ed8931e31a8cbe90ffd672c11725',
        base: 'merge/4/base',
      },
      stack1: {
        number: 161,
        head: '5e954f5a6e714e61521ae86b73d093f660a1129a',
        base: 'merge/4/base',
      },
      stack2: {
        number: 162,
        head: '15bb69aff5bf11f8f43663b457a2eccd5f10d49e',
        base: 'merge/4/stack-1',
      },
      chain1: {
        number: 163,
        head: 'bdf876f3743df75bd986a2920bf9f2560889911e',
        base: 'merge/4/base',
      },
      chain2: {
        number: 164,
        head: '8dcfe37bcf56f2a388ec1aff34c167e5c1fb4016',
        base: 'merge/4/chain-1',
      },
      moved: {
        number: 165,
        head: '9776c43e82177ab014eca0c3ec133d66b9389d90',
        base: 'merge/4/base',
      },
      gatedFailing: {
        number: 166,
        head: '7c920daa63edd121abf25b0e54c40f9f694aadf1',
        base: 'e4/gated',
      },
      gatedPassing: {
        number: 167,
        head: 'e4c43d1768a456def5e01cb6ee02f00f315404c0',
        base: 'e4/gated',
      },
      queuedPass: {
        number: 168,
        head: 'a5aa57345a74b8ea0c4a88498f9c77b77cd0c0d8',
        base: 'e4/queued',
      },
      queuedSlow1: {
        number: 169,
        head: '4ea510d6d98923ba9e77ca526c183748af9b36aa',
        base: 'e4/queued',
      },
      queuedSlow2: {
        number: 170,
        head: '5cbdabb854d2bffb45f86b9352b53cfda4050d12',
        base: 'e4/queued',
      },
      queuedFail: {
        number: 171,
        head: '69855603fae5693567879f012825f2480e2ad7cb',
        base: 'e4/queued',
      },
      overridden: {
        number: 172,
        head: '4b805554f86e1d936c3239418f9801f5dc4ad644',
        base: 'merge/4/override',
      },
    },
    pushed: 'fae597fc69e54dadc50761a647a5594f6015afab',
    githubStack: 173,
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
