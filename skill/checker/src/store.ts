/**
 * Reading the repository's definitions as Lo reads them: `terms.json` in the commit the local
 * `refs/lo/terms` points at, that ref exactly. Only the commit's id reaches git, and the file is
 * read as the code is, through the commit's trees, so a link is never followed and its size is
 * known before its bytes are read.
 */

import {
  CHECK_TIMEOUT,
  readStore,
  STORE_FILE,
  STORE_REF,
  type FileAnswer,
  type StoreRead,
} from '@lo/artifact';

import { gitCode } from './code.ts';
import { GitError, refTarget, type Git } from './git.ts';

/**
 * The repository's definitions, or undefined when it has no `refs/lo/terms`. A ref to anything but
 * a commit, or a commit without `terms.json` as a file, is a problem with them, as is a file the
 * store's rules refuse. Rejects, with git's words, when git can't list the ref or read the file, or
 * takes longer than `timeout` milliseconds.
 */
export async function repositoryStore(
  git: Git,
  timeout: number = CHECK_TIMEOUT,
): Promise<StoreRead | undefined> {
  const target = await refTarget(git, STORE_REF);
  if (target === undefined) return undefined;
  if (target.type !== 'commit') {
    return {
      ok: false,
      problem: { code: 'commit', message: `${STORE_REF} isn't a commit.` },
    };
  }
  const code = gitCode(git, [STORE_FILE]);
  let failure: unknown;
  try {
    const signal = AbortSignal.timeout(timeout);
    const store = await readStore(
      (path, cap, stop): Promise<FileAnswer> =>
        code.read(target.id, path, cap, stop).catch((error: unknown) => {
          failure ??= error;
          throw error;
        }),
      signal,
    );
    // Git's failing, or being too slow, isn't the store's: it's that the check can't be done.
    if (!store.ok && store.problem.code === 'unreadable') {
      if (failure instanceof Error) throw failure;
      if (failure !== undefined) throw new GitError(`Lo couldn't read ${STORE_FILE}.`);
      if (signal.aborted) {
        throw new GitError(`Reading ${STORE_FILE} took longer than ${timeout / 1000} seconds.`);
      }
    }
    return store;
  } finally {
    code.close();
  }
}
