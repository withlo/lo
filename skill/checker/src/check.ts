/**
 * Checking an overview in a folder, as Lo checks one on its pull request's ref: its `artifact.md`
 * and figures from the folder, and its code from the repository the checker runs in, at the
 * commit its header names.
 */

import {
  ARTIFACT,
  ARTIFACT_READ,
  checkArtifact,
  parseArtifact,
  type CheckedArtifact,
  type CodeReader,
  type ParsedArtifact,
} from '@lo/artifact';

import { gitCode } from './code.ts';
import { readFolder, type Folder } from './folder.ts';
import { GitError, NoGit, run, TooMuch, type Git } from './git.ts';

/** What checking a folder found. */
export interface FolderCheck {
  checked: CheckedArtifact;
  folder: Folder;
  /**
   * What kept the check from being whole, in sentences: a file or code that couldn't be read, or
   * a commit the repository lacks. With any, the overview can't be said to pass.
   */
  incomplete: string[];
}

/**
 * Checks the overview in the folder `dir` against the repository `git` runs in, as on pull request
 * `pr`'s ref when it's given. Throws when there's no repository, or the folder can't be listed.
 */
export async function checkFolder(dir: string, git: Git, pr?: number): Promise<FolderCheck> {
  await inRepository(git);
  const folder = readFolder(dir);
  const incomplete: string[] = [];
  const failed = (what: string) => (error: unknown) => {
    const said = error instanceof Error ? error.message : String(error);
    // Past git's limit, every read after fails the same way: that's said once.
    const sentence = error instanceof TooMuch ? said : `${what} couldn't be read: ${said}`;
    if (incomplete.length < 5 && !incomplete.includes(sentence)) incomplete.push(sentence);
    throw error;
  };

  // As Lo reads it: whole, when it's a file no larger than it may be.
  let parsed: ParsedArtifact | undefined;
  const signal = new AbortController().signal;
  const artifact = await folder
    .read(ARTIFACT, ARTIFACT_READ, signal)
    .catch(failed(ARTIFACT))
    .catch(() => undefined);
  if (artifact?.kind === 'file' && artifact.bytes.length === artifact.size) {
    parsed = parseArtifact(artifact.bytes);
  }

  const code = gitCode(git, parsed?.references.map(({ target }) => target.path) ?? []);
  const readCode: CodeReader = (commit, path, cap, stop) =>
    code.read(commit, path, cap, stop).catch(failed(`The code at ${path}`));
  const files: Folder = {
    ...folder,
    read: (path, cap, stop) => folder.read(path, cap, stop).catch(failed(path)),
  };
  try {
    const checked = await checkArtifact(parsed, files, readCode, { pr });
    const { outcome } = checked;
    // Looked for even when no target reads code, since the header names it all the same.
    const header = parsed?.header;
    if (header && !(await code.has(header.commit).catch(() => true))) {
      incomplete.push(
        `The repository doesn't have commit ${header.commit}. Check the overview against the pull request's repository, with the commit fetched.`,
      );
    }
    if (outcome.kind === 'shown') {
      const unread = [
        ...outcome.code.filter(({ code: state }) => state.state === 'unread'),
        ...outcome.figures.filter(({ figure }) => figure.state === 'unread'),
      ];
      if (unread.length > 0 && incomplete.length === 0) {
        incomplete.push(`Some of the overview's code or figures couldn't be read in time.`);
      }
    }
    return { checked, folder, incomplete };
  } finally {
    code.close();
  }
}

/** Throws, with git's words, unless `git` runs in a repository. */
async function inRepository(git: Git): Promise<void> {
  try {
    await run(git, ['rev-parse', '--git-dir']);
  } catch (error) {
    if (!(error instanceof GitError) || error instanceof NoGit) throw error;
    throw new GitError(
      `Run the checker in the pull request's repository, or name it with --repo: the code is read from there. ${error.message}`,
    );
  }
}
