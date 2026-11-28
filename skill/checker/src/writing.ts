/**
 * `start` and `done`: one writer per pull request. The overview's writer runs `start` as it begins,
 * and `done` once it has pushed or given up. While it writes, the skill's hook starts no other
 * writer for the same pull request, and records one follow-up instead for a push that comes in;
 * `done` hands the writer that follow-up, so it writes the overview once more, for the pull request
 * as it is then. The lock is the hook's own (`hook.mjs`), kept in a folder of the person's in the
 * repository's git folder, which a command in Claude Code's sandbox can write too, or in `/tmp`,
 * which one in Codex's can, and lapses on its own after a while, so a writer that never says it's
 * done holds nothing for long.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * The folder `repo` names: a path, or a `file:` link to it, as the skill's hook names the clone a
 * push came from. Throws when it's a link that names no folder here.
 */
function folderNamed(repo: string): string {
  if (!repo.startsWith('file:')) return resolve(repo);
  try {
    return fileURLToPath(repo);
  } catch {
    throw new WritingError(`${JSON.stringify(repo)} isn't a link to a folder here.`);
  }
}

/** What `start` said: whether the lock is kept, and in words. */
export interface Started {
  locked: boolean;
  said: string;
}

/**
 * Takes, or keeps, the lock on writing the overview of the pull request `link` names, for the
 * repository `repo` is in: where the hook took it, the repository's git folder or `/tmp`.
 */
export function start(link: string, repo: string, env: NodeJS.ProcessEnv): Started {
  const pull = pullNamed(link);
  const dir = folderNamed(repo);
  const minutes = LOCK_MS / 60_000;
  return keepLock(pull, { dir, env }) === 'kept'
    ? {
        locked: true,
        said: `Lo marked the overview of ${pull.url} as being written, for ${minutes} minutes, or until done says otherwise.`,
      }
    : {
        locked: false,
        said: `Lo couldn't mark the overview of ${pull.url} as being written: it could write its lock neither in the git folder of ${dir} nor in /tmp. Go on, and say so when you report: a push meanwhile may start another writer.`,
      };
}

/**
 * What `done` said: whether to write the overview again, whether it couldn't tell, and in words.
 */
export interface Done {
  again: boolean;
  failed: boolean;
  said: string;
}

/**
 * Gives back the lock on writing the overview of the pull request `link` names, for the repository
 * `repo` is in, or, when a push came in meanwhile, keeps it and says to write the overview again.
 */
export function done(link: string, repo: string, env: NodeJS.ProcessEnv): Done {
  const pull = pullNamed(link);
  const dir = folderNamed(repo);
  const given = giveBack(pull, { dir, env });
  if (given === 'again') {
    return {
      again: true,
      failed: false,
      said: `A push came in while you wrote: write the overview of ${pull.url} again, for the pull request as it is now, starting from the overview you pushed. Then run done again.`,
    };
  }
  if (given === 'done') {
    return {
      again: false,
      failed: false,
      said: `Nothing came in while you wrote the overview of ${pull.url}.`,
    };
  }
  return {
    again: false,
    failed: true,
    said: `Lo couldn't say the overview of ${pull.url} is written: it couldn't read or remove its lock for ${dir}, in the repository's git folder or in /tmp. Say so when you report: a push that came in while you wrote may get no overview.`,
  };
}
