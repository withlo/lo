/**
 * `start` and `done`: one writer per pull request. The overview's writer runs `start` as it begins,
 * and `done` once it has pushed or given up. While it writes, the skill's hook starts no other
 * writer for the same pull request, and records one follow-up instead for a push that comes in;
 * `done` hands the writer that follow-up, so it writes the overview once more, for the pull request
 * as it is then. The lock is the hook's own (`hook.mjs`), kept in a folder of the person's in the
 * temporary folder, and lapses on its own after a while, so a writer that never says it's done
 * holds nothing for long.
 */

import { giveBack, keepLock, LOCK_MS, pullOf } from '@lo/skill/hook.mjs';

/** What `start` or `done` was given isn't a pull request's link: its message says so. */
export class WritingError extends Error {
  override name = 'WritingError';
}

/** The pull request `link` names. Throws unless it's a pull request's link on GitHub. */
function pullNamed(link: string): NonNullable<ReturnType<typeof pullOf>> {
  const pull = pullOf(link);
  if (pull === undefined) {
    throw new WritingError(
      `${JSON.stringify(link)} isn't a pull request's link, such as https://github.com/<owner>/<repo>/pull/<number>.`,
    );
  }
  return pull;
}

/** What `start` said: whether the lock is kept, and in words. */
export interface Started {
  locked: boolean;
  said: string;
}

/** Takes, or keeps, the lock on writing the overview of the pull request `link` names. */
export function start(link: string, env: NodeJS.ProcessEnv): Started {
  const pull = pullNamed(link);
  const minutes = LOCK_MS / 60_000;
  return keepLock(pull, { env }) === 'kept'
    ? {
        locked: true,
        said: `Lo marked the overview of ${pull.url} as being written, for ${minutes} minutes, or until done says otherwise.`,
      }
    : {
        locked: false,
        said: `Lo couldn't mark the overview of ${pull.url} as being written, since it has no folder of its own to do it in. Go on: only another writer may start meanwhile.`,
      };
}

/** What `done` said: whether to write the overview again, and in words. */
export interface Done {
  again: boolean;
  said: string;
}

/**
 * Gives back the lock on writing the overview of the pull request `link` names, or, when a push
 * came in meanwhile, keeps it and says to write the overview again.
 */
export function done(link: string, env: NodeJS.ProcessEnv): Done {
  const pull = pullNamed(link);
  return giveBack(pull, { env }) === 'again'
    ? {
        again: true,
        said: `A push came in while you wrote: write the overview of ${pull.url} again, for the pull request as it is now, starting from the overview you pushed. Then run done again.`,
      }
    : { again: false, said: `Nothing came in while you wrote the overview of ${pull.url}.` };
}
